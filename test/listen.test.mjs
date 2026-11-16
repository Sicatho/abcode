import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadBoard } from '../lib/boards.mjs';
import { saveDecisions, submitDecisions, readDecisions } from '../lib/decisions.mjs';
import { receiptFile, listenerFile, buildDigest, formatDigest, statusOf } from '../lib/listen.mjs';
import { makeBoards, writeJson, cleanup, startServer, raw } from './helpers.mjs';

const WAIT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'wait.mjs');

function setup() {
  const dir = makeBoards();
  return { dir, board: loadBoard(dir, 'demo') };
}

/** Runs bin/wait.mjs. Returns { child, done } where done resolves to { code, out, err }. */
function run(dir, args = []) {
  const child = spawn(process.execPath, [WAIT, '--board', 'demo', '--boards', dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (err += c));
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, out, err })));
  return { child, done };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(40);
  }
  return false;
}
const finishWith = (board, groups = { g1: { choice: 'b', note: 'Bigger please', optionNotes: { a: 'too small' } }, g2: { note: 'fine', done: true } }) => {
  saveDecisions(board, { board: 'demo', groups });
  return submitDecisions(board);
};

test('wait: waits, then reports the digest once the review is finished, and writes the receipt', async () => {
  const { dir, board } = setup();
  try {
    const { done } = run(dir);
    assert.ok(await until(() => fs.existsSync(listenerFile(board))), 'the heartbeat appears while waiting');
    await sleep(700);
    finishWith(board);
    const { code, out, err } = await done;
    assert.equal(err, '');
    assert.equal(code, 0);
    assert.match(out, /Review finished: Demo \(board demo\)/);
    assert.match(out, /2 of 2 decided/);
    assert.match(out, /1\. First \(g1\)\n {3}Chosen: B \(b\)/);
    assert.match(out, /Note:\n {5}Bigger please/);
    assert.match(out, /Note on A \(a\):\n {5}too small/);
    assert.match(out, /2\. Second \(g2\)\n {3}Looked at/);
    assert.ok(out.trim().endsWith(path.resolve(dir, 'demo', 'decisions.json')), 'ends with the absolute path of the decisions file');
    const receipt = JSON.parse(fs.readFileSync(receiptFile(board), 'utf8'));
    assert.equal(receipt.submittedAt, JSON.parse(fs.readFileSync(path.join(dir, 'demo', 'decisions.json'), 'utf8')).submitted.at);
    assert.ok(!Number.isNaN(Date.parse(receipt.reportedAt)));
    assert.ok(!fs.existsSync(listenerFile(board)), 'the heartbeat is removed on exit');
  } finally {
    cleanup(dir);
  }
});

test('wait: a finish nobody was waiting for is reported at once, and only once', async () => {
  const { dir, board } = setup();
  try {
    finishWith(board);
    const first = await run(dir, ['--timeout', '5']).done;
    assert.equal(first.code, 0);
    assert.match(first.out, /Chosen: B \(b\)/);
    assert.ok(!fs.existsSync(listenerFile(board)), 'no heartbeat is needed when it reports at once');
    const second = await run(dir, ['--timeout', '0.8']).done;
    assert.equal(second.code, 2, 'the same submission is not reported again');
    assert.doesNotMatch(second.out, /Review finished/);
    // a new finish after the first one is reported
    await sleep(15);
    submitDecisions(board);
    const third = await run(dir, ['--timeout', '5']).done;
    assert.equal(third.code, 0);
  } finally {
    cleanup(dir);
  }
});

test('wait: --timeout prints one line and exits with 2', async () => {
  const { dir, board } = setup();
  try {
    const { code, out, err } = await run(dir, ['--timeout', '0.6']).done;
    assert.equal(code, 2);
    assert.equal(err, '');
    assert.equal(out.trim().split('\n').length, 1);
    assert.match(out, /No finished review for board "demo" after 0\.6 seconds\./);
    assert.ok(!fs.existsSync(listenerFile(board)));
  } finally {
    cleanup(dir);
  }
});

