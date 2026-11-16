import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveInside } from '../lib/assets.mjs';
import { makeBoards, cleanup, startServer, raw, tmpDir } from './helpers.mjs';

test('resolveInside accepts clean paths and refuses everything that could leave the root', () => {
  const root = tmpDir();
  try {
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'f.txt'), 'x');
    assert.equal(resolveInside(root, 'sub/f.txt'), path.join(root, 'sub', 'f.txt'));
    assert.equal(resolveInside(root, 'sub%2Ff.txt'), null, 'encoded slash');
    for (const bad of ['../x', 'sub/../../x', '%2e%2e/x', '%2E%2E/x', 'sub/%2e%2e/%2e%2e/x', '..', '.', '/etc/passwd', '//etc/passwd', 'C:/Windows/win.ini', 'C%3A/x', 'a\\b', 'a%5Cb', 'a%00b', 'a\0b', '%zz', '', 'sub//f.txt']) {
      assert.equal(resolveInside(root, bad), null, `refuses ${JSON.stringify(bad)}`);
    }
    assert.equal(resolveInside(root, 'nope/none.txt'), path.join(root, 'nope', 'none.txt'), 'a missing file inside the root is the caller\'s 404');
  } finally {
    cleanup(root);
  }
});

test('resolveInside does not follow a link out of the root', (t) => {
  const root = tmpDir();
  const outside = tmpDir();
  try {
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    try {
      fs.symlinkSync(outside, path.join(root, 'link'), 'junction');
    } catch {
      t.skip('cannot create links here');
      return;
    }
    assert.equal(resolveInside(root, 'link/secret.txt'), null);
  } finally {
    cleanup(root);
    cleanup(outside);
  }
});

