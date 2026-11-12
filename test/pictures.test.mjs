import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadBoard } from '../lib/boards.mjs';
import { readDecisions, saveDecisions, historyFile } from '../lib/decisions.mjs';
import { addPicture, removePicture, sniffPicture, listedPictureFile, MAX_PICTURES, MAX_PICTURE_BYTES } from '../lib/pictures.mjs';
import { buildDigest, formatDigest, statusOf } from '../lib/listen.mjs';
import { isDecided, countDecided } from '../app/js/lib/rules.js';
import { makeBoards, cleanup, startServer, raw } from './helpers.mjs';

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('0000000d49484452', 'hex'), Buffer.alloc(20, 7)]);
const JPG = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(30, 1)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(30, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([30, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(30, 3)]);
const CTX = { option: 'b', viewport: 'phone', mode: 'live' };

function setup() {
  const dir = makeBoards();
  return { dir, board: loadBoard(dir, 'demo') };
}
const lines = (board) => fs.readFileSync(historyFile(board), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const post = (srv, gid, body, headers = {}, q = '?option=b&viewport=phone&mode=live') =>
  raw(srv.port, { method: 'POST', path: `/api/boards/demo/groups/${gid}/pictures${q}`, headers: { 'Content-Type': 'image/png', ...headers }, body });

test('the kind of a picture comes from its first bytes', () => {
  assert.equal(sniffPicture(PNG).ext, 'png');
  assert.equal(sniffPicture(JPG).ext, 'jpg');
  assert.equal(sniffPicture(GIF).ext, 'gif');
  assert.equal(sniffPicture(WEBP).ext, 'webp');
  assert.equal(sniffPicture(Buffer.from('this is text, not a picture at all')), null);
  assert.equal(sniffPicture(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffPicture(Buffer.alloc(0)), null);
});

test('adding a picture: file named by the server, entry with context, updatedAt and a history line', () => {
  const { dir, board } = setup();
  try {
    const now = new Date('2026-11-11T16:32:10.000Z');
    const { decision, picture } = addPicture(board, 'g1', PNG, CTX, now);
    assert.match(picture.file, /^pictures\/g1\/20261111-163210-[0-9a-f]{4}\.png$/);
    assert.deepEqual({ ...picture, file: 'x' }, { file: 'x', addedAt: now.toISOString(), bytes: PNG.length, option: 'b', viewport: 'phone', mode: 'live' });
    assert.ok(fs.readFileSync(path.join(board.dir, picture.file)).equals(PNG));
    assert.deepEqual(fs.readdirSync(path.join(board.dir, 'pictures', 'g1')), [path.basename(picture.file)]); // no temporary file left
    assert.equal(decision.updatedAt, now.toISOString());
    const stored = readDecisions(board);
    assert.equal(stored.updatedAt, now.toISOString());
    assert.deepEqual(stored.groups.g1.pictures, [picture]);
    const h = lines(board);
    assert.equal(h.length, 1);
    assert.equal(h[0].groups.g1.pictures.length, 1);
  } finally {
    cleanup(dir);
  }
});

test('a decision with only a picture is stored; context the board does not know is dropped', () => {
  const { dir, board } = setup();
  try {
    const { decision } = addPicture(board, 'g2', JPG, { option: 'nope', viewport: '../../x', mode: 'weird' });
    assert.equal(decision.choice, null);
    assert.equal(decision.note, '');
    assert.equal(decision.pictures.length, 1);
    assert.equal(decision.pictures[0].option, '');
    assert.equal(decision.pictures[0].viewport, '');
    assert.equal(decision.pictures[0].mode, '');
    assert.match(decision.pictures[0].file, /\.jpg$/);
  } finally {
    cleanup(dir);
  }
});

test('ordinary saves never drop or change the pictures', () => {
  const { dir, board } = setup();
  try {
    const { picture } = addPicture(board, 'g1', PNG, CTX, new Date('2026-11-11T10:00:00Z'));
    saveDecisions(board, { board: 'demo', groups: { g1: { choice: 'a', note: 'bigger', optionNotes: {} } } });
    assert.deepEqual(readDecisions(board).groups.g1.pictures, [picture]);
    // a page that sends pictures of its own is not believed
    saveDecisions(board, { board: 'demo', groups: { g1: { choice: 'a', note: 'bigger!', optionNotes: {}, pictures: [{ file: '../../etc/passwd' }] } } });
    assert.deepEqual(readDecisions(board).groups.g1.pictures, [picture]);
    // clearing everything the page owns keeps the picture too
    saveDecisions(board, { board: 'demo', groups: { g1: { choice: null, note: '', optionNotes: {} } } });
    const g = readDecisions(board).groups.g1;
    assert.deepEqual(g.pictures, [picture]);
    assert.equal(g.note, '');
  } finally {
    cleanup(dir);
  }
});

test('removing a picture: entry and file go, history line, updatedAt moves; an emptied decision is not kept', () => {
  const { dir, board } = setup();
  try {
    const a = addPicture(board, 'g1', PNG, CTX, new Date('2026-11-11T10:00:00Z')).picture;
    const b = addPicture(board, 'g1', GIF, CTX, new Date('2026-11-11T10:00:05Z')).picture;
    saveDecisions(board, { board: 'demo', groups: { g1: { choice: 'a', note: 'x', optionNotes: {} } } });
    const before = lines(board).length;
    const out = removePicture(board, 'g1', path.basename(a.file), new Date('2026-11-11T11:00:00Z'));
    assert.deepEqual(out.decision.pictures, [b]);
    assert.equal(out.decision.updatedAt, '2026-11-11T11:00:00.000Z');
    assert.equal(fs.existsSync(path.join(board.dir, a.file)), false);
    assert.equal(fs.existsSync(path.join(board.dir, b.file)), true);
    assert.equal(lines(board).length, before + 1);
    removePicture(board, 'g1', path.basename(b.file));
    assert.equal(readDecisions(board).groups.g1.pictures, undefined);
    assert.equal(readDecisions(board).groups.g1.note, 'x');
    // a decision that held nothing but a picture disappears with it
    const only = addPicture(board, 'g2', JPG, CTX).picture;
    removePicture(board, 'g2', path.basename(only.file));
    assert.equal(readDecisions(board).groups.g2, undefined);
  } finally {
    cleanup(dir);
  }
});

test('the limits: 12 per decision, 10 MB each', () => {
  const { dir, board } = setup();
  try {
    for (let i = 0; i < MAX_PICTURES; i++) addPicture(board, 'g1', PNG, CTX, new Date(Date.UTC(2026, 10, 11, 10, 0, i)));
    assert.throws(() => addPicture(board, 'g1', PNG, CTX), (e) => e.status === 409 && /12 pictures/.test(e.message));
    assert.equal(readDecisions(board).groups.g1.pictures.length, 12);
    assert.equal(fs.readdirSync(path.join(board.dir, 'pictures', 'g1')).length, 12);
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_PICTURE_BYTES)]);
    assert.throws(() => addPicture(board, 'g2', big, CTX), (e) => e.status === 413 && /10 MB/.test(e.message));
    assert.equal(fs.existsSync(path.join(board.dir, 'pictures', 'g2')), false);
  } finally {
    cleanup(dir);
  }
});

