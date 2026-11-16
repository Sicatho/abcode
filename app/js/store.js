// The one store: board, decisions, view state. Views subscribe to topics and redraw their own part.
import * as api from './api.js';
import { buildHash, parseHash } from './router.js';
import { lsGet, lsSet } from './lib/storage.js';
import { clock } from './lib/format.js';
import { isDecided as groupIsDecided } from './lib/rules.js';
import { visibleGroups, neighbour, wantedSession } from './lib/sections.js';
import { dueForRefresh, boardChanged, landingGroup, hostOf, sessionMemoryKey, sessionRecord, rememberedSession, sessionClaimLost, mustHoldBoard, groupSignature, heldText } from './lib/reload.js';

const subs = new Set();

export const state = {
  boards: null,
  boardId: null,
  board: null,
  loadError: null,
  decisions: { groups: {}, updatedAt: null },
  review: null, // the server's answer: { state, decided, total, submitted } (see lib/review.mjs)
  finish: { ask: null, busy: false, error: null }, // ask: where the confirmation is open ('sidebar' | 'summary' | null)
  assistant: { listening: false, received: false, known: false }, // from GET /status: is an assistant waiting, did it get the last finish
  health: {},
  healthState: 'idle', // idle | loading | done
  route: { name: 'none' },
  view: null,
  save: { state: 'idle', at: null },
  // last: the account set last; asked: the account the open decision asks for (null when it asks for none);
  // followed: the decision whose account was already looked at, so it is looked at once per change of decision
  session: { last: null, result: null, busy: false, asked: null, followed: null },
  nav: { collapsed: new Set(), undecidedOnly: false }, // the sidebar's collapsed sections and the "Undecided only" filter, remembered per board
  ui: { drawer: false, help: false, liveFull: false, photoFull: false, scale: null },
  frameEpoch: 0,
  pictures: { pending: [], errors: {} }, // pictures being saved (board, group, label) and the reason a picture was refused, per decision
  orphan: null, // id of the open decision that was removed from board.json while its note was unsaved (the board swap waits)
  boardRev: 0, // counts the times the board was replaced by a newer reading of board.json
  boardLoad: 0, // counts the times a board was opened (frames and panel start over only then, or when the open decision changed)
  notice: null, // { title, text }: what could not be saved for a decision that was removed from the board; stays until dismissed
};

/** Topics: pictures, route, boards, nav, decisions, review, assistant, health, save, session, ui, frames, scale */
export function subscribe(topics, fn) {
  const s = { topics: new Set(topics), fn };
  subs.add(s);
  return () => subs.delete(s);
}
function emit(...topics) {
  for (const s of [...subs]) {
    if (!topics.some((t) => s.topics.has(t))) continue;
    try {
      s.fn();
    } catch (err) {
      console.error('abcode: a view failed to draw', err);
    }
  }
}

// ---------- derived helpers ----------
export const currentGroup = () => (state.board && state.view ? state.board.groups.find((g) => g.id === state.view.group) : null);
export const currentOption = () => {
  const g = currentGroup();
  return g ? g.options.find((o) => o.id === state.view.option) : null;
};
const sigCache = new WeakMap(); // board object -> { group id -> signature }
/** The key the stage and the panel are built under: changes when the board is opened again or the open decision's own content changed. */
export function contentKey(g) {
  const board = state.board;
  let m = sigCache.get(board);
  if (!m) sigCache.set(board, (m = new Map()));
  if (!m.has(g.id)) m.set(g.id, groupSignature(board, g));
  return `${state.boardId}/${state.boardLoad}/${g.id}/${m.get(g.id)}`;
}
export const viewportById = (id) => state.board.viewports.find((v) => v.id === id);
export const groupHasLive = (g) => g.options.some((o) => o.live);
export const groupHasShots = (g) => g.options.some((o) => Object.values(o.shots).some((l) => l.length));
/** The viewports a view shows: all of them for "both". */
export const shownViewports = () => (state.view.viewport === 'both' ? state.board.viewports : [viewportById(state.view.viewport)]);

