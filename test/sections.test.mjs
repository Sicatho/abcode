import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadBoard, BoardError, publicBoard } from '../lib/boards.mjs';
import { GOOD_BOARD, makeBoards, writeJson, cleanup, startServer, raw } from './helpers.mjs';
import { sectionRuns, visibleGroups, neighbour, sectionCount, isOpen, sectionKey, isNewGroup, newCount, wantedSession } from '../app/js/lib/sections.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
function load(mutate) {
  const dir = makeBoards();
  try {
    const b = clone(GOOD_BOARD);
    mutate(b);
    writeJson(path.join(dir, 'demo', 'board.json'), b);
    return loadBoard(dir, 'demo');
  } finally {
    cleanup(dir);
  }
}
function expectError(mutate, pattern) {
  assert.throws(() => load(mutate), (err) => err instanceof BoardError && pattern.test(err.message) && err.message.includes('board.json'), `expected ${pattern}`);
}

// ---------- validation and normalization ----------
test('a board without the new fields gets null and empty lists', () => {
  const b = load(() => {});
  assert.equal(b.defaultSession, null);
  for (const g of b.groups) {
    assert.equal(g.section, null);
    assert.deepEqual(g.steps, []);
    assert.deepEqual(g.caveats, []);
    assert.equal(g.session, null);
  }
});

test('section, steps, caveats and sessions are normalized and reach the public board', () => {
  const b = load((x) => {
    x.defaultSession = 'out';
    x.groups[0].section = '  Changes to check ';
    x.groups[0].steps = ['Open the page.', ' Press Save. '];
    x.groups[0].caveats = ['Hover is not shown.'];
    x.groups[0].session = 'user';
    x.groups[1].steps = [];
  });
  assert.equal(b.groups[0].section, 'Changes to check');
  assert.deepEqual(b.groups[0].steps, ['Open the page.', 'Press Save.']);
  const pub = publicBoard(b, '/d.json');
  assert.equal(pub.groups[0].section, 'Changes to check');
  assert.deepEqual(pub.groups[0].caveats, ['Hover is not shown.']);
  assert.equal(pub.groups[0].session, 'user');
  assert.equal(pub.defaultSession, 'out');
  assert.deepEqual(pub.groups[1].steps, []);
  assert.equal(pub.groups[1].session, null);
});

test('section: wrong type, empty and over-long are reported with the field', () => {
  expectError((b) => { b.groups[1].section = 5; }, /"groups\[1\]\.section" must be a string/);
  expectError((b) => { b.groups[0].section = ''; }, /"groups\[0\]\.section" must be 1 to 60 characters/);
  expectError((b) => { b.groups[0].section = '   '; }, /"groups\[0\]\.section" must be 1 to 60/);
  expectError((b) => { b.groups[0].section = 'x'.repeat(61); }, /"groups\[0\]\.section" must be 1 to 60/);
  assert.equal(load((b) => { b.groups[0].section = 'x'.repeat(60); }).groups[0].section.length, 60);
});

for (const [field, max] of [['steps', 8], ['caveats', 6]]) {
  test(`${field}: wrong type, empty, over-long and too many are reported with the field`, () => {
    const re = (s) => new RegExp(s);
    expectError((b) => { b.groups[0][field] = 'open it'; }, re(`"groups\\[0\\]\\.${field}" must be a list of strings`));
    expectError((b) => { b.groups[0][field] = ['ok', 3]; }, re(`"groups\\[0\\]\\.${field}\\[1\\]" must be a string`));
    expectError((b) => { b.groups[0][field] = ['ok', null]; }, re(`"groups\\[0\\]\\.${field}\\[1\\]" must be a string`));
    expectError((b) => { b.groups[0][field] = ['ok', '']; }, re(`"groups\\[0\\]\\.${field}\\[1\\]" must be 1 to 300 characters`));
    expectError((b) => { b.groups[0][field] = ['x'.repeat(301)]; }, re(`"groups\\[0\\]\\.${field}\\[0\\]" must be 1 to 300`));
    expectError((b) => { b.groups[0][field] = Array(max + 1).fill('a'); }, re(`"groups\\[0\\]\\.${field}" must have at most ${max}`));
    assert.equal(load((b) => { b.groups[0][field] = Array(max).fill('x'.repeat(300)); }).groups[0][field].length, max);
  });
}

