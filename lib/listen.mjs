// What an assistant needs to know about a finished review, and the two small files that connect
// the page and the waiting command: receipt.json (what was reported) and listener.json (who is waiting).
// Both live next to decisions.json. No server is involved: everything here reads and writes files.
import fs from 'node:fs';
import path from 'node:path';
import { decisionsFile, readDecisions, writeFileAtomic } from './decisions.mjs';
import { isDecided } from '../app/js/lib/rules.js';
import { reviewOf } from './review.mjs';

export const HEARTBEAT_EVERY_MS = 2000;
export const HEARTBEAT_FRESH_MS = 6000;

export const receiptFile = (board) => path.join(board.dir, 'receipt.json');
export const listenerFile = (board) => path.join(board.dir, 'listener.json');

function readJson(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** { submittedAt, reportedAt } or null when nothing was reported (or the file is damaged). */
export function readReceipt(board) {
  const r = readJson(receiptFile(board));
  return r && typeof r.submittedAt === 'string' ? { submittedAt: r.submittedAt, reportedAt: typeof r.reportedAt === 'string' ? r.reportedAt : null } : null;
}

export function writeReceipt(board, submittedAt, now = new Date()) {
  writeFileAtomic(receiptFile(board), JSON.stringify({ submittedAt, reportedAt: now.toISOString() }, null, 2) + '\n');
}

/** Is this submission newer than what was reported last? (No receipt: any submission is.) */
export function isUnreported(submitted, receipt) {
  if (!submitted) return false;
  if (!receipt) return true;
  const a = Date.parse(submitted.at);
  const b = Date.parse(receipt.submittedAt);
  return Number.isNaN(b) ? true : a > b;
}

/** True when a heartbeat younger than HEARTBEAT_FRESH_MS exists. */
export function isListening(board, now = Date.now()) {
  const l = readJson(listenerFile(board));
  if (!l || typeof l.beatAt !== 'string') return false;
  const t = Date.parse(l.beatAt);
  return !Number.isNaN(t) && now - t < HEARTBEAT_FRESH_MS && now - t > -HEARTBEAT_FRESH_MS;
}

export function writeHeartbeat(board, startedAt, now = new Date()) {
  writeFileAtomic(listenerFile(board), JSON.stringify({ pid: process.pid, startedAt, beatAt: now.toISOString() }, null, 2) + '\n');
}

/** Removes the heartbeat, but only one this process wrote. */
export function removeHeartbeat(board) {
  const l = readJson(listenerFile(board));
  if (l && l.pid !== process.pid) return;
  try {
    fs.unlinkSync(listenerFile(board));
  } catch {}
}

/** The answer to GET /api/boards/<id>/status. */
export function statusOf(board) {
  const decisions = readDecisions(board);
  const review = reviewOf(board, decisions);
  const receipt = readReceipt(board);
  return {
    state: review.state,
    submitted: review.submitted,
    listening: isListening(board),
    received: Boolean(review.submitted && receipt && receipt.submittedAt === review.submitted.at),
  };
}

// ---------- the digest ----------

/** What the review says, as plain data: every group of the board in order, then what the board no longer has. */
export function buildDigest(board, decisions) {
  const stored = decisions.groups || {};
  const review = reviewOf(board, decisions);
  const groups = board.groups.map((g) => {
    const d = stored[g.id] || {};
    const known = new Map(g.options.map((o) => [o.id, o]));
    const decided = isDecided(g, d);
    let status = 'undecided';
    let choice = null;
    if (decided) {
      if (g.pick === 'none') status = d.done === true ? 'looked-at' : 'noted';
      else {
        status = 'chosen';
        choice = { id: d.choice, label: known.get(d.choice).label };
      }
    }
    const optionNotes = [];
    const removedOptionNotes = [];
    for (const [oid, text] of Object.entries(d.optionNotes || {})) {
      if (known.has(oid)) optionNotes.push({ id: oid, label: known.get(oid).label, note: text });
      else removedOptionNotes.push({ id: oid, note: text });
    }
    const removedChoice = g.pick !== 'none' && d.choice != null && !known.has(d.choice) ? d.choice : null;
    return { id: g.id, title: g.title, status, choice, note: d.note || '', optionNotes, removedChoice, removedOptionNotes };
  });
  const onBoard = new Set(board.groups.map((g) => g.id));
  const removedGroups = Object.entries(stored)
    .filter(([gid]) => !onBoard.has(gid))
    .map(([gid, d]) => ({
      id: gid,
      choice: d && d.choice != null ? d.choice : null,
      note: (d && d.note) || '',
      optionNotes: Object.entries((d && d.optionNotes) || {}).map(([id, note]) => ({ id, note })),
      looked: Boolean(d && d.done === true),
    }));
  return {
    board: { id: board.id, title: board.title },
    state: review.state,
    finishedAt: review.submitted ? review.submitted.at : null,
    decided: review.decided,
    total: review.total,
    atFinish: review.submitted ? { decided: review.submitted.decided, total: review.submitted.total } : null,
    groups,
    removedGroups,
    decisionsFile: path.resolve(decisionsFile(board)),
  };
}

const indent = (text, pad) => text.split('\n').map((l) => pad + l).join('\n');

/** The digest as text written for an assistant to read. */
export function formatDigest(d) {
  const out = [];
  out.push(`Review finished: ${d.board.title} (board ${d.board.id})`);
  out.push(`Finished at: ${d.finishedAt}`);
  if (d.state === 'changed' && d.atFinish) {
    out.push('Note: decisions changed after this finish; what follows is their current content.');
    out.push(`At the finish: ${d.atFinish.decided} of ${d.atFinish.total} decided. Now: ${d.decided} of ${d.total} decided.`);
  } else out.push(`${d.decided} of ${d.total} decided`);
  d.groups.forEach((g, i) => {
    out.push('');
    out.push(`${i + 1}. ${g.title} (${g.id})`);
    if (g.status === 'chosen') out.push(`   Chosen: ${g.choice.label} (${g.choice.id})`);
    else if (g.status === 'looked-at') out.push('   Looked at (notes only)');
    else if (g.status === 'noted') out.push('   Notes only');
    else out.push('   Undecided');
    if (g.removedChoice) out.push(`   Stored choice "${g.removedChoice}" is no longer an option on the board.`);
    if (g.note.trim()) out.push(`   Note:\n${indent(g.note.trim(), '     ')}`);
    for (const o of g.optionNotes) out.push(`   Note on ${o.label} (${o.id}):\n${indent(o.note.trim(), '     ')}`);
    for (const o of g.removedOptionNotes) out.push(`   Note on option ${o.id} (no longer on the board):\n${indent(o.note.trim(), '     ')}`);
  });
  if (d.removedGroups.length) {
    out.push('');
    out.push('Stored decisions for decisions no longer on the board:');
    for (const g of d.removedGroups) {
      out.push(`- ${g.id} (no longer on the board)${g.choice ? ` chose ${g.choice}` : ''}${g.looked ? ' looked at' : ''}`);
      if (g.note.trim()) out.push(`   Note:\n${indent(g.note.trim(), '     ')}`);
      for (const o of g.optionNotes) out.push(`   Note on option ${o.id}:\n${indent(o.note.trim(), '     ')}`);
    }
  }
  out.push('');
  out.push(`Decisions file: ${d.decisionsFile}`);
  return out.join('\n') + '\n';
}
