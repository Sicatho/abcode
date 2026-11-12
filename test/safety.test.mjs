import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { makeBoards, cleanup, startServer, raw, putJson } from './helpers.mjs';

const decisionsPath = (dir) => path.join(dir, 'demo', 'decisions.json');
const sessionUrl = (id) => `/api/boards/demo/session/${id}`;

// ---------- sessions ----------
test('session: sets the cookie from the file, strips the prefix, never puts the value in the body', async () => {
  const dir = makeBoards();
  const srv = await startServer(dir);
  try {
    const r = await raw(srv.port, { method: 'POST', path: sessionUrl('user'), headers: { Host: '127.0.0.1:4600' } });
    assert.equal(r.status, 204);
    assert.equal(r.text, '');
    assert.deepEqual(r.headers['set-cookie'], ['app_session=abc123XYZ; Path=/; HttpOnly; SameSite=Lax']);
    assert.ok(!/domain/i.test(r.headers['set-cookie'][0]), 'no Domain attribute');
    assert.ok(!r.headers['set-cookie'][0].includes('app_session=app_session='), 'prefix stripped');
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

test('session: clear answers with Max-Age=0 for every named cookie', async () => {
  const dir = makeBoards();
  const srv = await startServer(dir);
  try {
    const r = await raw(srv.port, { method: 'POST', path: sessionUrl('out'), headers: { Host: '127.0.0.1:4600' } });
    assert.equal(r.status, 204);
    assert.deepEqual(r.headers['set-cookie'], ['app_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax', 'other_cookie=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax']);
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

test('session: the request host must be a loopback address equal to the target host name', async () => {
  const dir = makeBoards();
  const srv = await startServer(dir);
  try {
    for (const host of ['127.0.0.2:4600', '[::1]:4600']) {
      for (const id of ['user', 'out']) {
        const r = await raw(srv.port, { method: 'POST', path: sessionUrl(id), headers: { Host: host } });
        assert.equal(r.status, 409, `${host} ${id}`);
        assert.match(r.json.error, /share one host name/);
        assert.match(r.json.error, /http:\/\/127\.0\.0\.1:4600\//, 'says which address to open, with the real port');
        assert.ok(!r.json.error.includes('<this port>'));
        assert.ok(!r.headers['set-cookie'], 'no cookie on a refusal');
        assert.ok(!r.text.includes('abc123XYZ'), 'no value in the body');
      }
    }
    assert.equal((await raw(srv.port, { method: 'POST', path: sessionUrl('out'), headers: { Host: '127.0.0.1' } })).status, 204, 'no port is fine');
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

test('session: missing file, missing path and unknown session give clear 404s', async () => {
  const dir = makeBoards();
  const srv = await startServer(dir);
  try {
    const gone = await raw(srv.port, { method: 'POST', path: sessionUrl('gone') });
    assert.equal(gone.status, 404);
    assert.match(gone.json.error, /missing\.json/);
    const nopath = await raw(srv.port, { method: 'POST', path: sessionUrl('nopath') });
    assert.equal(nopath.status, 404);
    assert.match(nopath.json.error, /accounts\.nobody\.cookie/);
    const nope = await raw(srv.port, { method: 'POST', path: sessionUrl('zzz') });
    assert.equal(nope.status, 404);
    for (const r of [gone, nopath, nope]) assert.ok(!r.headers['set-cookie'] && !r.text.includes('abc123XYZ'));
    assert.equal((await raw(srv.port, { method: 'POST', path: '/api/boards/nope/session/user' })).status, 404);
    assert.equal((await raw(srv.port, { method: 'GET', path: sessionUrl('user') })).status, 405);
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

test('session: a value that is not a safe cookie value is refused', async () => {
  const dir = makeBoards();
  fs.writeFileSync(path.join(dir, 'demo', 'accounts.json'), JSON.stringify({ accounts: { user: { cookie: 'app_session=bad; Path=/evil' } } }));
  const srv = await startServer(dir);
  try {
    const r = await raw(srv.port, { method: 'POST', path: sessionUrl('user') });
    assert.equal(r.status, 500);
    assert.ok(!r.headers['set-cookie']);
    assert.ok(!r.text.includes('evil'));
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

// ---------- the Origin rule ----------
test('Origin rule: PUT and POST from another origin are refused and change nothing', async () => {
  const dir = makeBoards();
  const srv = await startServer(dir);
  try {
    const good = { board: 'demo', groups: { g1: { choice: 'a' } } };
    for (const origin of ['http://evil.example', 'http://127.0.0.1:1', `http://localhost:${srv.port}`, 'null', 'https://127.0.0.1:' + srv.port, `http://127.0.0.1:${srv.port}.evil.test`]) {
      const put = await putJson(srv.port, '/api/boards/demo/decisions', good, { Origin: origin });
      assert.equal(put.status, 403, `PUT from ${origin}`);
      assert.match(put.json.error, /another web page/);
      const post = await raw(srv.port, { method: 'POST', path: sessionUrl('user'), headers: { Origin: origin } });
      assert.equal(post.status, 403, `POST from ${origin}`);
      assert.ok(!post.headers['set-cookie']);
    }
    assert.ok(!fs.existsSync(decisionsPath(dir)), 'nothing was written');
    const own = await putJson(srv.port, '/api/boards/demo/decisions', good, { Origin: `http://127.0.0.1:${srv.port}` });
    assert.equal(own.status, 200);
    const noOrigin = await putJson(srv.port, '/api/boards/demo/decisions', good);
    assert.equal(noOrigin.status, 200, 'no Origin header (a script, curl) is allowed');
    const ownPost = await raw(srv.port, { method: 'POST', path: sessionUrl('out'), headers: { Origin: `http://127.0.0.1:${srv.port}`, Host: `127.0.0.1:${srv.port}` } });
    assert.equal(ownPost.status, 204);
    // GET requests are not restricted by Origin
    assert.equal((await raw(srv.port, { path: '/api/boards', headers: { Origin: 'http://evil.example' } })).status, 200);
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

// ---------- localhost redirect ----------
test('Host "localhost:<port>" is redirected to 127.0.0.1 with the same path and query', async () => {
  const dir = makeBoards();
  const srv = await startServer(dir);
  try {
    for (const p of ['/', '/b/demo/g/g1?o=a&v=phone', '/api/boards', '/boards/demo/assets/shots/a.png']) {
      const r = await raw(srv.port, { path: p, headers: { Host: `localhost:${srv.port}` } });
      assert.equal(r.status, 302, p);
      assert.equal(r.headers.location, `http://127.0.0.1:${srv.port}${p}`);
    }
    const upper = await raw(srv.port, { path: '/x', headers: { Host: `LocalHost:${srv.port}` } });
    assert.equal(upper.status, 302);
    const ok = await raw(srv.port, { path: '/', headers: { Host: `127.0.0.1:${srv.port}` } });
    assert.equal(ok.status, 200);
    const notLocalhost = await raw(srv.port, { path: '/', headers: { Host: `localhost.example:${srv.port}` } });
    assert.equal(notLocalhost.status, 421, 'only the name localhost is redirected; other names are refused');
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

// ---------- health ----------
test('health: answering and not answering targets', async () => {
  const live = http.createServer((req, res) => { res.statusCode = 404; res.end('nope'); });
  await new Promise((r) => live.listen(0, '127.0.0.1', r));
  const dir = makeBoards();
  const board = JSON.parse(fs.readFileSync(path.join(dir, 'demo', 'board.json'), 'utf8'));
  board.targets.up = { label: 'Up', origin: `http://127.0.0.1:${live.address().port}`, hint: '' };
  fs.writeFileSync(path.join(dir, 'demo', 'board.json'), JSON.stringify(board));
  const srv = await startServer(dir);
  try {
    const r = await raw(srv.port, { path: '/api/boards/demo/health' });
    assert.equal(r.status, 200);
    assert.equal(r.json.up.ok, true);
    assert.equal(r.json.up.status, 404, 'any answer counts as answering');
    assert.equal(typeof r.json.up.ms, 'number');
    assert.deepEqual({ ok: r.json.site.ok, status: r.json.site.status }, { ok: false, status: null });
  } finally {
    await srv.close();
    await new Promise((r) => { live.closeAllConnections?.(); live.close(r); });
    cleanup(dir);
  }
});

test('the normalized board over HTTP has shot urls and no server paths', async () => {
  const dir = makeBoards();
  const srv = await startServer(dir);
  try {
    const r = await raw(srv.port, { path: '/api/boards/demo' });
    assert.equal(r.status, 200);
    assert.equal(r.json.groups[0].options[0].shots.phone[0].url, '/boards/demo/assets/shots/a.png');
    assert.equal(r.json.decisionsPath, path.join(dir, 'demo', 'decisions.json'));
    assert.ok(!r.text.includes('accounts.json'));
    const bad = await raw(srv.port, { path: '/api/boards/nope' });
    assert.equal(bad.status, 404);
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

// ---------- Host header (DNS rebinding) ----------
test('a foreign Host is refused for GET and PUT, even with a matching Origin, and nothing is read or written', async () => {
  const dir = makeBoards();
  const srv = await startServer(dir);
  try {
    for (const host of ['evil.example:4612', 'evil.example', '192.168.1.20:4600', 'localhost.evil.test:4600']) {
      const headers = { Host: host, Origin: `http://${host}` };
      const put = await putJson(srv.port, '/api/boards/demo/decisions', { board: 'demo', groups: { g1: { choice: 'a' } } }, headers);
      assert.equal(put.status, 421, `PUT ${host}`);
      const get = await raw(srv.port, { path: '/api/boards/demo/decisions', headers });
      assert.equal(get.status, 421, `GET ${host}`);
      assert.ok(!get.text.includes('groups'));
      const app = await raw(srv.port, { path: '/', headers });
      assert.equal(app.status, 421);
    }
    assert.ok(!fs.existsSync(decisionsPath(dir)), 'nothing was written');
    assert.equal((await raw(srv.port, { path: '/api/boards/demo/decisions', headers: { Host: '127.0.0.5:9' } })).status, 200, 'loopback names are fine');
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

test('the exact --host value is accepted as a host name', async () => {
  const dir = makeBoards();
  const srv = await startServer(dir, { host: 'review.lan' });
  try {
    assert.equal((await raw(srv.port, { path: '/api/boards', headers: { Host: 'review.lan:4600' } })).status, 200);
    assert.equal((await raw(srv.port, { path: '/api/boards', headers: { Host: 'other.lan:4600' } })).status, 421);
  } finally {
    await srv.close();
    cleanup(dir);
  }
});
