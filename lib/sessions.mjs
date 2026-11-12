// One-click accounts: set or clear a cookie for a local site, from a file on this machine.
import fs from 'node:fs';
import path from 'node:path';
import { hostNameOf, portOf, isLoopbackName } from './http.mjs';

export class SessionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function targetHostName(origin) {
  return new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function readPath(obj, jsonPath) {
  let cur = obj;
  for (const key of jsonPath.split('.')) {
    if (cur === null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * Works out the Set-Cookie headers for a session. The value only ever appears inside those headers.
 * Throws SessionError: 404 unknown session or missing file/path, 409 wrong host name, 500 unusable value.
 */
export function sessionCookies(board, sessionId, hostHeader) {
  const def = board.sessionDefs.find((s) => s.id === sessionId);
  if (!def) throw new SessionError(404, `Board "${board.id}" has no session called "${sessionId}".`);
  const target = board.targets[def.target];
  const requestHost = hostNameOf(hostHeader);
  const wantHost = targetHostName(target.origin);
  if (!isLoopbackName(requestHost) || requestHost !== wantHost) {
    const shown = wantHost.includes(':') ? `[${wantHost}]` : wantHost;
    throw new SessionError(
      409,
      `The account switch only works when this page and "${target.label}" share one host name. Open the board at http://${shown}${portOf(hostHeader) ? ':' + portOf(hostHeader) : ''}/ (you are on "${requestHost || 'an unknown host'}", the site is on "${wantHost}").`,
    );
  }
  if (def.clear) {
    return def.clear.map((name) => `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  }
  const c = def.cookie;
  const file = path.resolve(board.dir, c.file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new SessionError(404, `The account file for "${def.label}" is missing (${file}). Start the site's dev stack so that it writes the file, or fix cookie.file in board.json.`);
    }
    throw new SessionError(500, `The account file ${file} could not be read as JSON.`);
  }
  let value = readPath(data, c.jsonPath);
  if (typeof value !== 'string' || value === '') {
    throw new SessionError(404, `The account file ${file} has no text at "${c.jsonPath}".`);
  }
  if (c.stripPrefix && value.startsWith(c.stripPrefix)) value = value.slice(c.stripPrefix.length);
  if (!value || /[\s;,"\\\x00-\x1f\x7f]/.test(value)) {
    throw new SessionError(500, `The value found at "${c.jsonPath}" cannot be used as a cookie value.`);
  }
  return [`${c.name}=${value}; Path=/; HttpOnly; SameSite=Lax`];
}