test('wait: --json prints one object with the same content', async () => {
  const { dir, board } = setup();
  try {
    finishWith(board, { g1: { choice: 'a', note: '', optionNotes: {} } });
    const { code, out } = await run(dir, ['--json']).done;
    assert.equal(code, 0);
    const d = JSON.parse(out);
    assert.deepEqual(d.board, { id: 'demo', title: 'Demo' });
    assert.equal(d.decided, 1);
    assert.equal(d.total, 2);
    assert.match(d.finishedAt, /^\d{4}-\d\d-\d\dT/);
    assert.equal(d.decisionsFile, path.resolve(dir, 'demo', 'decisions.json'));
    assert.equal(d.groups.length, 2);
    assert.deepEqual(d.groups[0].choice, { id: 'a', label: 'A' });
    assert.equal(d.groups[0].status, 'chosen');
    assert.equal(d.groups[1].status, 'undecided');
    assert.deepEqual(d.removedGroups, []);
  } finally {
    cleanup(dir);
  }
});

test('digest: undecided groups, groups and options the board no longer has are marked', () => {
  const { dir, board } = setup();
  try {
    writeJson(path.join(dir, 'demo', 'decisions.json'), {
      board: 'demo',
      updatedAt: '2026-01-01T00:00:00.000Z',
      groups: {
        g1: { choice: 'old-option', note: '', optionNotes: { 'old-option': 'liked it' }, updatedAt: '2026-01-01T00:00:00.000Z' },
        removed: { choice: 'z', note: 'was here', optionNotes: {}, updatedAt: '2026-01-01T00:00:00.000Z' },
      },
      submitted: { at: '2026-01-02T00:00:00.000Z', decided: 0, total: 2, groupIds: ['g1', 'g2'] },
    });
    const digest = buildDigest(board, readDecisions(board));
    assert.equal(digest.groups[0].status, 'undecided');
    assert.equal(digest.groups[0].removedChoice, 'old-option');
    assert.deepEqual(digest.groups[0].removedOptionNotes, [{ id: 'old-option', note: 'liked it' }]);
    assert.equal(digest.removedGroups[0].id, 'removed');
    const text = formatDigest(digest);
    assert.match(text, /Stored choice "old-option" is no longer an option on the board\./);
    assert.match(text, /Note on option old-option \(no longer on the board\):/);
    assert.match(text, /- removed \(no longer on the board\) chose z/);
    assert.match(text, /0 of 2 decided/);
  } finally {
    cleanup(dir);
  }
});

test('wait: the heartbeat has pid, startedAt and beatAt, is rewritten, and goes away on Ctrl-C style exit', async () => {
  const { dir, board } = setup();
  try {
    const { child, done } = run(dir);
    assert.ok(await until(() => fs.existsSync(listenerFile(board))));
    const a = JSON.parse(fs.readFileSync(listenerFile(board), 'utf8'));
    assert.equal(a.pid, child.pid);
    assert.ok(Date.parse(a.startedAt) && Date.parse(a.beatAt));
    assert.ok(await until(() => JSON.parse(fs.readFileSync(listenerFile(board), 'utf8')).beatAt !== a.beatAt, 4500), 'beatAt moves every couple of seconds');
    child.kill('SIGTERM');
    await done;
    // On Windows a kill ends the process without handlers; on other systems the handler removes the file.
    if (process.platform !== 'win32') assert.ok(!fs.existsSync(listenerFile(board)), 'removed after a signal');
  } finally {
    cleanup(dir);
  }
});

