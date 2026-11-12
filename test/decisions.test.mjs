import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadBoard } from '../lib/boards.mjs';
import { readDecisions, saveDecisions, validateGroups, decisionsFile, historyFile, MAX_TEXT } from '../lib/decisions.mjs';
import { countDecided } from '../lib/app.mjs';
import { makeBoards, cleanup, startServer, putJson, raw } from './helpers.mjs';

function setup() {
  const dir = makeBoards();
  return { dir, board: loadBoard(dir, 'demo') };
}
const body = (groups) => ({ board: 'demo', groups });

test('a missing decisions file reads as no decisions', () => {
  const { dir, board } = setup();
  try {
    assert.deepEqual(readDecisions(board), { board: 'demo', updatedAt: null, groups: {} });
  } finally {
    cleanup(dir);
  }
});

test('validation: unknown group, unknown option, none-groups, long text, wrong shapes', () => {
  const { dir, board } = setup();
  try {
    assert.throws(() => validateGroups(board, body({ nope: { choice: null } })), /Unknown decision "nope"/);
    assert.throws(() => validateGroups(board, body({ g1: { choice: 'zzz' } })), /"zzz" is not an option of decision "g1"/);
    assert.throws(() => validateGroups(board, body({ g1: { choice: 5 } })), /is not an option/);
    assert.throws(() => validateGroups(board, body({ g2: { choice: 'x' } })), /notes only/);
    assert.throws(() => validateGroups(board, body({ g1: { choice: null, note: 'x'.repeat(MAX_TEXT + 1) } })), /longer than 4000/);
    assert.throws(() => validateGroups(board, body({ g1: { optionNotes: { a: 'y'.repeat(MAX_TEXT + 1) } } })), /longer than 4000/);
    assert.throws(() => validateGroups(board, body({ g1: { optionNotes: { zzz: 'hi' } } })), /"zzz" is not an option/);
    assert.throws(() => validateGroups(board, body({ g1: { note: 12 } })), /must be text/);
    assert.throws(() => validateGroups(board, { groups: [] }), /"groups" object/);
    assert.throws(() => validateGroups(board, 'text'), /object/);
    assert.throws(() => validateGroups(board, { board: 'other', groups: {} }), /for board "other"/);
    const ok = validateGroups(board, body({ g1: { choice: 'a', note: 'x'.repeat(MAX_TEXT), optionNotes: { a: 'fine', b: '' } }, g2: { choice: null } }));
    assert.equal(ok.g1.note.length, MAX_TEXT);
    assert.deepEqual(ok.g1.optionNotes, { a: 'fine' }, 'empty option notes are dropped');
  } finally {
    cleanup(dir);
  }
});

test('save writes pretty JSON, appends history, leaves no temp file', () => {
  const { dir, board } = setup();
  try {
    const first = saveDecisions(board, body({ g1: { choice: 'a', note: 'hello', optionNotes: { b: 'meh' } } }), new Date('2026-01-02T03:04:05.000Z'));
    assert.equal(first.updatedAt, '2026-01-02T03:04:05.000Z');
    const text = fs.readFileSync(decisionsFile(board), 'utf8');
    assert.ok(text.startsWith('{\n  "board": "demo"'), 'two-space indent');
    assert.deepEqual(JSON.parse(text), first);
    assert.deepEqual(first.groups.g1, { choice: 'a', note: 'hello', optionNotes: { b: 'meh' }, updatedAt: '2026-01-02T03:04:05.000Z' });
    assert.ok(!('g2' in first.groups), 'an empty decision that never existed is not stored');

    // unchanged group keeps its time; a changed group gets the new one; other groups are kept
    saveDecisions(board, body({ g1: { choice: 'a', note: 'hello', optionNotes: { b: 'meh' } }, g2: { choice: null, note: 'later' } }), new Date('2026-01-02T04:00:00.000Z'));
    const second = readDecisions(board);
    assert.equal(second.groups.g1.updatedAt, '2026-01-02T03:04:05.000Z');
    assert.equal(second.groups.g2.updatedAt, '2026-01-02T04:00:00.000Z');
    assert.deepEqual(Object.keys(second.groups), ['g1', 'g2'], 'board order');
    saveDecisions(board, body({ g1: { choice: null, note: '', optionNotes: {} } }), new Date('2026-01-02T05:00:00.000Z'));
    const third = readDecisions(board);
    assert.equal(third.groups.g1.choice, null);
    assert.equal(third.groups.g2.note, 'later', 'a save only touches the groups it contains');

    const lines = fs.readFileSync(historyFile(board), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 3);
    assert.deepEqual(Object.keys(lines[0]).sort(), ['at', 'groups']);
    assert.equal(lines[0].at, '2026-01-02T03:04:05.000Z');
    assert.equal(lines[2].groups.g1.choice, null);
    assert.deepEqual(fs.readdirSync(board.dir).filter((f) => f.endsWith('.tmp')), []);
  } finally {
    cleanup(dir);
  }
});

