// Safe static files: the app, and each board's asset roots.
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_TYPES } from './http.mjs';

/**
 * Turns the URL tail of a request into an absolute file path inside `root`, or null.
 * Refuses ".." segments (also encoded), NUL, backslashes, drive letters, encoded
 * slashes and anything that resolves (including through links) outside the root.
 */
export function resolveInside(root, urlTail) {
  if (typeof urlTail !== 'string' || urlTail.includes('\0')) return null;
  const parts = urlTail.split('/');
  const clean = [];
  for (let i = 0; i < parts.length; i++) {
    let seg;
    try {
      seg = decodeURIComponent(parts[i]);
    } catch {
      return null;
    }
    if (seg === '') {
      if (i === 0 && parts.length > 1) return null; // absolute path
      if (i === parts.length - 1) continue; // trailing slash
      return null; // "//" in the middle
    }
    if (seg === '..' || seg === '.') return null;
    if (seg.includes('\0') || seg.includes('\\') || seg.includes('/') || seg.includes(':')) return null;
    clean.push(seg);
  }
  if (clean.length === 0) return null;
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, ...clean);
  if (target !== rootAbs && !target.startsWith(rootAbs + path.sep)) return null;
  let real;
  try {
    real = fs.realpathSync(target);
  } catch {
    return target; // does not exist; the caller answers 404
  }
  let realRoot;
  try {
    realRoot = fs.realpathSync(rootAbs);
  } catch {
    return null;
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
  return target;
}

export function contentTypeFor(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/** Sends a regular file with ETag/Last-Modified revalidation. Returns false when there is no such file. */
export function sendFile(req, res, file, { cache = 'no-cache' } = {}) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return false;
  }
  if (!st.isFile()) return false; // never list directories
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': contentTypeFor(file),
    'Cache-Control': cache,
    ETag: etag,
    'Last-Modified': st.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
  };
  const inm = req.headers['if-none-match'];
  const ims = req.headers['if-modified-since'];
  const fresh = inm
    ? inm.split(',').some((t) => t.trim() === etag)
    : ims && Math.floor(st.mtimeMs / 1000) <= Math.floor(Date.parse(ims) / 1000);
  if (fresh) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
  return true;
}