export function groupDecision(gid) {
  return state.decisions.groups[gid] || { choice: null, note: '', optionNotes: {}, pictures: [], updatedAt: null };
}
/** The rule itself lives in lib/rules.js, shared with the server. */
export function isDecided(group) {
  return groupIsDecided(group, state.decisions.groups[group.id]);
}
/** A stored choice that names an option the board no longer has. */
export function isStaleChoice(group) {
  const d = state.decisions.groups[group.id];
  return Boolean(group.pick !== 'none' && d && d.choice != null && !group.options.some((o) => o.id === d.choice));
}
export function decidedCount() {
  return state.board ? state.board.groups.filter(isDecided).length : 0;
}
/**
 * 'open' | 'finished' | 'changed'. The server derives it and the page takes its word (it arrives with
 * every load and every save). One exception, for the moments before a save lands: a finished
 * review with an edit still waiting to be sent already reads as changed.
 */
export function reviewState() {
  const r = state.review;
  if (!r) return 'open';
  return r.state === 'finished' && (dirty || changed.size) ? 'changed' : r.state;
}
export const finishedHref = () => buildHash({ name: 'finished', board: state.boardId });

/** The shot labels offered at the current size(s): the union, in first-seen order. */
export function shotLabels() {
  const g = currentGroup();
  const labels = [];
  const ids = shownViewports().map((v) => v.id);
  for (const o of g.options) for (const vid of ids) for (const s of o.shots[vid] || []) if (!labels.includes(s.label)) labels.push(s.label);
  return labels;
}
export function activeShotLabel() {
  const labels = shotLabels();
  return labels.includes(state.view.shot) ? state.view.shot : labels[0] || null;
}

// ---------- view state and the address ----------
export function resolveView(board, route, prev) {
  const group = board.groups.find((g) => g.id === route.group) || board.groups[0];
  const p = route.params || {};
  const vpIds = board.viewports.map((v) => v.id);
  const validVp = (v) => (v === 'both' ? vpIds.length >= 2 : vpIds.includes(v));
  const option = (group.options.find((o) => o.id === p.o) || group.options[0]).id;
  const viewport = validVp(p.v) ? p.v : group.defaultViewport || (prev && validVp(prev.viewport) ? prev.viewport : vpIds[0]);
  const hasLive = groupHasLive(group);
  const hasShots = groupHasShots(group);
  let mode = p.m === 'live' || p.m === 'shots' ? p.m : prev && prev.mode ? prev.mode : hasLive ? 'live' : 'shots';
  if (mode === 'live' && !hasLive && hasShots) mode = 'shots';
  if (mode === 'shots' && !hasShots && hasLive) mode = 'live';
  const layout = p.l === 'one' || p.l === 'side' ? p.l : prev && prev.layout ? prev.layout : 'one';
  return { group: group.id, option, viewport, mode, layout, shot: p.s || null };
}

const paramsOf = (v) => ({ o: v.option, v: v.viewport, m: v.mode, l: v.layout, s: v.shot });

let routeSeq = 0;

/** Applies a route: loads the board if needed, resolves the view, writes the normalized address. */
export async function applyRoute(route) {
  const seq = ++routeSeq;
  if (route.name === 'empty') {
    const last = lsGet('rb:last');
    const again = last ? parseHash(last) : { name: 'boards' };
    route = again.name === 'empty' ? { name: 'boards' } : again;
  }
  if (route.name === 'boards') {
    // The list is asked for again every time it is shown (going back from a board, the back button,
    // returning to the tab), after the board's pending edits are sent, so its counts are current.
    await flushNow();
    try {
      state.boards = await api.listBoards();
    } catch (err) {
      if (!state.boards) state.loadError = err.message;
    }
    if (seq !== routeSeq) return;
    if (state.boards && state.boards.length === 1) {
      history.replaceState(null, '', buildHash({ name: 'board', board: state.boards[0].id }));
      return applyRoute({ name: 'board', board: state.boards[0].id });
    }
    state.route = state.loadError ? { name: 'error' } : route;
    history.replaceState(null, '', '#/');
    emit('route', 'boards');
    return;
  }

  if (route.board !== state.boardId) {
    const ok = await loadBoardData(route.board);
    if (seq !== routeSeq) return;
    if (ok === 'blocked') {
      // unsaved changes to the current board: stay until they are saved
      if (state.route.name !== 'none') history.replaceState(null, '', buildHash(state.route));
      return;
    }
    if (!ok) {
      state.route = { name: 'error' };
      emit('route');
      return;
    }
  }
  const board = state.board;
  if (route.name === 'board') route = { name: 'group', board: board.id, group: board.groups[0].id, params: {} };
  if (route.name === 'group') {
    const view = resolveView(board, route, state.view);
    route = { name: 'group', board: board.id, group: view.group, params: paramsOf(view) };
    const want = buildHash(route);
    if (location.hash !== want) history.replaceState(null, '', want);
    state.view = view;
    if (state.orphan && state.orphan !== view.group) leaveOrphan();
    if (state.session.followed !== view.group) followSession(board.groups.find((g) => g.id === view.group));
  } else {
    // The finish page only exists once the review was finished; before that the summary is the place.
    if (route.name === 'finished' && !(state.review && state.review.submitted)) route = { name: 'summary', board: board.id };
    history.replaceState(null, '', buildHash(route));
    if (state.orphan) leaveOrphan();
  }
  state.route = route;
  state.ui.drawer = false;
  if (state.finish.ask) state.finish = { ...state.finish, ask: null };
  lsSet('rb:last', location.hash);
  emit('route');
}

