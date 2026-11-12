// The request handler: routes, the safety rules, and the static app.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouter, hostNameOf, portOf, isLoopbackName, readBody, sendEmpty, sendError, sendJson, HttpError } from './http.mjs';
import { listBoardIds, loadBoard, publicBoard, BoardError } from './boards.mjs';
import { decisionsFile, readDecisions, saveDecisions, submitDecisions, MAX_BODY } from './decisions.mjs';
import { reviewOf } from './review.mjs';
import { countDecided as countDecidedIn } from '../app/js/lib/rules.js';
import { resolveInside, sendFile } from './assets.mjs';
import { sessionCookies, SessionError } from './sessions.mjs';
import { checkTargets } from './health.mjs';
import { statusOf } from './listen.mjs';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');

/** How many groups of the board are decided (the rule is shared with the page: app/js/lib/rules.js). */
export function countDecided(board, decisions) {
  return countDecidedIn(board, decisions);
}

/** Decisions as the API answers them: the file's content plus the derived review state. */
const withReview = (board, decisions) => ({ ...decisions, review: reviewOf(board, decisions) });

export function createApp({ boardsDir, appDir = APP_DIR, healthTimeoutMs = 1500, host = '127.0.0.1' }) {
  const allowedHost = hostNameOf(host);
  boardsDir = path.resolve(boardsDir);
  const router = createRouter();
  const ID = '([a-z0-9-]+)';

  router.add('GET', /^\/api\/boards$/, async () => {
    const list = listBoardIds(boardsDir).map((id) => {
      try {
        const board = loadBoard(boardsDir, id);
        const decisions = readDecisions(board);
        const review = reviewOf(board, decisions);
        return { id, title: board.title, subtitle: board.subtitle, groups: board.groups.length, decided: review.decided, review };
      } catch (err) {
        return { id, title: id, subtitle: '', groups: 0, decided: 0, error: err.message };
      }
    });
    return { json: list };
  });

  router.add('GET', new RegExp(`^/api/boards/${ID}$`), async ({ params }) => {
    const board = loadBoard(boardsDir, params[0]);
    return { json: publicBoard(board, decisionsFile(board)) };
  });

  router.add('GET', new RegExp(`^/api/boards/${ID}/decisions$`), async ({ params }) => {
    const board = loadBoard(boardsDir, params[0]);
    return { json: withReview(board, readDecisions(board)) };
  });

  router.add('PUT', new RegExp(`^/api/boards/${ID}/decisions$`), async ({ params, req }) => {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') throw new HttpError(415, 'Send the decisions as Content-Type: application/json.');
    const board = loadBoard(boardsDir, params[0]);
    const raw = await readBody(req, MAX_BODY);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'The body is not valid JSON.');
    }
    return { json: withReview(board, saveDecisions(board, body)) };
  });

  // Finishing the review. Same safety rules as the PUT (the Origin check happens before routing).
  router.add('POST', new RegExp(`^/api/boards/${ID}/submit$`), async ({ params, req }) => {
    req.resume(); // no body is expected
    const board = loadBoard(boardsDir, params[0]);
    return { json: withReview(board, submitDecisions(board)) };
  });

  // Where the review stands, and whether an assistant is waiting for it (see lib/listen.mjs).
  router.add('GET', new RegExp(`^/api/boards/${ID}/status$`), async ({ params }) => {
    const board = loadBoard(boardsDir, params[0]);
    return { json: statusOf(board) };
  });

  router.add('GET', new RegExp(`^/api/boards/${ID}/health$`), async ({ params }) => {
    const board = loadBoard(boardsDir, params[0]);
    return { json: await checkTargets(board, healthTimeoutMs) };
  });

  router.add('POST', new RegExp(`^/api/boards/${ID}/session/([A-Za-z0-9_-]+)$`), async ({ params, req }) => {
    req.resume(); // no body is expected
    const board = loadBoard(boardsDir, params[0]);
    const cookies = sessionCookies(board, params[1], req.headers.host);
    return { status: 204, headers: { 'Set-Cookie': cookies } };
  });

  router.add('GET', new RegExp(`^/boards/${ID}/assets/([A-Za-z0-9_-]+)/(.+)$`), async ({ params, req, res }) => {
    const board = loadBoard(boardsDir, params[0]);
    const root = board.assetDirs[params[1]];
    if (!root) throw new HttpError(404, `Board "${board.id}" has no asset root called "${params[1]}".`);
    const file = resolveInside(root, params[2]);
    if (!file) throw new HttpError(404, 'No such file.');
    if (!sendFile(req, res, file, { cache: 'no-cache' })) throw new HttpError(404, 'No such file.');
    return { handled: true };
  });

  async function handle(req, res) {
    const rawUrl = req.url || '/';
    const q = rawUrl.indexOf('?');
    const pathname = q === -1 ? rawUrl : rawUrl.slice(0, q);
    const method = req.method || 'GET';

    // One host name for cookies and frames: localhost becomes 127.0.0.1.
    if (hostNameOf(req.headers.host) === 'localhost') {
      const port = portOf(req.headers.host);
      res.writeHead(302, { Location: `http://127.0.0.1${port ? ':' + port : ''}${rawUrl.startsWith('/') ? rawUrl : '/'}`, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    // DNS rebinding: a web page can make its own name resolve to this machine. Only loopback names
    // and the exact --host value are served; anything else is refused before it can read or write.
    const requestHost = hostNameOf(req.headers.host);
    if (!requestHost || !(isLoopbackName(requestHost) || requestHost === allowedHost)) {
      req.resume();
      return sendError(res, 421, `This server only answers to 127.0.0.1 (or the --host it was started with), not to "${requestHost || 'no host name'}".`);
    }

    if (method === 'PUT' || method === 'POST') {
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== `http://${req.headers.host}`) {
        req.resume();
        return sendError(res, 403, 'This request came from another web page and was refused. Only this board page may change decisions or accounts.');
      }
    }

    const isApi = pathname.startsWith('/api/') || pathname.startsWith('/boards/');
    if (isApi) {
      const lookup = router.match(method === 'HEAD' ? 'GET' : method, pathname);
      if (!lookup.handler) {
        req.resume();
        return lookup.pathMatched ? sendError(res, 405, `${method} is not allowed here.`) : sendError(res, 404, 'No such address.');
      }
      try {
        const out = await lookup.handler({ req, res, params: lookup.params });
        if (out.handled) return;
        if (out.json !== undefined) return sendJson(res, out.status || 200, out.json);
        return sendEmpty(res, out.status || 204, out.headers);
      } catch (err) {
        if (res.headersSent) return res.destroy();
        if (err instanceof HttpError || err instanceof BoardError || err instanceof SessionError) return sendError(res, err.status, err.message);
        console.error(err);
        return sendError(res, 500, 'Something went wrong on the server. See its console for details.');
      }
    }

    if (method !== 'GET' && method !== 'HEAD') {
      req.resume();
      return sendError(res, 405, `${method} is not allowed here.`);
    }
    const tail = pathname.replace(/^\/+/, '');
    const index = path.join(appDir, 'index.html');
    if (tail !== '') {
      const file = resolveInside(appDir, tail);
      if (!file) return sendError(res, 404, 'No such file.');
      if (sendFile(req, res, file, { cache: 'no-cache' })) return;
      if (path.extname(tail) !== '') return sendError(res, 404, 'No such file.');
    }
    if (!sendFile(req, res, index, { cache: 'no-cache' })) sendError(res, 500, 'The app files are missing.');
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) sendError(res, 500, 'Something went wrong on the server.');
      else res.destroy();
    });
  });
}
