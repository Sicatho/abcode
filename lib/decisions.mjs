// Reads, validates and saves decisions. The file on disk is always valid JSON.
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './http.mjs';
import { countDecided } from '../app/js/lib/rules.js';

export const MAX_TEXT = 4000;
export const MAX_BODY = 64 * 1024;

export function decisionsFile(board) {
  return path.join(board.dir, 'decisions.json');
}
export function historyFile(board) {
  return path.join(board.dir, 'decisions.history.jsonl');
}

export function emptyDecisions(board) {
  return { board: board.id, updatedAt: null, groups: {} };
}

/** A stored submission, or null when it is missing or malformed. */
function cleanSubmitted(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  if (typeof v.at !== 'string' || Number.isNaN(Date.parse(v.at))) return null;
  if (!Number.isInteger(v.decided) || !Number.isInteger(v.total)) return null;
  if (!Array.isArray(v.groupIds) || v.groupIds.some((x) => typeof x !== 'string')) return null;
  return { at: v.at, decided: v.decided, total: v.total, groupIds: v.groupIds };
}

export function readDecisions(board) {
  let text;
  try {
    text = fs.readFileSync(decisionsFile(board), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return emptyDecisions(board);
    throw err;
  }
  try {
    const data = JSON.parse(text);
    const groups = data && typeof data.groups === 'object' && data.groups ? data.groups : {};
    const submitted = cleanSubmitted(data.submitted);
    return { board: board.id, updatedAt: data.updatedAt ?? null, groups, ...(submitted ? { submitted } : {}) };
  } catch {
    throw new HttpError(500, `${decisionsFile(board)} is not valid JSON. Fix or delete the file.`);
  }
}

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function text(v, field) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new HttpError(400, `"${field}" must be text.`);
  if (v.length > MAX_TEXT) throw new HttpError(400, `"${field}" is longer than ${MAX_TEXT} characters.`);
  return v;
}

/** Validates a request body against the board. Returns the cleaned groups it contains. */
export function validateGroups(board, body) {
  if (!isObj(body) || !isObj(body.groups)) throw new HttpError(400, 'The body must be an object with a "groups" object.');
  if (body.board !== undefined && body.board !== board.id) throw new HttpError(400, `The body is for board "${body.board}", not "${board.id}".`);
  const out = {};
  for (const [gid, g] of Object.entries(body.groups)) {
    const group = board.groups.find((x) => x.id === gid);
    if (!group) throw new HttpError(400, `Unknown decision "${gid}" for board "${board.id}".`);
    if (!isObj(g)) throw new HttpError(400, `Decision "${gid}" must be an object.`);
    const choice = g.choice === undefined ? null : g.choice;
    if (choice !== null) {
      if (group.pick === 'none') throw new HttpError(400, `Decision "${gid}" is for notes only: its choice must be null.`);
      if (typeof choice !== 'string' || !group.options.some((o) => o.id === choice)) {
        throw new HttpError(400, `"${choice}" is not an option of decision "${gid}".`);
      }
    }
    const note = text(g.note, `${gid}.note`);
    const optionNotes = {};
    if (g.optionNotes !== undefined && g.optionNotes !== null) {
      if (!isObj(g.optionNotes)) throw new HttpError(400, `"${gid}.optionNotes" must be an object.`);
      for (const [oid, t] of Object.entries(g.optionNotes)) {
        if (!group.options.some((o) => o.id === oid)) throw new HttpError(400, `"${oid}" is not an option of decision "${gid}".`);
        const v = text(t, `${gid}.optionNotes.${oid}`);
        if (v !== '') optionNotes[oid] = v;
      }
    }
    // "done" marks a notes-only decision as looked at. Left out of a body, it keeps its stored value.
    let done;
    if (g.done !== undefined && g.done !== null) {
      if (typeof g.done !== 'boolean') throw new HttpError(400, `"${gid}.done" must be true or false.`);
      if (g.done && group.pick !== 'none') throw new HttpError(400, `Decision "${gid}" has options to choose from: "done" is only for notes-only decisions.`);
      done = g.done;
    }
    out[gid] = { choice, note, optionNotes, done };
  }
  return out;
}