test('a rejected save changes nothing on disk', () => {
  const { dir, board } = setup();
  try {
    saveDecisions(board, body({ g1: { choice: 'a' } }));
    const before = fs.readFileSync(decisionsFile(board), 'utf8');
    const historyBefore = fs.readFileSync(historyFile(board), 'utf8');
    assert.throws(() => saveDecisions(board, body({ g1: { choice: 'b' }, nope: {} })));
    assert.equal(fs.readFileSync(decisionsFile(board), 'utf8'), before);
    assert.equal(fs.readFileSync(historyFile(board), 'utf8'), historyBefore);
  } finally {
    cleanup(dir);
  }
});

test('the file is valid JSON at every moment while many saves happen', async () => {
  const { dir, board } = setup();
  try {
    saveDecisions(board, body({ g1: { choice: 'a' } }));
    let stop = false;
    let bad = 0;
    let reads = 0;
    const reader = (async () => {
      while (!stop) {
        try {
          JSON.parse(fs.readFileSync(decisionsFile(board), 'utf8'));
          reads++;
        } catch (err) {
          if (err.code !== 'EPERM' && err.code !== 'EBUSY') bad++;
        }
        await new Promise((r) => setImmediate(r));
      }
    })();
    for (let i = 0; i < 60; i++) {
      saveDecisions(board, body({ g1: { choice: i % 2 ? 'a' : 'b', note: 'n'.repeat(i * 50) } }));
      if (i % 10 === 0) await new Promise((r) => setTimeout(r, 1));
    }
    stop = true;
    await reader;
    assert.equal(bad, 0);
    assert.ok(reads > 0);
  } finally {
    cleanup(dir);
  }
});

