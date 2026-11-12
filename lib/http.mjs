// Tiny router and helpers: JSON replies, a capped body reader, content types.

export const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(text);
}

export function sendError(res, status, message, headers = {}) {
  sendJson(res, status, { error: message }, headers);
}

export function sendEmpty(res, status, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end();
}

/** Reads the request body as text, refusing anything over `limit` bytes. */
export function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      reject(new HttpError(413, `The request body is larger than ${Math.round(limit / 1024)} KB.`));
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        chunks.length = 0;
        reject(new HttpError(413, `The request body is larger than ${Math.round(limit / 1024)} KB.`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (!failed) reject(err);
    });
  });
}

/** Reads the request body as bytes, refusing anything over `limit` bytes. Stops keeping data once the limit is passed. */
export function readBuffer(req, limit, tooLarge) {
  return new Promise((resolve, reject) => {
    const fail = () => new HttpError(413, tooLarge || `The request body is larger than ${Math.round(limit / 1024)} KB.`);
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      reject(fail());
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        chunks.length = 0;
        reject(fail());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (!failed) reject(err);
    });
  });
}

/** Small router: routes are [method, RegExp, handler]; the first match wins. */
export function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler) {
      routes.push({ method, pattern, handler });
    },
    match(method, pathname) {
      let pathMatched = false;
      for (const route of routes) {
        const m = route.pattern.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (route.method === method) return { handler: route.handler, params: m.slice(1) };
      }
      return { handler: null, pathMatched };
    },
  };
}

/** Host name of a Host header value, lower case, without port or brackets. */
export function hostNameOf(hostHeader) {
  if (!hostHeader) return '';
  const h = String(hostHeader).trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end > 0 ? h.slice(1, end) : h;
  }
  const colon = h.lastIndexOf(':');
  return colon > -1 && h.indexOf(':') === colon ? h.slice(0, colon) : h;
}

export function portOf(hostHeader) {
  const m = /:(\d+)$/.exec(String(hostHeader || ''));
  return m ? m[1] : '';
}

export function isLoopbackName(name) {
  return name === 'localhost' || name === '::1' || /^127(\.\d{1,3}){3}$/.test(name);
}
