import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadBoard } from '../lib/boards.mjs';
import { readDecisions, saveDecisions, submitDecisions, validateGroups, decisionsFile, historyFile } from '../lib/decisions.mjs';
import { boardReview, reviewState } from '../lib/review.mjs';
import { isDecided, countDecided, firstWords } from '../app/js/lib/rules.js';
import { GOOD_BOARD, makeBoards, writeJson, cleanup, startServer, putJson, raw } from './helpers.mjs';
import path from 'node:path';

function setup() {
  const dir = makeBoards();
  return { dir, board: loadBoard(dir, 'demo') };
}
const body = (groups) => ({ board: 'demo', groups });
const lines = (board) => fs.readFileSync(historyFile(board), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('rules: a notes-only group is decided when marked done or when it has a note', () => {
  const { dir, board } = setup();
  try {
    const [g1, g2] = board.groups;
    assert.equal(isDecided(g2, undefined), false);
    assert.equal(isDecided(g2, { choice: null, note: '', done: false }), false);
    assert.equal(isDecided(g2, { choice: null, note: '   ' }), false, 'a blank note is not a note');
    assert.equal(isDecided(g2, { choice: null, note: '', done: true }), true);
    assert.equal(isDecided(g2, { choice: null, note: 'wider' }), true);
    assert.equal(isDecided(g1, { choice: 'a', done: true }), true);
    assert.equal(isDecided(g1, { choice: 'gone' }), false, 'a choice the board no longer offers');
    assert.equal(isDecided({ ...g1, pick: 'one' }, { choice: null, done: true }), false, 'done means nothing for a group with options');
    assert.equal(countDecided(board, { groups: { g1: { choice: 'a' }, g2: { done: true } } }), 2);
    assert.equal(firstWords('one two three four five six seven eight'), 'one two three four five six…');
    assert.equal(firstWords('  short note '), 'short note');
  } finally {
    cleanup(dir);
  }
});

test('done: validation, storage, unmarking, and left alone when a body does not mention it', () => {
  const { dir, board } = setup();
  try {
    assert.throws(() => validateGroups(board, body({ g1: { choice: 'a', done: true } })), /only for notes-only/);
    assert.throws(() => validateGroups(board, body({ g2: { done: 'yes' } })), /must be true or false/);
    assert.doesNotThrow(() => validateGroups(board, body({ g1: { choice: 'a', done: false } })));

    const first = saveDecisions(board, body({ g2: { choice: null, note: '', optionNotes: {}, done: true } }), new Date('2026-03-01T10:00:00Z'));
    assert.equal(first.groups.g2.done, true);
    assert.equal(JSON.parse(fs.readFileSync(decisionsFile(board), 'utf8')).groups.g2.done, true);
    assert.equal(lines(board).length, 1);

    // a body without "done" (an assistant editing a note) keeps the mark
    saveDecisions(board, body({ g2: { note: 'text' } }), new Date('2026-03-01T11:00:00Z'));
    assert.equal(readDecisions(board).groups.g2.done, true);
    assert.equal(readDecisions(board).groups.g2.note, 'text');

    // the same save again changes nothing
    saveDecisions(board, body({ g2: { note: 'text', done: true } }), new Date('2026-03-01T12:00:00Z'));
    assert.equal(lines(board).length, 2);

    // unmarking removes the field and counts as a change
    saveDecisions(board, body({ g2: { note: 'text', done: false } }), new Date('2026-03-01T13:00:00Z'));
    assert.equal('done' in readDecisions(board).groups.g2, false);
    assert.equal(lines(board).length, 3);
    assert.equal(lines(board)[0].groups.g2.done, true, 'the history line carries done');

    // a group that is only marked done is not an empty group
    const { dir: d2, board: b2 } = setup();
    try {
      saveDecisions(b2, body({ g2: { done: true } }));
      assert.deepEqual(Object.keys(readDecisions(b2).groups), ['g2']);
    } finally {
      cleanup(d2);
    }
  } finally {
    cleanup(dir);
  }
});

test('submit: stores the submission and one history line, and does not touch the decisions', () => {
  const { dir, board } = setup();
  try {
    saveDecisions(board, body({ g1: { choice: 'a' }, g2: { done: true } }), new Date('2026-03-02T09:00:00Z'));
    const before = readDecisions(board);
    const saved = submitDecisions(board, new Date('2026-03-02T09:30:00Z'));
    assert.deepEqual(saved.submitted, { at: '2026-03-02T09:30:00.000Z', decided: 2, total: 2, groupIds: ['g1', 'g2'] });
    const onDisk = JSON.parse(fs.readFileSync(decisionsFile(board), 'utf8'));
    assert.deepEqual(onDisk.submitted, saved.submitted);
    assert.deepEqual(onDisk.groups, before.groups);
    assert.equal(onDisk.updatedAt, before.updatedAt, 'finishing is not a change to a decision');
    const all = lines(board);
    assert.equal(all.length, 2);
    assert.deepEqual(all[1], { at: '2026-03-02T09:30:00.000Z', event: 'submitted', decided: 2, total: 2 });
    assert.deepEqual(fs.readdirSync(board.dir).filter((f) => f.endsWith('.tmp')), []);
  } finally {
    cleanup(dir);
  }
});

test('submit with undecided groups records how many were decided; an empty board file can be submitted', () => {
  const { dir, board } = setup();
  try {
    const saved = submitDecisions(board, new Date('2026-03-03T09:00:00Z'));
    assert.equal(saved.submitted.decided, 0);
    assert.equal(saved.submitted.total, 2);
    assert.deepEqual(saved.groups, {});
  } finally {
    cleanup(dir);
  }
});

test('state: open, finished, changed (a decision changed, a group was added)', () => {
  const { dir, board } = setup();
  try {
    assert.equal(boardReview(board).state, 'open');
    saveDecisions(board, body({ g1: { choice: 'a' } }), new Date('2026-03-04T09:00:00Z'));
    assert.equal(boardReview(board).state, 'open');
    submitDecisions(board, new Date('2026-03-04T10:00:00Z'));
    assert.deepEqual(boardReview(board), { state: 'finished', decided: 1, total: 2, submitted: readDecisions(board).submitted });

    // a no-op save leaves it finished
    saveDecisions(board, body({ g1: { choice: 'a' } }), new Date('2026-03-04T10:30:00Z'));
    assert.equal(boardReview(board).state, 'finished');

    // a change afterwards
    saveDecisions(board, body({ g1: { choice: 'b' } }), new Date('2026-03-04T11:00:00Z'));
    assert.equal(boardReview(board).state, 'changed');

    // finishing again returns to finished
    submitDecisions(board, new Date('2026-03-04T12:00:00Z'));
    assert.equal(boardReview(board).state, 'finished');

    // clearing a choice is a change too
    saveDecisions(board, body({ g1: { choice: null } }), new Date('2026-03-04T13:00:00Z'));
    assert.equal(boardReview(board).state, 'changed');
    submitDecisions(board, new Date('2026-03-04T14:00:00Z'));

    // marking a notes-only group, then a group added to the board
    saveDecisions(board, body({ g2: { done: true } }), new Date('2026-03-04T15:00:00Z'));
    assert.equal(boardReview(board).state, 'changed');
    submitDecisions(board, new Date('2026-03-04T16:00:00Z'));
    assert.equal(boardReview(board).state, 'finished');
    const more = { ...GOOD_BOARD, groups: [...GOOD_BOARD.groups, { id: 'g3', title: 'Third', options: [{ id: 'p', label: 'P' }] }] };
    writeJson(path.join(dir, 'demo', 'board.json'), more);
    const board2 = loadBoard(dir, 'demo');
    assert.equal(boardReview(board2).state, 'changed', 'a new group appeared since');
    assert.equal(boardReview(board2).total, 3);
    // a group removed from the board is not a change
    writeJson(path.join(dir, 'demo', 'board.json'), { ...GOOD_BOARD, groups: [GOOD_BOARD.groups[0]] });
    assert.equal(boardReview(loadBoard(dir, 'demo')).state, 'finished');
  } finally {
    cleanup(dir);
  }
});

test('state: a damaged submission is ignored and reads as open', () => {
  const { dir, board } = setup();
  try {
    for (const bad of [{ at: 'nope', decided: 1, total: 2, groupIds: [] }, { at: '2026-01-01T00:00:00Z', decided: '1', total: 2, groupIds: [] }, 'x', [], { at: '2026-01-01T00:00:00Z', decided: 1, total: 2, groupIds: [1] }]) {
      writeJson(decisionsFile(board), { board: 'demo', updatedAt: null, groups: {}, submitted: bad });
      assert.equal(readDecisions(board).submitted, undefined);
      assert.equal(reviewState(board, readDecisions(board)), 'open');
    }
  } finally {
    cleanup(dir);
  }
});

test('PUT keeps "submitted" exactly as it was, and a body cannot set or change it', async () => {
  const dir = makeBoards();
  const srv = await startServer(dir);
  const board = loadBoard(dir, 'demo');
  try {
    await putJson(srv.port, '/api/boards/demo/decisions', body({ g1: { choice: 'a' } }));
    const sub = await raw(srv.port, { method: 'POST', path: '/api/boards/demo/submit' });
    assert.equal(sub.status, 200);
    const submitted = sub.json.submitted;
    assert.equal(sub.json.review.state, 'finished');
    const put = await putJson(srv.port, '/api/boards/demo/decisions', { ...body({ g1: { choice: 'b' } }), submitted: { at: '2020-01-01T00:00:00.000Z', decided: 9, total: 9, groupIds: [] } });
    assert.equal(put.status, 200);
    assert.deepEqual(put.json.submitted, submitted);
    assert.equal(put.json.review.state, 'changed');
    assert.deepEqual(readDecisions(board).submitted, submitted);
    assert.deepEqual(JSON.parse(fs.readFileSync(decisionsFile(board), 'utf8')).submitted, submitted);
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

test('over HTTP: review is in the list, the decisions and the save answer; submit has the PUT safety rules', async () => {
  const dir = makeBoards();
  const srv = await startServer(dir);
  try {
    const open = (await raw(srv.port, { path: '/api/boards' })).json.find((b) => b.id === 'demo');
    assert.deepEqual(open.review, { state: 'open', decided: 0, total: 2, submitted: null });
    const put = await putJson(srv.port, '/api/boards/demo/decisions', body({ g1: { choice: 'a' }, g2: { note: 'hm' } }));
    assert.deepEqual(put.json.review, { state: 'open', decided: 2, total: 2, submitted: null });
    assert.equal((await raw(srv.port, { path: '/api/boards' })).json.find((b) => b.id === 'demo').decided, 2, 'the list reads the file on every request');

    // the Origin rule
    const foreign = await raw(srv.port, { method: 'POST', path: '/api/boards/demo/submit', headers: { Origin: 'http://evil.example' } });
    assert.equal(foreign.status, 403);
    assert.equal((await raw(srv.port, { path: '/api/boards/demo/decisions' })).json.submitted, undefined, 'a refused submit changed nothing');
    // a foreign Host is refused too
    assert.equal((await raw(srv.port, { method: 'POST', path: '/api/boards/demo/submit', headers: { Host: 'evil.example' } })).status, 421);
    assert.equal((await raw(srv.port, { method: 'GET', path: '/api/boards/demo/submit' })).status, 405);
    assert.equal((await raw(srv.port, { method: 'POST', path: '/api/boards/nope/submit' })).status, 404);

    const own = await raw(srv.port, { method: 'POST', path: '/api/boards/demo/submit', headers: { Origin: `http://${srv.host}` } });
    assert.equal(own.status, 200);
    assert.equal(own.json.review.state, 'finished');
    assert.equal(own.json.review.decided, 2);
    assert.equal(own.json.review.submitted.total, 2);
    assert.deepEqual((await raw(srv.port, { path: '/api/boards/demo/decisions' })).json.review, own.json.review);
    const row = (await raw(srv.port, { path: '/api/boards' })).json.find((b) => b.id === 'demo');
    assert.equal(row.review.state, 'finished');
    assert.equal((await raw(srv.port, { path: '/api/boards' })).json.find((b) => b.id === 'other').review.state, 'open');
  } finally {
    await srv.close();
    cleanup(dir);
  }
});