/** Changes part of the view and writes it into the address (no new history entry). */
export function setView(patch) {
  if (!state.view || state.route.name !== 'group') return;
  const view = { ...state.view, ...patch };
  const route = { name: 'group', board: state.board.id, group: view.group, params: paramsOf(view) };
  history.replaceState(null, '', buildHash(route));
  applyRoute(route);
}

/** The groups the sidebar lists and the keys walk: all of them, or the undecided ones (and the open one) with the filter on. */
export function visibleList() {
  const activeId = state.route.name === 'group' && state.view ? state.view.group : null;
  return visibleGroups(state.board.groups, { undecidedOnly: state.nav.undecidedOnly, isDecided, activeId });
}

/** Opens or closes a section in the sidebar (the section that holds the open decision stays open while it does). */
export function toggleSection(key) {
  const next = new Set(state.nav.collapsed);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  state.nav = { ...state.nav, collapsed: next };
  lsSet(`rb:sections:${state.boardId}`, JSON.stringify([...next]));
  emit('nav');
}
export function setUndecidedOnly(on) {
  state.nav = { ...state.nav, undecidedOnly: on };
  lsSet(`rb:undecided:${state.boardId}`, on ? '1' : null);
  emit('nav');
}
function loadNav(id) {
  let collapsed = [];
  try {
    const raw = JSON.parse(lsGet(`rb:sections:${id}`) || '[]');
    if (Array.isArray(raw)) collapsed = raw.filter((x) => typeof x === 'string');
  } catch {}
  return { collapsed: new Set(collapsed), undecidedOnly: lsGet(`rb:undecided:${id}`) === '1' };
}

/** Moves to the previous or next decision among the visible ones. A section that holds it is shown open while it is the open one. */
export function goGroup(offset) {
  const board = state.board;
  if (!board || !state.view) return;
  const next = neighbour(visibleList(), state.view.group, offset);
  if (!next) return;
  location.hash = buildHash({ name: 'group', board: board.id, group: next.id, params: {} });
}

// ---------- loading ----------
async function loadBoardData(id) {
  await flushNow();
  if (dirty && state.boardId) return 'blocked'; // a retryable save is still failing: do not drop it by switching boards
  if (changed.size && state.boardId && (state.save.fatal || state.orphan)) {
    // the server refused the last save: ask before the edit is dropped, and keep the message on screen if the owner stays
    const ok = typeof confirm === 'function' ? confirm(`The last change was not saved (${state.orphan ? 'the decision was removed from the board' : state.save.message}). Leave this board and lose it?`) : false;
    if (!ok) return 'blocked';
  }
  changed.clear();
  state.orphan = null;
  state.notice = null;
  try {
    const [board, decisions] = await Promise.all([api.getBoard(id), api.getDecisions(id)]);
    state.board = board;
    state.boardId = id;
    state.decisions = { updatedAt: decisions.updatedAt || null, groups: decisions.groups || {} };
    state.review = decisions.review || null;
    state.assistant = { listening: false, received: false, known: false };
    state.finish = { ask: null, busy: false, error: null };
    state.view = null;
    state.loadError = null;
    state.health = {};
    state.session = { last: rememberedSession(board, lsGet), result: null, busy: false, asked: null, followed: null };
    state.nav = loadNav(id);
    state.save = { state: 'idle', at: null };
    state.frameEpoch = 0;
    state.boardRev++;
    state.boardLoad++;
    lastReload = Date.now();
    refreshHealth();
    if (!state.boards) api.listBoards().then((b) => { state.boards = b; emit('boards'); }).catch(() => {});
    return true;
  } catch (err) {
    state.loadError = err.message;
    state.board = null;
    state.boardId = null;
    return false;
  }
}