test('wait: a missing board, an unreadable board.json and bad options exit with 1 and one sentence on stderr', async () => {
  const { dir } = setup();
  try {
    const missing = await new Promise((resolve) => {
      const c = spawn(process.execPath, [WAIT, '--board', 'nope', '--boards', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      c.stderr.on('data', (d) => (err += d));
      c.on('close', (code) => resolve({ code, err }));
    });
    assert.equal(missing.code, 1);
    assert.match(missing.err, /There is no board called "nope"/);
    fs.writeFileSync(path.join(dir, 'demo', 'board.json'), '{ not json');
    const bad = await run(dir).done;
    assert.equal(bad.code, 1);
    assert.match(bad.err, /is not valid JSON/);
    assert.equal(bad.out, '');
    const noBoard = await new Promise((resolve) => {
      const c = spawn(process.execPath, [WAIT, '--boards', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      c.stderr.on('data', (d) => (err += d));
      c.on('close', (code) => resolve({ code, err }));
    });
    assert.equal(noBoard.code, 1);
    assert.match(noBoard.err, /--board/);
  } finally {
    cleanup(dir);
  }
});

test('wait: --help prints usage and exits with 0', async () => {
  const out = await new Promise((resolve) => {
    const c = spawn(process.execPath, [WAIT, '--help'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let s = '';
    c.stdout.on('data', (d) => (s += d));
    c.on('close', (code) => resolve({ code, s }));
  });
  assert.equal(out.code, 0);
  assert.match(out.s, /Usage: abcode-wait --board <id>/);
  assert.match(out.s, /Exit codes/);
});

test('status endpoint: state, submission, listening (heartbeat younger than 6 seconds) and received', async () => {
  const { dir, board } = setup();
  const srv = await startServer(dir);
  try {
    let r = await raw(srv.port, { path: '/api/boards/demo/status' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { state: 'open', submitted: null, listening: false, received: false });

    // a fresh heartbeat
    writeJson(listenerFile(board), { pid: 1, startedAt: new Date().toISOString(), beatAt: new Date().toISOString() });
    r = await raw(srv.port, { path: '/api/boards/demo/status' });
    assert.equal(r.json.listening, true);
    // an old one
    writeJson(listenerFile(board), { pid: 1, startedAt: '2020-01-01T00:00:00.000Z', beatAt: new Date(Date.now() - 7000).toISOString() });
    r = await raw(srv.port, { path: '/api/boards/demo/status' });
    assert.equal(r.json.listening, false);
    // a damaged one
    fs.writeFileSync(listenerFile(board), '{{');
    assert.equal((await raw(srv.port, { path: '/api/boards/demo/status' })).json.listening, false);

    const saved = finishWith(board);
    r = await raw(srv.port, { path: '/api/boards/demo/status' });
    assert.equal(r.json.state, 'finished');
    assert.equal(r.json.submitted.at, saved.submitted.at);
    assert.equal(r.json.received, false);

    writeJson(receiptFile(board), { submittedAt: saved.submitted.at, reportedAt: new Date().toISOString() });
    assert.equal((await raw(srv.port, { path: '/api/boards/demo/status' })).json.received, true);

    // a receipt for an earlier finish does not count for a later one
    await sleep(15);
    const again = submitDecisions(board);
    r = await raw(srv.port, { path: '/api/boards/demo/status' });
    assert.equal(r.json.submitted.at, again.submitted.at);
    assert.equal(r.json.received, false);

    assert.equal((await raw(srv.port, { path: '/api/boards/nope/status' })).status, 404);
    assert.equal((await raw(srv.port, { method: 'POST', path: '/api/boards/demo/status' })).status, 405);
    assert.deepEqual(statusOf(board).received, false);
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

test('wait and status work together: a waiting command shows as listening, then the receipt shows as received', async () => {
  const { dir, board } = setup();
  const srv = await startServer(dir);
  try {
    const { done } = run(dir);
    assert.ok(await until(() => fs.existsSync(listenerFile(board))));
    assert.equal((await raw(srv.port, { path: '/api/boards/demo/status' })).json.listening, true);
    const saved = finishWith(board);
    const res = await done;
    assert.equal(res.code, 0);
    const s = (await raw(srv.port, { path: '/api/boards/demo/status' })).json;
    assert.equal(s.listening, false);
    assert.equal(s.received, true);
    assert.equal(s.submitted.at, saved.submitted.at);
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

test('digest: when decisions changed after the finish, both counts are given and the header is not stale', () => {
  const { dir, board } = setup();
  try {
    const optionId = board.groups[0].options[0].id;
    writeJson(path.join(dir, 'demo', 'decisions.json'), {
      board: 'demo',
      updatedAt: '2026-01-03T00:00:00.000Z',
      groups: { g1: { choice: optionId, note: '', optionNotes: {}, updatedAt: '2026-01-03T00:00:00.000Z' } },
      submitted: { at: '2026-01-02T00:00:00.000Z', decided: 0, total: 2, groupIds: ['g1', 'g2'] },
    });
    const digest = buildDigest(board, readDecisions(board));
    assert.equal(digest.state, 'changed');
    assert.deepEqual([digest.decided, digest.total], [1, 2]);
    assert.deepEqual(digest.atFinish, { decided: 0, total: 2 });
    const text = formatDigest(digest);
    assert.match(text, /At the finish: 0 of 2 decided\. Now: 1 of 2 decided\./);
    assert.doesNotMatch(text, /^0 of 2 decided$/m);
  } finally {
    cleanup(dir);
  }
});
