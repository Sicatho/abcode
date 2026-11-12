// Pure helpers for taking in a board that changed on disk, for bringing the open decision into view in
// the sidebar's list, and for remembering which account was set on which site. No DOM, no store:
// shared by the views and tested with node:test.

/** True when enough time has passed since the last check. */
export function dueForRefresh(now, last, minMs) {
  return !last || now - last >= minMs;
}

/** Do two boards (as the server sends them) differ? */
export function boardChanged(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * Where to stay after the board was read again: the open decision when the new board still has it,
 * else the first undecided one, else the first. Returns a group id, or null for a board without groups.
 */
export function landingGroup(board, openId, isDecided) {
  const groups = (board && board.groups) || [];
  if (openId && groups.some((g) => g.id === openId)) return openId;
  const undecided = groups.find((g) => !isDecided(g));
  return (undecided || groups[0] || { id: null }).id;
}

/**
 * Where the open decision's row must be in the list for it to be fully in view, or null when it is.
 * Everything is a distance in pixels from the top of the list's scrolled content. `rowTop`/`rowBottom`
 * are the row, `headTop` the top of its section's heading (null for a row without one), `viewTop` the
 * current scrollTop and `viewHeight` the visible height. The heading is included when heading and row
 * fit together. Returns the scrollTop to set.
 */
export function scrollToReveal({ rowTop, rowBottom, headTop = null, viewTop, viewHeight }) {
  const withHead = headTop !== null && headTop <= rowTop && rowBottom - headTop <= viewHeight;
  const top = withHead ? headTop : rowTop;
  const bottom = rowBottom;
  if (top < viewTop) return Math.max(0, top);
  if (bottom > viewTop + viewHeight) return bottom - viewHeight;
  return null;
}

/** The host name a site is on: where its cookies live, whatever the port. */
export function hostOf(origin) {
  try {
    return new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return null;
  }
}

export const sessionMemoryKey = (host) => `rb:account-on:${host}`;

/** What is stored when an account is set: which session of which board set the cookie. */
export const sessionRecord = (boardId, sessionId) => JSON.stringify({ board: boardId, session: sessionId });

/**
 * The account of this board that is still the one set on its site, or null. A cookie belongs to a host
 * name, so another board that shows the same site may have replaced it since: only a record written by
 * this very board and naming one of its sessions counts. `read(key)` gives the stored text or null.
 */
export function rememberedSession(board, read) {
  for (const s of board.sessions || []) {
    const t = board.targets && board.targets[s.target];
    const host = t && hostOf(t.origin);
    if (!host) continue;
    let rec = null;
    try {
      rec = JSON.parse(read(sessionMemoryKey(host)) || 'null');
    } catch {}
    if (rec && rec.board === board.id && rec.session === s.id) return s.id;
  }
  return null;
}

/**
 * Has the claim to the account `last` been taken away? True when this page believes `last` is set and
 * a record on the site's host names someone else (another board on the same site, in any tab, set an
 * account since). A missing record (nothing stored, storage blocked) is not evidence: the page keeps
 * what it knows.
 */
export function sessionClaimLost(board, last, read) {
  if (!last) return false;
  let seen = false;
  for (const s of board.sessions || []) {
    const t = board.targets && board.targets[s.target];
    const host = t && hostOf(t.origin);
    if (host && read(sessionMemoryKey(host)) != null) seen = true;
  }
  return seen && rememberedSession(board, read) !== last;
}

/**
 * The open decision was removed from the board on disk. Its edit must not be lost: true when the page
 * holds text for that decision that the server has not taken (waiting, being sent, or refused), so
 * the new board must wait. `removed` says the open id is gone from the new board.
 */
export function mustHoldBoard({ removed, hasUnsaved }) {
  return Boolean(removed && hasUnsaved);
}

/**
 * What the stage and the panel of one decision are built from, as text: the decision itself (without its
 * section, which only the sidebar shows), the targets its live options point at, the viewports, and the
 * account it asks for with that account's site. Two readings of board.json with the same signature for a
 * decision need no new frames and no new panel for it; a change elsewhere on the board does not touch it.
 */
export function groupSignature(board, group) {
  if (!board || !group) return '';
  const { section, ...own } = group;
  const targets = board.targets || {};
  const names = new Set();
  for (const o of group.options || []) if (o.live && o.live.target) names.add(o.live.target);
  const wanted = group.session || board.defaultSession || null;
  const session = wanted ? (board.sessions || []).find((s) => s.id === wanted) || null : null;
  if (session && session.target) names.add(session.target);
  const used = [...names].sort().map((n) => [n, targets[n] || null]);
  return JSON.stringify([own, used, board.viewports || [], session]);
}

/** The text a reviewer typed for a decision, as one block to copy: the note, then each option's note under its label. */
export function heldText(decision, group) {
  if (!decision) return '';
  const parts = [];
  if (decision.note && decision.note.trim()) parts.push(decision.note);
  for (const [oid, text] of Object.entries(decision.optionNotes || {})) {
    if (!text || !text.trim()) continue;
    const opt = group && (group.options || []).find((o) => o.id === oid);
    parts.push(`Note on ${opt ? opt.label : oid}:\n${text}`);
  }
  return parts.join('\n\n');
}