test('group.session and defaultSession must name an existing session', () => {
  expectError((b) => { b.groups[1].session = 'nobody'; }, /"groups\[1\]\.session" names "nobody", which is not in sessions/);
  expectError((b) => { b.groups[1].session = 7; }, /"groups\[1\]\.session" must be a string/);
  expectError((b) => { b.defaultSession = 'nobody'; }, /"defaultSession" names "nobody", which is not in sessions/);
  expectError((b) => { b.defaultSession = ['user']; }, /"defaultSession" must be a string/);
  expectError((b) => { delete b.sessions; b.defaultSession = 'user'; }, /"defaultSession" names "user"/);
  assert.equal(load((b) => { b.groups[0].session = 'gone'; b.defaultSession = 'user'; }).groups[0].session, 'gone');
});

test('the normalized board over HTTP carries the new fields', async () => {
  const dir = makeBoards();
  const b = clone(GOOD_BOARD);
  b.defaultSession = 'user';
  b.groups[0].section = 'First part';
  b.groups[0].steps = ['One'];
  b.groups[0].caveats = ['Two'];
  b.groups[1].session = 'out';
  writeJson(path.join(dir, 'demo', 'board.json'), b);
  const srv = await startServer(dir);
  try {
    const res = await raw(srv.port, { path: '/api/boards/demo' });
    const body = res.json;
    assert.equal(body.defaultSession, 'user');
    assert.equal(body.groups[0].section, 'First part');
    assert.deepEqual(body.groups[0].steps, ['One']);
    assert.deepEqual(body.groups[0].caveats, ['Two']);
    assert.equal(body.groups[1].session, 'out');
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

// ---------- pure page logic ----------
const G = (id, section, session) => ({ id, section: section ?? null, session: session ?? null });

test('sectionRuns joins consecutive groups of one section and leaves others alone', () => {
  const runs = sectionRuns([G('a'), G('b', 'S'), G('c', 'S'), G('d'), G('e', 'S'), G('f', 'T')]);
  assert.deepEqual(runs.map((r) => [r.section, r.groups.map((g) => g.id)]), [[null, ['a']], ['S', ['b', 'c']], [null, ['d']], ['S', ['e']], ['T', ['f']]]);
  assert.deepEqual(sectionRuns([G('a'), G('b')]).map((r) => r.groups.length), [1, 1], 'groups without a section stand alone');
  assert.deepEqual(sectionRuns([]), []);
});

test('visibleGroups hides decided groups except the active one', () => {
  const gs = [G('a'), G('b'), G('c')];
  const decided = (g) => g.id !== 'c';
  assert.equal(visibleGroups(gs, { undecidedOnly: false, isDecided: decided }).length, 3);
  assert.deepEqual(visibleGroups(gs, { undecidedOnly: true, isDecided: decided }).map((g) => g.id), ['c']);
  assert.deepEqual(visibleGroups(gs, { undecidedOnly: true, isDecided: decided, activeId: 'a' }).map((g) => g.id), ['a', 'c']);
  assert.deepEqual(visibleGroups(gs, { undecidedOnly: true, isDecided: () => true }), []);
});

test('neighbour walks the visible list and stops at the ends', () => {
  const v = [G('a'), G('c'), G('e')];
  assert.equal(neighbour(v, 'c', 1).id, 'e');
  assert.equal(neighbour(v, 'c', -1).id, 'a');
  assert.equal(neighbour(v, 'e', 1), null);
  assert.equal(neighbour(v, 'a', -1), null);
  assert.equal(neighbour(v, 'zzz', 1).id, 'a');
  assert.equal(neighbour([], 'a', 1), null);
});

test('walking with the filter on skips decided groups across sections', () => {
  const gs = [G('a', 'S'), G('b', 'S'), G('c', 'T'), G('d', 'T')];
  const decided = (g) => g.id === 'b' || g.id === 'c';
  const v = visibleGroups(gs, { undecidedOnly: true, isDecided: decided, activeId: 'a' });
  assert.equal(neighbour(v, 'a', 1).id, 'd');
  assert.equal(neighbour(v, 'd', -1).id, 'a');
});

test('sectionCount counts all groups of the run, and isOpen keeps the active section open', () => {
  const run = sectionRuns([G('a', 'S'), G('b', 'S'), G('c', 'S')])[0];
  assert.deepEqual(sectionCount(run, (g) => g.id !== 'b'), { done: 2, total: 3 });
  assert.equal(isOpen(run, new Set([sectionKey(run)]), null), false);
  assert.equal(isOpen(run, new Set([sectionKey(run)]), 'b'), true);
  assert.equal(isOpen(run, new Set(), null), true);
});

test('the New marker: only after a finish, only for groups the finish did not know, until decided', () => {
  const submitted = { groupIds: ['a', 'b'] };
  const none = () => false;
  assert.equal(isNewGroup(G('c'), null, none), false, 'a board never finished has nothing new');
  assert.equal(isNewGroup(G('a'), submitted, none), false);
  assert.equal(isNewGroup(G('c'), submitted, none), true);
  assert.equal(isNewGroup(G('c'), submitted, (g) => g.id === 'c'), false, 'decided groups lose the tag');
  assert.equal(isNewGroup(G('c'), { groupIds: 'nope' }, none), false);
  const run = sectionRuns([G('b', 'S'), G('c', 'S'), G('d', 'S')])[0];
  assert.equal(newCount(run, submitted, none), 2);
  assert.equal(newCount(run, submitted, (g) => g.id === 'd'), 1);
  assert.equal(newCount(run, null, none), 0);
});

test('which account a decision asks for: its own, else the default, else none', () => {
  const board = { defaultSession: 'user' };
  assert.equal(wantedSession(board, G('a', null, 'out')), 'out');
  assert.equal(wantedSession(board, G('a')), 'user');
  assert.equal(wantedSession({ defaultSession: null }, G('a')), null);
  assert.equal(wantedSession({ defaultSession: null }, G('a', null, 'out')), 'out');
  assert.equal(wantedSession({}, G('a')), null);
});

test('two sections of one name are collapsed apart', () => {
  const runs = sectionRuns([G('a', 'S'), G('b', 'T'), G('c', 'S')]);
  const collapsed = new Set([sectionKey(runs[0])]);
  assert.equal(isOpen(runs[0], collapsed, null), false);
  assert.equal(isOpen(runs[2], collapsed, null), true);
  assert.notEqual(sectionKey(runs[0]), sectionKey(runs[2]));
});

import { summaryText } from '../app/js/lib/format.js';

test('summaryText marks a decision without a section that follows a section', () => {
  const g = (id, section) => ({ id, title: `Group ${id}`, section, pick: 'one', options: [] });
  const board = { title: 'B', groups: [g('p0', null), g('a1', 'Alpha'), g('a2', 'Alpha'), g('p3', null), g('p4', null), g('b5', 'Beta')] };
  const lines = summaryText(board, { groups: {} }).split('\n');
  assert.equal(lines.filter((l) => l === '== (no section) ==').length, 1);
  assert.ok(lines.indexOf('== (no section) ==') < lines.findIndex((l) => l.startsWith('4. Group p3')));
  assert.ok(lines.indexOf('== (no section) ==') > lines.findIndex((l) => l.startsWith('3. Group a2')));
  assert.ok(!lines.slice(0, lines.indexOf('== Alpha ==')).includes('== (no section) =='));
});