function sameContent(a, b) {
  return a && b && a.choice === b.choice && a.note === b.note && (a.done === true) === (b.done === true) && JSON.stringify(a.optionNotes || {}) === JSON.stringify(b.optionNotes || {});
}

function renameWithRetry(from, to) {
  let last;
  for (let i = 0; i < 8; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      last = err;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) break;
      const until = Date.now() + 15 * (i + 1);
      while (Date.now() < until); // brief wait: a virus scanner or reader may hold the file
    }
  }
  throw last;
}

/** Atomic write: a temp file in the same folder, then a rename over the target. */
export function writeFileAtomic(file, content) {
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    renameWithRetry(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw err;
  }
}

/** Saves groups from a request body (merged over what is stored). Returns the saved object. */
export function saveDecisions(board, body, now = new Date()) {
  const incoming = validateGroups(board, body);
  const current = readDecisions(board);
  const at = now.toISOString();
  const groups = { ...current.groups };
  for (const [gid, g] of Object.entries(incoming)) {
    const before = groups[gid];
    const done = g.done === undefined ? Boolean(before && before.done === true) : g.done;
    const empty = g.choice === null && g.note === '' && Object.keys(g.optionNotes).length === 0 && !done;
    if (!before && empty) continue;
    // notes on options the board no longer has (an earlier round) are kept
    const known = new Set(board.groups.find((x) => x.id === gid).options.map((o) => o.id));
    const stale = {};
    for (const [oid, t] of Object.entries((before && before.optionNotes) || {})) if (!known.has(oid)) stale[oid] = t;
    // a stored choice the board no longer offers is kept unless the page names a real option
    const pick = board.groups.find((x) => x.id === gid).pick;
    const staleChoice = before && pick !== 'none' && before.choice != null && !known.has(before.choice);
    const choice = g.choice === null && staleChoice ? before.choice : g.choice;
    const { done: _unused, ...plain } = g;
    const merged = { ...plain, choice, optionNotes: { ...stale, ...g.optionNotes }, ...(done ? { done: true } : {}) };
    groups[gid] = { ...merged, updatedAt: sameContent(before, merged) && before.updatedAt ? before.updatedAt : at };
  }
  // Board order first, so the file reads the same every time; groups the board no longer has
  // (an earlier round) follow, untouched.
  const ordered = {};
  for (const grp of board.groups) if (groups[grp.id]) ordered[grp.id] = groups[grp.id];
  for (const gid of Object.keys(groups)) if (!(gid in ordered)) ordered[gid] = groups[gid];
  // Nothing changed: no rewrite and no history line.
  if (JSON.stringify(ordered) === JSON.stringify(current.groups)) return current.updatedAt ? current : { ...current, groups: ordered };
  // A save never drops or changes the submission.
  const saved = { board: board.id, updatedAt: at, groups: ordered, ...(current.submitted ? { submitted: current.submitted } : {}) };
  writeFileAtomic(decisionsFile(board), JSON.stringify(saved, null, 2) + '\n');
  fs.appendFileSync(historyFile(board), JSON.stringify({ at, groups: ordered }) + '\n', 'utf8');
  return saved;
}

/**
 * Finishes the review: stores what was on the board at this moment as "submitted" and adds a
 * history line with "event": "submitted". The decisions themselves are not touched.
 */
export function submitDecisions(board, now = new Date()) {
  const current = readDecisions(board);
  const at = now.toISOString();
  const submitted = { at, decided: countDecided(board, current), total: board.groups.length, groupIds: board.groups.map((g) => g.id) };
  const saved = { board: board.id, updatedAt: current.updatedAt, groups: current.groups, submitted };
  writeFileAtomic(decisionsFile(board), JSON.stringify(saved, null, 2) + '\n');
  fs.appendFileSync(historyFile(board), JSON.stringify({ at, event: 'submitted', decided: submitted.decided, total: submitted.total }) + '\n', 'utf8');
  return saved;
}