export async function refreshHealth() {
  const id = state.boardId;
  if (!id) return;
  state.healthState = 'loading';
  emit('health');
  let result;
  try {
    result = await api.getHealth(id);
  } catch {
    result = Object.fromEntries(Object.keys(state.board.targets).map((n) => [n, { ok: false, status: null, ms: 0 }]));
  }
  if (id !== state.boardId) return;
  state.health = result;
  state.healthState = 'done';
  emit('health');
}

export function reloadFrames() {
  state.frameEpoch++;
  emit('frames');
}

/** Sets the account through the session endpoint and reloads the frames. `auto` is true when a decision asked for it. */
export async function chooseSession(sessionId, { auto = false } = {}) {
  const id = state.boardId;
  const s = state.board.sessions.find((x) => x.id === sessionId);
  if (!s) return;
  state.session = { ...state.session, busy: true };
  emit('session');
  try {
    await api.postSession(id, sessionId);
    if (id !== state.boardId) return;
    const text = s.kind === 'clear' ? `${s.label}: cookies cleared. Frames reloaded.` : auto ? `Switched to ${s.label}${auto === 'decision' ? ' for this decision' : ''}. Frames reloaded.` : `Now using: ${s.label}. Frames reloaded.`;
    state.session = { ...state.session, last: sessionId, result: { ok: true, text }, busy: false };
    const host = hostOf(state.board.targets[s.target] && state.board.targets[s.target].origin);
    if (host) lsSet(sessionMemoryKey(host), sessionRecord(id, sessionId));
    emit('session');
    reloadFrames();
  } catch (err) {
    if (id !== state.boardId) return;
    state.session = { ...state.session, result: { ok: false, text: err.message }, busy: false };
    emit('session');
  }
}

/**
 * Another board on the same site (in this or another tab) may have set an account since this page did.
 * The cookie belongs to the host name, so then this page no longer knows which account the frames carry:
 * it says "Not set from this page yet" and the next decision that asks for an account sets it again.
 */
export function recheckSession() {
  if (!state.board || !state.session.last || state.session.busy) return;
  if (sessionClaimLost(state.board, state.session.last, lsGet)) {
    state.session = { ...state.session, last: null };
    emit('session');
  }
}

/**
 * Opening a decision makes its account active: the decision's own session, else the board's defaultSession.
 * Once per change of decision (a refusal is shown and not retried), and never while the page is hidden:
 * then it waits for the page to be seen again. A manual switch holds until the next decision.
 */
export function followSession(group) {
  if (!group || !state.board) return;
  recheckSession();
  const want = wantedSession(state.board, group);
  state.session = { ...state.session, followed: group.id, asked: group.session || null, result: null };
  if (!want) {
    emit('session');
    return;
  }
  if (!pageVisible()) {
    pendingFollow = group.id;
    emit('session');
    return;
  }
  pendingFollow = null;
  if (want === state.session.last) {
    emit('session');
    return;
  }
  chooseSession(want, { auto: group.session ? 'decision' : 'default' });
}
let pendingFollow = null;
/** The page is seen again: do the account change that was put off while it was hidden. */
export function resumeFollow() {
  if (!pendingFollow || !state.view || state.route.name !== 'group') return;
  if (pendingFollow !== state.view.group) {
    pendingFollow = null;
    return;
  }
  followSession(currentGroup());
}

// ---------- decisions and saving ----------
function mutate(gid, fn) {
  const cur = groupDecision(gid);
  const next = { choice: cur.choice, note: cur.note, optionNotes: { ...cur.optionNotes }, updatedAt: new Date().toISOString() };
  if (cur.done) next.done = true;
  if (cur.pictures && cur.pictures.length) next.pictures = cur.pictures; // the server's own: kept here, never sent
  fn(next);
  state.decisions.groups[gid] = next;
}