test('assets over HTTP: files, content types, caching, 404s', async () => {
  const dir = makeBoards();
  const srv = await startServer(dir);
  try {
    const png = await raw(srv.port, { path: '/boards/demo/assets/shots/a.png' });
    assert.equal(png.status, 200);
    assert.equal(png.headers['content-type'], 'image/png');
    assert.ok(png.headers.etag && png.headers['last-modified']);
    assert.equal(png.headers['cache-control'], 'no-cache');
    assert.equal(png.buf.length, 8);
    const again = await raw(srv.port, { path: '/boards/demo/assets/shots/a.png', headers: { 'If-None-Match': png.headers.etag } });
    assert.equal(again.status, 304);
    const byDate = await raw(srv.port, { path: '/boards/demo/assets/shots/a.png', headers: { 'If-Modified-Since': png.headers['last-modified'] } });
    assert.equal(byDate.status, 304);
    const svg = await raw(srv.port, { path: '/boards/demo/assets/shots/sub/b.svg' });
    assert.equal(svg.headers['content-type'], 'image/svg+xml');
    assert.equal((await raw(srv.port, { method: 'HEAD', path: '/boards/demo/assets/shots/a.png' })).status, 200);
    assert.equal((await raw(srv.port, { path: '/boards/demo/assets/shots/missing.png' })).status, 404);
    assert.equal((await raw(srv.port, { path: '/boards/demo/assets/nothere/a.png' })).status, 404);
    assert.equal((await raw(srv.port, { path: '/boards/nope/assets/shots/a.png' })).status, 404);
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

test('assets over HTTP: traversal attempts never reach a file outside the root', async () => {
  const dir = makeBoards();
  const srv = await startServer(dir);
  try {
    const attempts = [
      '/boards/demo/assets/shots/../secret.txt',
      '/boards/demo/assets/shots/%2e%2e/secret.txt',
      '/boards/demo/assets/shots/%2E%2E%2Fsecret.txt',
      '/boards/demo/assets/shots/..%2fsecret.txt',
      '/boards/demo/assets/shots/..%5csecret.txt',
      '/boards/demo/assets/shots/sub/%2e%2e/%2e%2e/secret.txt',
      '/boards/demo/assets/shots/%2e%2e/%2e%2e/board.json',
      '/boards/demo/assets/shots/..%2f..%2fboard.json',
      '/boards/demo/assets/shots//etc/passwd',
      '/boards/demo/assets/shots/%2fetc%2fpasswd',
      '/boards/demo/assets/shots/C:/Windows/win.ini',
      '/boards/demo/assets/shots/C%3A%5CWindows%5Cwin.ini',
      '/boards/demo/assets/shots/a.png%00.txt',
      '/boards/demo/assets/shots/%00',
      '/boards/demo/assets/shots/../../other/shots/private.png',
      '/boards/demo/assets/shots/%2e%2e/%2e%2e/other/shots/private.png',
      '/boards/demo/assets/shots/..%2f..%2fother%2fshots%2fprivate.png',
      '/boards/other/assets/shots/../../demo/secret.txt',
      '/boards/demo/../other/assets/shots/private.png',
    ];
    for (const p of attempts) {
      const r = await raw(srv.port, { path: p });
      assert.ok(r.status === 404 || r.status === 400, `${p} gave ${r.status}`);
      assert.ok(!r.text.includes('outside the asset root') && !r.text.includes('other board file') && !r.text.includes('"title"'), `${p} leaked a file`);
    }
    // the same names are served for the board that owns them, to prove the test files are reachable at all
    assert.equal((await raw(srv.port, { path: '/boards/other/assets/shots/private.png' })).status, 200);
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

test('no directory listings, and the app refuses to leave its folder', async () => {
  const dir = makeBoards();
  const srv = await startServer(dir);
  try {
    for (const p of ['/boards/demo/assets/shots/', '/boards/demo/assets/shots/sub', '/boards/demo/assets/shots/sub/']) {
      const r = await raw(srv.port, { path: p });
      assert.equal(r.status, 404, p);
      assert.ok(!r.text.includes('b.svg'));
    }
    for (const p of ['/styles/', '/js', '/js/views/']) {
      const r = await raw(srv.port, { path: p });
      assert.ok(!r.text.includes('stage.js') || r.text.includes('<!doctype html>'), `${p}: no listing`);
      assert.ok(r.status === 200 && r.text.startsWith('<!doctype html>'), `${p}: unknown app paths get index.html`);
    }
    for (const p of ['/../server.mjs', '/%2e%2e/server.mjs', '/..%2fserver.mjs', '/js/../../server.mjs', '/%2e%2e%2f%2e%2e%2fpackage.json']) {
      const r = await raw(srv.port, { path: p });
      assert.ok(r.status === 404 || r.status === 400, `${p} gave ${r.status}`);
      assert.ok(!r.text.includes('createApp') && !r.text.includes('"abcode"'), `${p} leaked`);
    }
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

test('the app is served, unknown paths return index.html, and there are no CORS headers', async () => {
  const dir = makeBoards();
  const srv = await startServer(dir);
  try {
    const home = await raw(srv.port, { path: '/' });
    assert.equal(home.status, 200);
    assert.match(home.headers['content-type'], /text\/html/);
    const route = await raw(srv.port, { path: '/b/demo/whatever' });
    assert.equal(route.status, 200);
    assert.equal(route.text, home.text);
    const css = await raw(srv.port, { path: '/styles/tokens.css' });
    assert.match(css.headers['content-type'], /text\/css/);
    const js = await raw(srv.port, { path: '/js/main.js' });
    assert.match(js.headers['content-type'], /text\/javascript/);
    for (const r of [home, css, js]) assert.ok(!Object.keys(r.headers).some((h) => h.startsWith('access-control-')));
    const api = await raw(srv.port, { path: '/api/nothing' });
    assert.equal(api.status, 404);
    assert.match(api.json.error, /\w/);
  } finally {
    await srv.close();
    cleanup(dir);
  }
});

test('an unknown path with a file extension is a 404, an extensionless one still gets index.html', async () => {
  const dir = makeBoards();
  const srv = await startServer(dir);
  try {
    for (const p of ['/missing.js', '/lib/app.mjs', '/js/nope.css']) {
      const r = await raw(srv.port, { path: p });
      assert.equal(r.status, 404, p);
      assert.ok(!r.text.includes('<!doctype html>'), `${p}: not index.html`);
    }
    const r = await raw(srv.port, { path: '/b/demo/somewhere' });
    assert.equal(r.status, 200);
    assert.ok(r.text.startsWith('<!doctype html>'));
  } finally {
    await srv.close();
    cleanup(dir);
  }
});