test('over HTTP: save, read back, size cap, content type, bad JSON', async () => {
  const dir = makeBoards();
  const srv = await startServer(dir);
  try {
    const url = '/api/boards/demo/decisions';
    assert.deepEqual((await raw(srv.port, { path: url })).json, { board: 'demo', updatedAt: null, groups: {}, review: { state: 'open', decided: 0, total: 2, submitted: null } });
    const saved = await putJson(srv.port, url, body({ g1: { choice: 'b', note: 'ok' } }));
    assert.equal(saved.status, 200);
    assert.equal(saved.json.groups.g1.choice, 'b');
    assert.deepEqual((await raw(srv.port, { path: url })).json, saved.json);
    const list = (await raw(srv.port, { path: '/api/boards' })).json;
    assert.deepEqual(list.find((b) => b.id === 'demo'), { id: 'demo', title: 'Demo', subtitle: 'A board for tests', groups: 2, decided: 1, review: { state: 'open', decided: 1, total: 2, submitted: null } });

    const big = await putJson(srv.port, url, JSON.stringify({ groups: { g1: { note: 'z'.repeat(70 * 1024) } } }));
    assert.equal(big.status, 413);
    assert.match(big.json.error, /larger than 64 KB/);
    const long = await putJson(srv.port, url, body({ g1: { note: 'z'.repeat(MAX_TEXT + 1) } }));
    assert.equal(long.status, 400);
    assert.match(long.json.error, /longer than 4000/);
    assert.equal((await putJson(srv.port, url, 'not json')).status, 400);
    assert.equal((await putJson(srv.port, url, body({ nope: {} }))).status, 400);
    assert.equal((await raw(srv.port, { method: 'PUT', path: url, headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await putJson(srv.port, '/api/boards/nope/decisions', body({}))).status, 404);
    assert.equal((await raw(srv.port, { method: 'DELETE', path: url })).status, 405);
    assert.equal(readDecisions(loadBoard(dir, 'demo')).groups.g1.note, 'ok', 'failed saves left the file alone');
    assert.ok(fs.existsSync(path.join(dir, 'demo', 'decisions.json')));
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

test('stored entries the board no longer has survive a save, and the save succeeds', async () => {
  const { dir, board } = setup();
  const srv = await startServer(dir);
  try {
    const stale = {
      board: 'demo',
      updatedAt: '2026-01-01T00:00:00.000Z',
      groups: {
        'old-round': { choice: 'gone', note: 'earlier round', optionNotes: {}, updatedAt: '2026-01-01T00:00:00.000Z' },
        g1: { choice: 'removed-option', note: '', optionNotes: { 'removed-option': 'old note' }, updatedAt: '2026-01-01T00:00:00.000Z' },
      },
    };
    fs.writeFileSync(decisionsFile(board), JSON.stringify(stale));
    const r = await putJson(srv.port, '/api/boards/demo/decisions', body({ g1: { choice: 'a', note: 'new', optionNotes: { a: 'x' } } }));
    assert.equal(r.status, 200);
    const onDisk = JSON.parse(fs.readFileSync(decisionsFile(board), 'utf8'));
    assert.equal(onDisk.groups['old-round'].note, 'earlier round');
    assert.equal(onDisk.groups.g1.choice, 'a');
    assert.deepEqual(onDisk.groups.g1.optionNotes, { 'removed-option': 'old note', a: 'x' });
    assert.deepEqual(Object.keys(onDisk.groups), ['g1', 'old-round'], 'board groups first, earlier rounds after');
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

test('a save that changes nothing writes no file and no history line', () => {
  const { dir, board } = setup();
  try {
    saveDecisions(board, body({ g1: { choice: 'a', note: 'n', optionNotes: {} } }), new Date('2026-02-01T10:00:00Z'));
    const lines = () => fs.readFileSync(historyFile(board), 'utf8').trim().split(String.fromCharCode(10)).length;
    assert.equal(lines(), 1);
    const before = fs.readFileSync(decisionsFile(board), 'utf8');
    const again = saveDecisions(board, body({ g1: { choice: 'a', note: 'n', optionNotes: {} } }), new Date('2026-02-01T11:00:00Z'));
    saveDecisions(board, { board: 'demo', groups: {} }, new Date('2026-02-01T12:00:00Z'));
    assert.equal(lines(), 1);
    assert.equal(fs.readFileSync(decisionsFile(board), 'utf8'), before);
    assert.equal(again.updatedAt, '2026-02-01T10:00:00.000Z');
    saveDecisions(board, body({ g1: { choice: 'b', note: 'n', optionNotes: {} } }), new Date('2026-02-01T13:00:00Z'));
    assert.equal(lines(), 2);
  } finally {
    cleanup(dir);
  }
});

test('a stale stored choice and stale option notes survive an edit that sends choice null; a real clear still works', () => {
  const { dir, board } = setup();
  try {
    fs.writeFileSync(decisionsFile(board), JSON.stringify({
      board: 'demo', updatedAt: '2026-01-01T00:00:00.000Z',
      groups: { g1: { choice: 'removed-option', note: '', optionNotes: { 'removed-option': 'old' }, updatedAt: '2026-01-01T00:00:00.000Z' } },
    }));
    const saved = saveDecisions(board, body({ g1: { choice: null, note: 'edited', optionNotes: { a: 'x' } } }));
    assert.equal(saved.groups.g1.choice, 'removed-option');
    assert.equal(saved.groups.g1.note, 'edited');
    assert.deepEqual(saved.groups.g1.optionNotes, { 'removed-option': 'old', a: 'x' });
    // choosing a real option replaces it, and a later explicit clear of that real choice sticks
    assert.equal(saveDecisions(board, body({ g1: { choice: 'a', note: 'edited' } })).groups.g1.choice, 'a');
    assert.equal(saveDecisions(board, body({ g1: { choice: null, note: 'edited' } })).groups.g1.choice, null);
  } finally {
    cleanup(dir);
  }
});

test('countDecided ignores a stale choice but counts a none-group with a note', () => {
  const { dir, board } = setup();
  try {
    const groups = { g1: { choice: 'removed-option', note: '' }, g2: { choice: null, note: ' hi ' } };
    assert.equal(countDecided(board, { groups }), 1);
    groups.g1.choice = 'b';
    assert.equal(countDecided(board, { groups }), 2);
  } finally {
    cleanup(dir);
  }
});