export function setChoice(gid, optionId) {
  const group = state.board.groups.find((g) => g.id === gid);
  if (!group || group.pick === 'none') return;
  mutate(gid, (d) => { d.choice = optionId; });
  queueSave(true, gid);
  emit('decisions');
}
export function toggleChoice(gid, optionId) {
  setChoice(gid, groupDecision(gid).choice === optionId ? null : optionId);
}
/** Marks a notes-only decision as looked at, or takes the mark off. */
export function toggleDone(gid) {
  const group = state.board.groups.find((g) => g.id === gid);
  if (!group || group.pick !== 'none') return;
  mutate(gid, (d) => {
    if (d.done) delete d.done;
    else d.done = true;
  });
  queueSave(true, gid);
  emit('decisions');
}
export function setNote(gid, text) {
  mutate(gid, (d) => { d.note = text; });
  queueSave(false, gid);
  emit('decisions');
}
export function setOptionNote(gid, optionId, text) {
  mutate(gid, (d) => {
    if (text) d.optionNotes[optionId] = text;
    else delete d.optionNotes[optionId];
  });
  queueSave(false, gid);
  emit('decisions');
}

// ---------- pictures ----------
export const PICTURE_LIMIT = 12;
export const PICTURE_MAX_BYTES = 10 * 1024 * 1024;
let pictureSeq = 0;

export const picturesOf = (gid) => {
  const p = groupDecision(gid).pictures;
  return Array.isArray(p) ? p : [];
};
export const pendingPictures = (gid) => state.pictures.pending.filter((p) => p.board === state.boardId && p.gid === gid);

function pictureError(gid, text) {
  if (text) state.pictures.errors[gid] = text;
  else delete state.pictures.errors[gid];
  emit('pictures');
}

function takePictureAnswer(id, gid, res) {
  if (id !== state.boardId) return;
  const dec = res.decision;
  const local = state.decisions.groups[gid];
  const pictures = dec && Array.isArray(dec.pictures) ? dec.pictures : [];
  if (local) {
    if (pictures.length) local.pictures = pictures;
    else delete local.pictures;
    if (!dirty && dec && dec.updatedAt) local.updatedAt = dec.updatedAt;
  } else if (dec) state.decisions.groups[gid] = { choice: null, note: '', optionNotes: {}, ...dec };
  state.decisions.updatedAt = res.updatedAt || state.decisions.updatedAt;
  if (res.review) state.review = res.review;
  emit('pictures', 'decisions', 'review');
}

/**
 * Adds picture files to a decision, one after the other. `ctx` is what was showing when they were added.
 * Whatever is refused is said in words next to the note (state.pictures.errors).
 */
export async function addPictures(gid, files, ctx) {
  const id = state.boardId;
  const group = state.board && state.board.groups.find((g) => g.id === gid);
  if (!id || !group) return;
  const list = [...files];
  if (!list.length) return;
  pictureError(gid, '');
  const problems = [];
  let room = PICTURE_LIMIT - picturesOf(gid).length - pendingPictures(gid).length;
  for (const file of list) {
    if (room <= 0) {
      problems.push(`This decision can hold ${PICTURE_LIMIT} pictures. Remove one first.`);
      break;
    }
    if (file.size > PICTURE_MAX_BYTES) {
      problems.push(`${file.name || 'That picture'} is larger than 10 MB.`);
      continue;
    }
    room--;
    const entry = { key: ++pictureSeq, board: id, gid };
    state.pictures.pending.push(entry);
    emit('pictures');
    try {
      takePictureAnswer(id, gid, await api.uploadPicture(id, gid, file, ctx));
    } catch (err) {
      problems.push(err.message);
    } finally {
      state.pictures.pending = state.pictures.pending.filter((p) => p !== entry);
      emit('pictures');
    }
  }
  if (problems.length) pictureError(gid, [...new Set(problems)].join(' '));
}

export async function removePicture(gid, file) {
  const id = state.boardId;
  const name = String(file).split('/').pop();
  pictureError(gid, '');
  try {
    takePictureAnswer(id, gid, await api.deletePicture(id, gid, name));
  } catch (err) {
    pictureError(gid, err.message);
  }
}