test('validation: unknown decision, text that says it is a picture, path tricks in the id and the name', () => {
  const { dir, board } = setup();
  try {
    assert.throws(() => addPicture(board, 'nope', PNG, CTX), (e) => e.status === 404 && /not on board/.test(e.message));
    for (const bad of ['../g1', '..', 'g1/../g1', 'g1\\x', '', null, undefined, 'G1']) {
      assert.throws(() => addPicture(board, bad, PNG, CTX), (e) => e.status === 404, String(bad));
    }
    assert.throws(() => addPicture(board, 'g1', Buffer.from('just some text pretending to be a picture'), CTX), (e) => e.status === 415);
    assert.equal(fs.existsSync(path.join(board.dir, 'pictures')), false);
    const p = addPicture(board, 'g1', PNG, CTX).picture;
    for (const bad of ['../../board.json', '..', '20261111-163210-ab12.png', path.basename(p.file) + '/..', 'board.json']) {
      assert.throws(() => removePicture(board, 'g1', bad), (e) => e.status === 404, bad);
    }
    assert.equal(fs.existsSync(path.join(board.dir, 'board.json')), true);
    assert.equal(listedPictureFile(board, 'g1', '../../board.json'), null);
    assert.equal(listedPictureFile(board, 'g2', path.basename(p.file)), null); // listed for another decision only
    assert.ok(listedPictureFile(board, 'g1', path.basename(p.file)));
  } finally {
    cleanup(dir);
  }
});

