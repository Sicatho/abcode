#!/usr/bin/env node
// Review Board: node server.mjs [--port 4600] [--host 127.0.0.1] [--boards ./boards]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './lib/app.mjs';
import { listBoardIds } from './lib/boards.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i !== -1 && args[i + 1] !== undefined) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : fallback;
}

const port = Number(flag('port', '4600'));
const host = flag('host', '127.0.0.1');
const boardsDir = path.resolve(flag('boards', path.join(here, 'boards')));
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('--port must be a number between 0 and 65535.');
  process.exit(1);
}

const server = createApp({ boardsDir, host });
server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Try --port <other>.` : err.message);
  process.exit(1);
});
server.listen(port, host, () => {
  const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const ids = listBoardIds(boardsDir);
  console.log(`Review Board is running. Open http://${shown.includes(':') ? `[${shown}]` : shown}:${server.address().port}/`);
  console.log(`Boards in ${boardsDir}: ${ids.length ? ids.join(', ') : '(none yet)'}`);
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') console.log('Warning: listening beyond this machine lets others change your decisions.');
});