let timer = null;
let retryTimer = null;
let inflight = null;
let dirty = false;
const changed = new Set(); // groups edited since the last successful save
let retryDelay = 2000;

function setSave(s, extra = {}) {
  state.save = { state: s, at: state.save.at, ...extra };
  emit('save');
}

function queueSave(immediate, gid) {
  dirty = true;
  if (gid) changed.add(gid);
  clearTimeout(timer);
  clearTimeout(retryTimer);
  setSave('saving');
  timer = setTimeout(flush, immediate ? 0 : 600);
}

/** Only the groups changed since the last save, and only what the current board still has. */
function payload(ids = changed) {
  const groups = {};
  for (const gid of ids) {
    const group = state.board && state.board.groups.find((g) => g.id === gid);
    const d = state.decisions.groups[gid];
    if (!group || !d) continue;
    const has = (oid) => group.options.some((o) => o.id === oid);
    const optionNotes = {};
    for (const [oid, t] of Object.entries(d.optionNotes || {})) if (has(oid)) optionNotes[oid] = t;
    groups[gid] = { choice: d.choice != null && has(d.choice) ? d.choice : null, note: d.note, optionNotes };
    if (group.pick === 'none') groups[gid].done = d.done === true;
  }
  return { board: state.boardId, groups };
}

async function flush() {
  clearTimeout(timer);
  if (inflight) return inflight;
  if (!dirty || !state.boardId) return;
  // Worked out before the request exists, so that nothing to send never leaves a settled promise in `inflight`.
  dirty = false;
  const id = state.boardId;
  const all = new Set(changed);
  const sent = new Set([...all].filter((g) => g !== state.orphan));
  changed.clear();
  if (state.orphan && all.has(state.orphan)) changed.add(state.orphan); // kept: it cannot be sent, and it blocks being replaced
  if (!sent.size) {
    if (state.save.state === 'saving') setSave(state.save.at ? 'saved' : 'idle');
    return;
  }
  inflight = (async () => {
    try {
      const saved = await api.saveDecisions(id, payload(sent));
      if (id === state.boardId) {
        for (const [gid, g] of Object.entries(saved.groups || {})) {
          const local = state.decisions.groups[gid];
          if (local && !dirty) local.updatedAt = g.updatedAt;
        }
        state.decisions.updatedAt = saved.updatedAt;
        if (saved.review) state.review = saved.review;
      }
      retryDelay = 2000;
      state.save = { state: dirty ? 'saving' : 'saved', at: saved.updatedAt || new Date().toISOString() };
      emit('save', 'decisions', 'review');
    } catch (err) {
      for (const gid of sent) changed.add(gid);
      if (err.status >= 400 && err.status < 500) {
        // the server understood and refused: a retry cannot succeed; the next edit tries again
        setSave('error', { message: err.message, fatal: true });
      } else {
        dirty = true;
        setSave('error');
        retryTimer = setTimeout(flush, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15000);
      }
    } finally {
      inflight = null;
      if (dirty && state.save.state !== 'error') timer = setTimeout(flush, 0);
    }
  })();
  return inflight;
}

export async function flushNow() {
  if (inflight) await inflight;
  if (dirty) await flush();
}

export function saveLabel() {
  const s = state.save;
  if (state.orphan) return 'This decision was removed from the board. New text is not saved.';
  if (s.state === 'saving') return 'Saving…';
  if (s.state === 'error') return s.fatal ? `Could not save: ${s.message}` : 'Could not save, retrying';
  if (s.state === 'saved') return `Saved ${clock(s.at)}`;
  return state.decisions.updatedAt ? `Saved ${clock(state.decisions.updatedAt)}` : 'Nothing to save yet';
}

// ---------- the board changed on disk ----------
// An assistant often edits board.json while the reviewer is away. When the tab is seen again or the
// window regains focus, the board, the decisions and the review state are read again (at most once
// every RELOAD_MIN_MS). A changed board is redrawn and the open decision stays open when it still
// exists, else the first undecided one opens. Edits waiting to be saved are never replaced, and a
// note being typed stays in its field.
export const RELOAD_MIN_MS = 4000;
let lastReload = 0;
let reloading = false;

