import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadBoard, listBoardIds, BoardError, normalizeBoard, publicBoard } from '../lib/boards.mjs';
import { GOOD_BOARD, makeBoards, writeJson, cleanup, tmpDir } from './helpers.mjs';

const clone = (o) => JSON.parse(JSON.stringify(o));
function expectError(mutate, pattern) {
  const dir = makeBoards();
  try {
    const b = clone(GOOD_BOARD);
    mutate(b);
    writeJson(path.join(dir, 'demo', 'board.json'), b);
    assert.throws(() => loadBoard(dir, 'demo'), (err) => err instanceof BoardError && pattern.test(err.message) && err.message.includes('board.json'), `expected ${pattern}`);
  } finally {
    cleanup(dir);
  }
}

test('a valid board is normalized: defaults, live addresses, shot urls', () => {
  const dir = makeBoards();
  try {
    const b = loadBoard(dir, 'demo');
    assert.equal(b.id, 'demo');
    assert.deepEqual(b.viewports.map((v) => v.id), ['desktop', 'phone']);
    assert.equal(b.viewports[0].width, 1440);
    const a = b.groups[0].options[0];
    assert.equal(a.live.url, 'http://127.0.0.1:59999/x?ui=&mode=one', 'an empty query value is kept');
    assert.equal(a.live.target, 'site');
    assert.equal(b.groups[0].options[1].live.url, 'http://127.0.0.1:1/');
    assert.equal(a.shots.phone[0].url, '/boards/demo/assets/shots/a.png');
    assert.equal(b.groups[0].pick, 'one');
    assert.equal(b.groups[1].pick, 'none');
    assert.equal(b.groups[0].recommended, 'b');
    assert.equal(b.groups[0].defaultViewport, 'phone');
  } finally {
    cleanup(dir);
  }
});

test('the public board hides asset folders and cookie files', () => {
  const dir = makeBoards();
  try {
    const pub = publicBoard(loadBoard(dir, 'demo'), '/some/decisions.json');
    const text = JSON.stringify(pub);
    assert.ok(!text.includes('accounts.json'));
    assert.ok(!text.includes('app_session'));
    assert.ok(!('assetDirs' in pub) && !('sessionDefs' in pub));
    assert.deepEqual(pub.sessions.map((s) => s.kind), ['set', 'set', 'set', 'clear']);
    assert.equal(pub.decisionsPath, '/some/decisions.json');
  } finally {
    cleanup(dir);
  }
});

test('listBoardIds finds folders with a board.json', () => {
  const dir = makeBoards();
  try {
    writeJson(path.join(dir, 'Not_Valid', 'board.json'), GOOD_BOARD);
    writeJson(path.join(dir, 'empty-folder', 'readme.txt'), 'x');
    assert.deepEqual(listBoardIds(dir), ['demo', 'other']);
    assert.deepEqual(listBoardIds(path.join(dir, 'nope')), []);
  } finally {
    cleanup(dir);
  }
});

test('unknown board ids give 404, a broken file gives a sentence naming the file', () => {
  const dir = makeBoards();
  try {
    assert.throws(() => loadBoard(dir, 'nope'), (e) => e.status === 404);
    assert.throws(() => loadBoard(dir, '../demo'), (e) => e.status === 404);
    writeJson(path.join(dir, 'demo', 'board.json'), '{ not json');
    assert.throws(() => loadBoard(dir, 'demo'), (e) => e.status === 500 && /board\.json is not valid JSON/.test(e.message));
  } finally {
    cleanup(dir);
  }
});

test('validation errors name the file and the field', () => {
  expectError((b) => delete b.title, /"title" is required/);
  expectError((b) => (b.groups = []), /"groups" must be a non-empty list/);
  expectError((b) => (b.groups[1].id = 'g1'), /"groups\[1\]\.id" "g1" is used twice/);
  expectError((b) => (b.groups[0].options[1].id = 'a'), /options\[1\]\.id" "a" is used twice/);
  expectError((b) => (b.groups[0].recommended = 'zzz'), /"groups\[0\]\.recommended" names "zzz"/);
  expectError((b) => (b.groups[0].pick = 'many'), /"groups\[0\]\.pick" must be "one" or "none"/);
  expectError((b) => (b.groups[0].defaultViewport = 'tablet'), /defaultViewport" names "tablet"/);
  expectError((b) => (b.groups[0].options[0].live.target = 'nowhere'), /live\.target" names "nowhere"/);
  expectError((b) => (b.groups[0].options[1].live.url = 'ftp://x'), /live\.url" must start with http/);
  expectError((b) => (b.groups[0].options[0].shots.phone[0].src = 'nope/a.png'), /shots\.phone\[0\]\.src" must start with an asset root name/);
  expectError((b) => (b.groups[0].options[0].shots.phone[0].src = 'shots/../a.png'), /not a clean path/);
  expectError((b) => (b.groups[0].options[0].shots.tablet = []), /shots\.tablet" is not one of the viewports/);
  expectError((b) => (b.targets.site.origin = 'not a url'), /targets\.site\.origin" is not a web address/);
  expectError((b) => (b.viewports = [{ id: 'a', width: 10, height: 10 }]), /viewports\[0\]\.width" must be a whole number/);
  expectError((b) => (b.sessions[0].target = 'nowhere'), /sessions\[0\]\.target" names "nowhere"/);
  expectError((b) => delete b.sessions[3].clear, /sessions\[3\]" needs either "cookie" or "clear"/);
  expectError((b) => (b.sessions[1].id = 'user'), /sessions\[1\]\.id" "user" is used twice/);
  expectError((b) => (b.groups[0].id = 'has space'), /groups\[0\]\.id" has characters other than/);
});

test('unknown fields are ignored and optional fields get defaults', () => {
  const b = normalizeBoard('mini', { title: 'Mini', surprise: 1, groups: [{ id: 'g', options: [{ id: 'o', extra: true }] }] }, 'mini/board.json', tmpDir());
  assert.equal(b.subtitle, '');
  assert.equal(b.groups[0].title, 'g');
  assert.equal(b.groups[0].options[0].label, 'o');
  assert.deepEqual(b.groups[0].options[0].shots, {});
  assert.equal(b.groups[0].options[0].live, null);
  assert.deepEqual(b.sessions, []);
});
