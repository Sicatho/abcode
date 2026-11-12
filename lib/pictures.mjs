// Pictures on a decision: screenshots the reviewer adds to explain a note.
// The file lives in <board folder>/pictures/<decision id>/<name>; the list lives in decisions.json
// (groups.<id>.pictures). Nothing the browser sends becomes part of a path: the decision id is checked against
// the board and the name is made here.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './http.mjs';
import { readDecisions, persistGroups } from './decisions.mjs';

export const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
export const MAX_PICTURES = 12;
export const PICTURE_NAME_RE = /^\d{8}-\d{6}-[0-9a-f]{4}\.(png|jpg|webp|gif)$/;
export const KINDS_TEXT = 'PNG, JPEG, WebP or GIF';
const MODES = new Set(['live', 'shots']);

/** The kind of picture, decided from the first bytes (never from a header or a file name), or null. */
export function sniffPicture(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return { ext: 'png', type: 'image/png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  const head = buf.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return { ext: 'gif', type: 'image/gif' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
function stampOf(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function groupOf(board, gid) {
  const group = typeof gid === 'string' ? board.groups.find((g) => g.id === gid) : null;
  if (!group) throw new HttpError(404, `Decision "${gid}" is not on board "${board.id}" (it may have been removed). The picture was not saved.`);
  return group;
}

/** Which option, viewport and mode were showing. Only values the board knows are kept. */
function contextOf(board, group, ctx) {
  const c = ctx || {};
  return {
    option: typeof c.option === 'string' && group.options.some((o) => o.id === c.option) ? c.option : '',
    viewport: typeof c.viewport === 'string' && (c.viewport === 'both' || board.viewports.some((v) => v.id === c.viewport)) ? c.viewport : '',
    mode: typeof c.mode === 'string' && MODES.has(c.mode) ? c.mode : '',
  };
}

const dirOf = (board, gid) => path.join(board.dir, 'pictures', gid);

/** The decision as stored, with its picture added. Returns { decisions, decision, picture }. */
export function addPicture(board, gid, buf, ctx, now = new Date()) {
  const group = groupOf(board, gid);
  if (!buf || buf.length === 0) throw new HttpError(415, `That file is empty, not a ${KINDS_TEXT} picture.`);
  if (buf.length > MAX_PICTURE_BYTES) throw new HttpError(413, `That picture is larger than ${MAX_PICTURE_BYTES / 1024 / 1024} MB.`);
  const kind = sniffPicture(buf);
  if (!kind) throw new HttpError(415, `That file is not a ${KINDS_TEXT} picture.`);
  const current = readDecisions(board);
  const before = current.groups[gid] || { choice: null, note: '', optionNotes: {} };
  const list = Array.isArray(before.pictures) ? before.pictures : [];
  if (list.length >= MAX_PICTURES) throw new HttpError(409, `This decision already has ${MAX_PICTURES} pictures. Remove one first.`);

  const dir = dirOf(board, gid);
  fs.mkdirSync(dir, { recursive: true });
  let name;
  do name = `${stampOf(now)}-${crypto.randomBytes(2).toString('hex')}.${kind.ext}`;
  while (fs.existsSync(path.join(dir, name)) || list.some((p) => p.file.endsWith('/' + name)));
  const file = path.join(dir, name);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw err;
  }

  const at = now.toISOString();
  const picture = { file: `pictures/${gid}/${name}`, addedAt: at, bytes: buf.length, ...contextOf(board, group, ctx) };
  const groups = { ...current.groups, [gid]: { ...before, pictures: [...list, picture], updatedAt: at } };
  try {
    const saved = persistGroups(board, current, groups, at);
    return { decisions: saved, decision: saved.groups[gid], picture };
  } catch (err) {
    try {
      fs.unlinkSync(file);
    } catch {}
    throw err;
  }
}

/** Removes the picture called `name` from a decision: its entry first, then its file. */
export function removePicture(board, gid, name, now = new Date()) {
  groupOf(board, gid);
  const current = readDecisions(board);
  const before = current.groups[gid];
  const list = before && Array.isArray(before.pictures) ? before.pictures : [];
  const wanted = `pictures/${gid}/${name}`;
  if (typeof name !== 'string' || !PICTURE_NAME_RE.test(name) || !list.some((p) => p.file === wanted)) {
    throw new HttpError(404, 'This decision has no such picture.');
  }
  const at = now.toISOString();
  const { pictures: _gone, ...rest } = before;
  const left = list.filter((p) => p.file !== wanted);
  const next = { ...rest, ...(left.length ? { pictures: left } : {}), updatedAt: at };
  const groups = { ...current.groups, [gid]: next };
  // a decision that holds nothing else any more is not kept as an empty entry
  const bare = next.choice == null && !next.note && !Object.keys(next.optionNotes || {}).length && !next.done && !left.length;
  if (bare) delete groups[gid];
  const saved = persistGroups(board, current, groups, at);
  try {
    fs.unlinkSync(path.join(dirOf(board, gid), name));
  } catch {}
  return { decisions: saved, decision: saved.groups[gid] || null };
}

/** The absolute path of a listed picture, or null. Only names that decisions.json lists are served. */
export function listedPictureFile(board, gid, name) {
  if (typeof gid !== 'string' || typeof name !== 'string' || !PICTURE_NAME_RE.test(name)) return null;
  if (!board.groups.some((g) => g.id === gid)) return null;
  const d = readDecisions(board).groups[gid];
  const list = d && Array.isArray(d.pictures) ? d.pictures : [];
  return list.some((p) => p.file === `pictures/${gid}/${name}`) ? path.join(dirOf(board, gid), name) : null;
}