test('http: add, read back with the right type and nosniff, remove', async () => {
  const { dir, board } = setup();
  const srv = await startServer(dir);
  try {
    const r = await post(srv, 'g1', PNG);
    assert.equal(r.status, 200);
    const pic = r.json.decision.pictures[0];
    assert.equal(pic.option, 'b');
    assert.equal(pic.viewport, 'phone');
    assert.equal(pic.mode, 'live');
    assert.ok(r.json.updatedAt);
    const name = path.basename(pic.file);
    const get = await raw(srv.port, { path: `/api/boards/demo/groups/g1/pictures/${name}` });
    assert.equal(get.status, 200);
    assert.equal(get.headers['content-type'], 'image/png');
    assert.equal(get.headers['x-content-type-options'], 'nosniff');
    assert.ok(get.buf.equals(PNG));
    // the same name under another decision, or one not listed: 404
    assert.equal((await raw(srv.port, { path: `/api/boards/demo/groups/g2/pictures/${name}` })).status, 404);
    assert.equal((await raw(srv.port, { path: '/api/boards/demo/groups/g1/pictures/20200101-000000-0000.png' })).status, 404);
    assert.equal((await raw(srv.port, { path: '/api/boards/demo/groups/g1/pictures/..%2f..%2fboard.json' })).status, 404);
    const del = await raw(srv.port, { method: 'DELETE', path: `/api/boards/demo/groups/g1/pictures/${name}` });
    assert.equal(del.status, 200);
    assert.equal(fs.existsSync(path.join(board.dir, pic.file)), false);
    assert.equal((await raw(srv.port, { method: 'DELETE', path: `/api/boards/demo/groups/g1/pictures/${name}` })).status, 404);
    assert.equal((await raw(srv.port, { path: `/api/boards/demo/groups/g1/pictures/${name}` })).status, 404);
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

test('http: the type is decided by the bytes, a header that lies does not help, the guards of the write routes apply', async () => {
  const { dir } = setup();
  const srv = await startServer(dir);
  try {
    const lying = await post(srv, 'g1', Buffer.from('<script>alert(1)</script> plainly not a picture'));
    assert.equal(lying.status, 415);
    assert.match(lying.json.error, /not a PNG, JPEG, WebP or GIF/);
    // a JPEG sent under a PNG header is stored as what it is
    const jpg = await post(srv, 'g1', JPG);
    assert.match(jpg.json.decision.pictures[0].file, /\.jpg$/);
    assert.equal((await post(srv, 'g1', PNG, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post(srv, 'g1', PNG, { 'Content-Type': 'application/json' })).status, 415);
    assert.equal((await post(srv, 'nope', PNG)).status, 404);
    assert.equal((await raw(srv.port, { method: 'POST', path: '/api/boards/zzz/groups/g1/pictures', headers: { 'Content-Type': 'image/png' }, body: PNG })).status, 404);
    // another web page may not add or remove
    assert.equal((await post(srv, 'g1', PNG, { Origin: 'http://evil.example' })).status, 403);
    const name = path.basename(jpg.json.decision.pictures[0].file);
    assert.equal((await raw(srv.port, { method: 'DELETE', path: `/api/boards/demo/groups/g1/pictures/${name}`, headers: { Origin: 'http://evil.example' } })).status, 403);
    assert.equal((await raw(srv.port, { method: 'POST', path: '/api/boards/demo/groups/g1/pictures', headers: { 'Content-Type': 'image/png', Host: 'evil.example' }, body: PNG })).status, 421);
    // too large: refused by the declared length and by what actually arrives
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_PICTURE_BYTES + 10)]);
    const large = await post(srv, 'g1', big);
    assert.equal(large.status, 413);
    assert.match(large.json.error, /10 MB/);
    // the 64 KB cap of the JSON routes stays
    const json = await raw(srv.port, { method: 'PUT', path: '/api/boards/demo/decisions', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board: 'demo', groups: {}, pad: 'x'.repeat(70 * 1024) }) });
    assert.equal(json.status, 413);
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

test('http: the twelve-picture limit answers 409 with words', async () => {
  const { dir } = setup();
  const srv = await startServer(dir);
  try {
    for (let i = 0; i < MAX_PICTURES; i++) assert.equal((await post(srv, 'g1', PNG)).status, 200);
    const r = await post(srv, 'g1', PNG);
    assert.equal(r.status, 409);
    assert.match(r.json.error, /12 pictures/);
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

test('the digest lists the picture files with absolute paths and what was showing; a picture alone counts as a note', () => {
  const { dir, board } = setup();
  try {
    const { picture } = addPicture(board, 'g2', PNG, { option: 'x', viewport: 'phone', mode: 'shots' }, new Date('2026-11-11T16:32:10Z'));
    addPicture(board, 'g1', JPG, CTX, new Date('2026-11-11T16:32:11Z'));
    const stored = readDecisions(board);
    const digest = buildDigest(board, stored);
    const g2 = digest.groups.find((g) => g.id === 'g2');
    assert.equal(g2.status, 'noted');
    const abs = path.resolve(board.dir, picture.file).replace(/\\/g, '/');
    assert.equal(g2.pictures[0].file, abs);
    assert.ok(!g2.pictures[0].file.includes('\\'));
    assert.ok(path.isAbsolute(g2.pictures[0].file));
    const text = formatDigest(digest);
    assert.match(text, /pictures \(open each file to see it\):/);
    assert.ok(text.includes(`     ${abs}  (added while "X" was showing, Phone, photographs)`), text);
    assert.match(text, /\(added while "B" was showing, Phone, live\)/);
    // the status carries the count
    assert.equal(statusOf(board).pictures, 2);
  } finally {
    cleanup(dir);
  }
});

test('the rule: for a notes-only decision a picture counts like a note; options still need a choice', () => {
  const { dir, board } = setup();
  try {
    const notes = board.groups.find((g) => g.id === 'g2');
    const opts = board.groups.find((g) => g.id === 'g1');
    assert.equal(isDecided(notes, { choice: null, note: '', optionNotes: {} }), false);
    assert.equal(isDecided(notes, { choice: null, note: '', optionNotes: {}, pictures: [] }), false);
    assert.equal(isDecided(notes, { choice: null, note: '', optionNotes: {}, pictures: [{ file: 'pictures/g2/x.png' }] }), true);
    assert.equal(isDecided(opts, { choice: null, note: 'text', optionNotes: {}, pictures: [{ file: 'pictures/g1/x.png' }] }), false);
    addPicture(board, 'g2', PNG, CTX);
    addPicture(board, 'g1', PNG, CTX);
    assert.equal(countDecided(board, readDecisions(board)), 1);
  } finally {
    cleanup(dir);
  }
});

test('with the picture overlay open the page shortcuts take no key (c, j, digits)', async () => {
  const calls = [];
  const listeners = [];
  const el = () => ({ addEventListener() {}, append() {}, remove() {}, focus() {}, setAttribute() {}, getAttribute() { return null; }, querySelectorAll() { return []; }, addEventListener() {}, classList: { add() {}, remove() {} }, style: {} });
  globalThis.document = { addEventListener: (t, f, c) => { if (!c) listeners.push(f); }, removeEventListener() {}, getElementById: () => el(), createElement: el, createTextNode: () => el(), body: el(), querySelector: () => null, contains: () => false, activeElement: null };
  globalThis.Node = class {};
  globalThis.CSS = { escape: (x) => x };
  globalThis.window = globalThis.window || { addEventListener() {}, location: { hash: '' }, localStorage: undefined };
  const keys = await import('../app/js/keys.js');
  const pics = await import('../app/js/views/pictures.js');
  keys.installKeys();
  assert.equal(pics.isPictureOpen(), false);
  pics.openPicture([{ src: 'x.png', n: 1, total: 1, key: 'k' }], 0, null);
  assert.equal(pics.isPictureOpen(), true);
  const ev = (key) => ({ key, defaultPrevented: false, target: el(), preventDefault() { calls.push(key); } });
  for (const k of ['?', 'c', 'j', 'k', '1', 'v', 'l', 'p', 's', 'ArrowDown']) listeners.forEach((f) => f(ev(k)));
  assert.deepEqual(calls, []);
  pics.closePicture(false);
  assert.equal(pics.isPictureOpen(), false);
});