export async function refreshBoardFromDisk({ force = false } = {}) {
  const id = state.boardId;
  if (!id || !state.board || reloading || !['group', 'summary', 'finished'].includes(state.route.name)) return;
  if (!force && !dueForRefresh(Date.now(), lastReload, RELOAD_MIN_MS)) return;
  lastReload = Date.now();
  reloading = true;
  try {
    let board;
    let d;
    try {
      [board, d] = await Promise.all([api.getBoard(id), api.getDecisions(id)]);
    } catch {
      return; // a board that is broken for the moment, or a server that is away: keep what is on screen
    }
    if (id !== state.boardId) return;
    const editing = () => dirty || inflight || changed.size > 0;
    let decisionsChanged = false;
    let reviewChanged = false;
    if (!editing()) {
      if (JSON.stringify(d.groups || {}) !== JSON.stringify(state.decisions.groups)) {
        state.decisions = { updatedAt: d.updatedAt || null, groups: d.groups || {} };
        decisionsChanged = true;
      }
      if (JSON.stringify(d.review || null) !== JSON.stringify(state.review)) {
        state.review = d.review || null;
        reviewChanged = true;
      }
    }
    if (boardChanged(board, state.board)) {
      const openId = state.route.name === 'group' && state.view ? state.view.group : null;
      if (state.orphan && state.orphan !== openId) releaseOrphan(); // the reviewer moved on from the note that could not be kept
      const removed = Boolean(openId) && !board.groups.some((g) => g.id === openId);
      if (removed && (changed.has(openId) || dirty || inflight)) await flushNow(); // sent now if the server still accepts it
      if (id !== state.boardId) return;
      const inNote = typeof document !== 'undefined' && document.activeElement && (document.activeElement.id === 'note-group' || document.activeElement.id === 'note-option');
      if (mustHoldBoard({ removed, hasUnsaved: changed.has(openId) || Boolean(inNote) })) {
        // The open decision is gone and its note cannot be saved: keep the old board and the text on screen,
        // say so, and wait until the reviewer discards it (or moves to another decision).
        if (state.orphan !== openId) {
          state.orphan = openId;
          emit('save');
        }
        if ([...changed].some((g) => g !== openId)) {
          dirty = true;
          flush();
        }
        return;
      }
      if (state.orphan) {
        state.orphan = null; // nothing unsaved is left for the removed decision: the new board can come in
        emit('save');
      }
      // the sites are asked again; what was known stays on screen meanwhile unless the sites themselves changed
      if (JSON.stringify(board.targets) !== JSON.stringify(state.board.targets)) state.health = {};
      state.board = board;
      state.boardRev++;
      refreshHealth();
      const route = state.route;
      if (route.name === 'group' && state.view) {
        const open = landingGroup(board, state.view.group, isDecided);
        const params = open === state.view.group ? paramsOf(state.view) : {};
        const keep = { drawer: state.ui.drawer, ask: state.finish.ask };
        applyRoute({ name: 'group', board: id, group: open, params });
        if (keep.drawer) setUi({ drawer: true });
        if (keep.ask) askFinish(keep.ask);
      } else applyRoute({ ...route });
    } else {
      if (decisionsChanged) emit('decisions');
      if (reviewChanged) emit('review');
    }
  } finally {
    reloading = false;
  }
}

/**
 * The reviewer left the decision that was removed from the board while its text was unsaved: say once, in a
 * notice that stays until dismissed, that the text was not saved (and keep it there to copy), clear the
 * warning that belonged to that decision, and let the board come in.
 */
function releaseOrphan() {
  const gid = state.orphan;
  if (!gid) return;
  const g = state.board && state.board.groups.find((x) => x.id === gid);
  // only text that never reached decisions.json is lost; a note that was saved already needs no notice
  const text = changed.has(gid) ? heldText(state.decisions.groups[gid], g) : '';
  if (text) state.notice = { title: g ? g.title : gid, text };
  dropOrphan();
  emit('notice');
}
function leaveOrphan() {
  releaseOrphan();
  refreshBoardFromDisk({ force: true });
}
export function dismissNotice() {
  if (!state.notice) return;
  state.notice = null;
  emit('notice');
}

/** Forgets the note of a decision that was removed from the board; the unsaved text is dropped. */
function dropOrphan() {
  if (!state.orphan) return;
  changed.delete(state.orphan);
  state.orphan = null;
  state.save = { state: 'idle', at: state.save.at };
  emit('save');
}

