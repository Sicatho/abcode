// The pure parts of taking in a changed board, revealing a row in the list and remembering accounts per site.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dueForRefresh, boardChanged, landingGroup, scrollToReveal, hostOf, sessionMemoryKey, sessionRecord, rememberedSession, sessionClaimLost, mustHoldBoard } from '../app/js/lib/reload.js';

test('a refresh is due at most once every few seconds', () => {
  assert.equal(dueForRefresh(1000, 0, 4000), true);
  assert.equal(dueForRefresh(4999, 1000, 4000), false);
  assert.equal(dueForRefresh(5000, 1000, 4000), true);
});

test('a board is changed when its content differs', () => {
  assert.equal(boardChanged({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), false);
  assert.equal(boardChanged({ a: [1] }, { a: [2] }), true);
});

test('after a change the open decision stays, else the first undecided, else the first', () => {
  const board = { groups: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  const decided = (ids) => (g) => ids.includes(g.id);
  assert.equal(landingGroup(board, 'b', decided(['a'])), 'b');
  assert.equal(landingGroup(board, 'gone', decided(['a'])), 'b');
  assert.equal(landingGroup(board, null, decided([])), 'a');
  assert.equal(landingGroup(board, 'gone', decided(['a', 'b', 'c'])), 'a');
  assert.equal(landingGroup({ groups: [] }, 'x', decided([])), null);
});

test('scrollToReveal leaves a visible row alone and brings a hidden one into view with its heading', () => {
  const view = { viewTop: 100, viewHeight: 300 };
  assert.equal(scrollToReveal({ rowTop: 150, rowBottom: 190, headTop: 120, ...view }), null);
  // row below the view: its bottom edge lands on the bottom of the view
  assert.equal(scrollToReveal({ rowTop: 500, rowBottom: 540, headTop: 400, ...view }), 540 - 300);
  // heading and row fit together: the heading shows too
  assert.equal(scrollToReveal({ rowTop: 20, rowBottom: 60, headTop: 0, ...view }), 0);
  assert.equal(scrollToReveal({ rowTop: 220, rowBottom: 260, headTop: 90, ...view }), 90);
  // heading and row do not fit together: the row wins
  assert.equal(scrollToReveal({ rowTop: 1000, rowBottom: 1040, headTop: 100, viewTop: 0, viewHeight: 300 }), 1040 - 300);
  assert.equal(scrollToReveal({ rowTop: 20, rowBottom: 60, headTop: null, viewTop: 100, viewHeight: 300 }), 20);
  // never negative
  assert.equal(scrollToReveal({ rowTop: -5, rowBottom: 30, viewTop: 10, viewHeight: 300 }), 0);
});

const board = (id, sessions = [{ id: 'account-a', target: 'site' }, { id: 'account-b', target: 'site' }], origin = 'http://127.0.0.1:5000') => ({ id, sessions, targets: { site: { origin } } });
const store = () => {
  const m = new Map();
  return { read: (k) => (m.has(k) ? m.get(k) : null), write: (k, v) => m.set(k, v) };
};

test('the host name is what a cookie belongs to, whatever the port', () => {
  assert.equal(hostOf('http://127.0.0.1:5000/x'), '127.0.0.1');
  assert.equal(hostOf('http://LocalHost:81'), 'localhost');
  assert.equal(hostOf('nonsense'), null);
});

test('a board claims an account only if it set it, and another board on the same site takes the claim away', () => {
  const st = store();
  const key = sessionMemoryKey(hostOf('http://127.0.0.1:5000'));
  assert.equal(rememberedSession(board('A'), st.read), null, 'nothing set yet: unsure');
  st.write(key, sessionRecord('A', 'account-a'));
  assert.equal(rememberedSession(board('A'), st.read), 'account-a');
  assert.equal(rememberedSession(board('B', [{ id: 'account-a', target: 'site' }]), st.read), null, 'the same session id on another board is not the same claim');
  st.write(key, sessionRecord('B', 'account-b'));
  assert.equal(rememberedSession(board('A'), st.read), null, 'board B set the cookie since');
  assert.equal(rememberedSession(board('B'), st.read), 'account-b');
  st.write(key, sessionRecord('A', 'gone'));
  assert.equal(rememberedSession(board('A'), st.read), null, 'a session the board no longer has');
  st.write(key, 'not json');
  assert.equal(rememberedSession(board('A'), st.read), null);
});

test('the memory is per host name: the same board on another site is not mixed up', () => {
  const st = store();
  st.write(sessionMemoryKey('127.0.0.1'), sessionRecord('A', 'account-a'));
  assert.equal(rememberedSession(board('A', undefined, 'http://localhost:5000'), st.read), null);
  assert.equal(rememberedSession(board('A', undefined, 'http://127.0.0.1:9999'), st.read), 'account-a');
});

test('the claim to an account is lost when another board on the same site wrote a record since', () => {
  const st = store();
  const key = sessionMemoryKey('127.0.0.1');
  st.write(key, sessionRecord('A', 'account-a'));
  assert.equal(sessionClaimLost(board('A'), 'account-a', st.read), false);
  st.write(key, sessionRecord('B', 'account-b'));
  assert.equal(sessionClaimLost(board('A'), 'account-a', st.read), true, 'tab B set Bea');
  assert.equal(sessionClaimLost(board('A'), null, st.read), false, 'nothing claimed, nothing to lose');
  assert.equal(sessionClaimLost(board('A'), 'account-a', store().read), false, 'no record at all (storage blocked): keep what is known');
});

test('a board that lost the open decision waits only while that decision holds unsaved text', () => {
  assert.equal(mustHoldBoard({ removed: true, hasUnsaved: true }), true, 'unsaved or being typed: wait');
  assert.equal(mustHoldBoard({ removed: true, hasUnsaved: false }), false);
  assert.equal(mustHoldBoard({ removed: false, hasUnsaved: true }), false);
});

test('a decision keeps its signature when something elsewhere on the board changes', async () => {
  const { groupSignature } = await import('../app/js/lib/reload.js');
  const board = {
    targets: { site: { label: 'Site', origin: 'http://127.0.0.1:1' }, other: { label: 'Other', origin: 'http://127.0.0.1:2' } },
    viewports: [{ id: 'desktop', width: 1440, height: 900 }],
    sessions: [{ id: 'u', label: 'U', target: 'site', kind: 'set' }],
    groups: [
      { id: 'a', title: 'A', section: 'One', options: [{ id: 'x', label: 'X', live: { target: 'site', url: 'http://127.0.0.1:1/' } }] },
      { id: 'b', title: 'B', options: [{ id: 'y', label: 'Y' }] },
    ],
  };
  const sig = groupSignature(board, board.groups[0]);
  const copy = (f) => { const c = JSON.parse(JSON.stringify(board)); f(c); return c; };
  // elsewhere: another decision, its section, an unrelated target, the title of the board
  assert.equal(groupSignature(copy((c) => { c.groups[1].title = 'B2'; }), board.groups[0]), sig);
  assert.equal(groupSignature(copy((c) => { c.groups[0].section = 'Two'; }), copy((c) => { c.groups[0].section = 'Two'; }).groups[0]), sig);
  assert.equal(groupSignature(copy((c) => { c.targets.other.origin = 'http://127.0.0.1:3'; }), board.groups[0]), sig);
  // the decision itself, a target or viewport it uses
  const changes = [
    (c) => { c.groups[0].options[0].label = 'X2'; },
    (c) => { c.groups[0].options[0].live.url = 'http://127.0.0.1:1/z'; },
    (c) => { c.groups[0].steps = ['do this']; },
    (c) => { c.targets.site.origin = 'http://127.0.0.1:9'; },
    (c) => { c.viewports[0].width = 1000; },
    (c) => { c.groups[0].session = 'u'; c.sessions[0].label = 'U2'; },
  ];
  for (const f of changes) {
    const c = copy(f);
    assert.notEqual(groupSignature(c, c.groups[0]), sig);
  }
});

test('heldText gathers the note and the option notes under their labels', async () => {
  const { heldText } = await import('../app/js/lib/reload.js');
  const group = { options: [{ id: 'a', label: 'Slim' }] };
  assert.equal(heldText(null, group), '');
  assert.equal(heldText({ note: '  ', optionNotes: {} }, group), '');
  assert.equal(heldText({ note: 'Keep it', optionNotes: { a: 'too thin', z: 'gone option' } }, group), 'Keep it\n\nNote on Slim:\ntoo thin\n\nNote on z:\ngone option');
});
