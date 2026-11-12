// Shared test helpers: a throwaway boards folder, a running server, raw HTTP requests.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../lib/app.mjs';

export const GOOD_BOARD = {
  title: 'Demo',
  subtitle: 'A board for tests',
  targets: { site: { label: 'Local site', origin: 'http://127.0.0.1:59999', hint: 'Start it.' } },
  assetRoots: { shots: 'shots' },
  sessions: [
    { id: 'user', label: 'User', target: 'site', cookie: { name: 'app_session', file: 'accounts.json', jsonPath: 'accounts.user.cookie', stripPrefix: 'app_session=' } },
    { id: 'gone', label: 'Gone', target: 'site', cookie: { name: 'app_session', file: 'missing.json', jsonPath: 'a.b' } },
    { id: 'nopath', label: 'No path', target: 'site', cookie: { name: 'app_session', file: 'accounts.json', jsonPath: 'accounts.nobody.cookie' } },
    { id: 'out', label: 'Out', target: 'site', clear: ['app_session', 'other_cookie'] },
  ],
  groups: [
    {
      id: 'g1',
      title: 'First',
      recommended: 'b',
      defaultViewport: 'phone',
      options: [
        { id: 'a', label: 'A', live: { target: 'site', path: '/x', query: { ui: '', mode: 'one' } }, shots: { phone: [{ label: 'Top', src: 'shots/a.png' }] } },
        { id: 'b', label: 'B', live: { url: 'http://127.0.0.1:1/' } },
      ],
    },
    { id: 'g2', title: 'Second', pick: 'none', options: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] },
  ],
};

export function tmpDir(prefix = 'rb-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

/** A boards folder with the board "demo" and a second board "other" holding a file that must stay out of reach. */
export function makeBoards(board = GOOD_BOARD) {
  const root = tmpDir();
  writeJson(path.join(root, 'demo', 'board.json'), board);
  fs.mkdirSync(path.join(root, 'demo', 'shots', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'demo', 'shots', 'a.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  fs.writeFileSync(path.join(root, 'demo', 'shots', 'sub', 'b.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(root, 'demo', 'secret.txt'), 'outside the asset root');
  writeJson(path.join(root, 'demo', 'accounts.json'), { accounts: { user: { cookie: 'app_session=abc123XYZ' } } });
  writeJson(path.join(root, 'other', 'board.json'), { ...GOOD_BOARD, title: 'Other' });
  fs.mkdirSync(path.join(root, 'other', 'shots'), { recursive: true });
  fs.writeFileSync(path.join(root, 'other', 'shots', 'private.png'), 'other board file');
  return root;
}

export async function startServer(boardsDir, opts = {}) {
  const server = createApp({ boardsDir, healthTimeoutMs: 400, ...opts });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    port,
    host: `127.0.0.1:${port}`,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

/** A raw request: the path is sent exactly as given, headers exactly as given. */
export function raw(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, buf, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export const putJson = (port, p, obj, headers = {}) =>
  raw(port, { method: 'PUT', path: p, headers: { 'Content-Type': 'application/json', ...headers }, body: typeof obj === 'string' ? obj : JSON.stringify(obj) });

export function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