/** The reviewer accepts that the removed decision's note is lost: take in the new board now. */
export function discardRemovedNote() {
  dropOrphan();
  return refreshBoardFromDisk({ force: true });
}

// ---------- finishing the review ----------
/** Opens the inline confirmation in one place ('sidebar' or 'summary'), or closes it with null. */
export function askFinish(where) {
  if (where && reviewState() === 'finished') return; // nothing to confirm; a stored ask would pop up after the next edit
  state.finish = { ...state.finish, ask: where, error: null };
  emit('review');
}

/** Sends the pending edits, then finishes the review and shows the finish page. */
export async function finishReview() {
  const id = state.boardId;
  if (!id || state.finish.busy) return;
  state.finish = { ask: null, busy: true, error: null };
  emit('review');
  try {
    await flushNow();
    if (dirty || changed.size) throw new Error('Your last change is not saved yet. Try again in a moment.');
    const res = await api.submit(id);
    if (id !== state.boardId) return;
    state.review = res.review;
    state.decisions.updatedAt = res.updatedAt || state.decisions.updatedAt;
    state.finish = { ask: null, busy: false, error: null };
    state.assistant = { ...state.assistant, received: false };
    emit('review');
    startStatusPolling();
    const target = buildHash({ name: 'finished', board: id });
    if (location.hash === target) applyRoute(parseHash(target));
    else location.hash = target;
  } catch (err) {
    state.finish = { ask: null, busy: false, error: err.message };
    emit('review');
  }
}

// ---------- is an assistant waiting? ----------
// GET /status says whether `abcode-wait` is running for this board and whether it received the
// last finish. It is asked every 3 seconds while the page is visible and a board is open, every second
// on the finish page while the answer is still open. A failing answer stops the polling until the
// page is used again (a route change or coming back to the tab).
export const ASSISTANT_PATIENCE_MS = 15000;
const pageVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
let statusTimer = null;
let statusBusy = false;

/** What the finish page says about the assistant: 'received' | 'telling' | 'nobody', and after a change 'earlier' | 'waiting'. */
export function assistantStatus(now = Date.now()) {
  const sub = state.review && state.review.submitted;
  const a = state.assistant;
  const rs = reviewState();
  if (rs === 'changed') return a.received ? 'earlier' : a.listening ? 'waiting' : 'nobody';
  if (a.received) return 'received';
  if (sub && a.listening && now - Date.parse(sub.at) < ASSISTANT_PATIENCE_MS) return 'telling';
  return 'nobody';
}

export async function refreshStatus() {
  const id = state.boardId;
  if (!id || statusBusy) return;
  statusBusy = true;
  try {
    const s = await api.getStatus(id);
    if (id !== state.boardId) return;
    const next = { listening: s.listening === true, received: s.received === true, known: true };
    const a = state.assistant;
    if (a.listening !== next.listening || a.received !== next.received || !a.known) {
      state.assistant = next;
      emit('assistant');
    }
  } catch {
    // the server did not answer: do not claim an assistant is waiting, and stop asking
    if (id === state.boardId && (state.assistant.listening || !state.assistant.known)) {
      state.assistant = { listening: false, received: state.assistant.received, known: false };
      emit('assistant');
    }
    stopStatusPolling();
    return;
  } finally {
    statusBusy = false;
  }
  scheduleStatus();
}

function scheduleStatus() {
  clearTimeout(statusTimer);
  if (!state.boardId || state.route.name === 'boards' || !pageVisible()) return;
  const open = state.route.name === 'finished' && assistantStatus() === 'telling';
  statusTimer = setTimeout(refreshStatus, open ? 1000 : 3000);
}

export function stopStatusPolling() {
  clearTimeout(statusTimer);
  statusTimer = null;
}

/** Starts (or restarts) the polling with an immediate question. */
export function startStatusPolling() {
  stopStatusPolling();
  if (state.boardId && state.route.name !== 'boards' && pageVisible()) refreshStatus();
}

export function beaconSave() {
  if ((dirty || changed.size) && state.boardId) api.saveBeacon(state.boardId, payload());
}

export function setUi(patch) {
  Object.assign(state.ui, patch);
  emit('ui');
}
export function setScale(scale) {
  if (state.ui.scale !== scale) {
    state.ui.scale = scale;
    emit('scale');
  }
}
