// Finds boards/<id>/board.json, validates it and returns a normalized board.
import fs from 'node:fs';
import path from 'node:path';

export const ID_RE = /^[a-z0-9-]+$/;
const INNER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const COOKIE_NAME_RE = /^[A-Za-z0-9!#$%&*+.^_`|~-]+$/;
export const DEFAULT_VIEWPORTS = [
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900 },
  { id: 'phone', label: 'Phone', width: 390, height: 844 },
];

export class BoardError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function boardFile(boardsDir, id) {
  return path.join(boardsDir, id, 'board.json');
}

export function listBoardIds(boardsDir) {
  let entries;
  try {
    entries = fs.readdirSync(boardsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && ID_RE.test(e.name) && fs.existsSync(boardFile(boardsDir, e.name)))
    .map((e) => e.name)
    .sort();
}

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

/** Reads and validates one board. Throws BoardError with a sentence naming the file and the field. */
export function loadBoard(boardsDir, id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new BoardError(404, `There is no board called "${id}".`);
  const file = boardFile(boardsDir, id);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new BoardError(404, `There is no board called "${id}" (looked for ${file}).`);
  }
  let raw;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    throw new BoardError(500, `${file} is not valid JSON: ${err.message}`);
  }
  return normalizeBoard(id, raw, file, path.dirname(file));
}

export function normalizeBoard(id, raw, file, dir) {
  const bad = (field, why) => new BoardError(500, `${file}: "${field}" ${why}.`);
  if (!isObj(raw)) throw bad('(root)', 'must be an object');
  const str = (v, field, { required = false, fallback = '' } = {}) => {
    if (v === undefined || v === null) {
      if (required) throw bad(field, 'is required');
      return fallback;
    }
    if (typeof v !== 'string') throw bad(field, 'must be a string');
    if (required && !v.trim()) throw bad(field, 'must not be empty');
    return v;
  };
  // An optional text of 1 to max characters (spaces at the ends are dropped). Absent means null.
  const shortText = (v, field, max) => {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') throw bad(field, 'must be a string');
    const t = v.trim();
    if (!t || t.length > max) throw bad(field, `must be 1 to ${max} characters`);
    return t;
  };
  // An optional list of at most maxItems texts of 1 to maxLen characters. Absent means [].
  const textList = (v, field, maxItems, maxLen) => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) throw bad(field, 'must be a list of strings');
    if (v.length > maxItems) throw bad(field, `must have at most ${maxItems} items`);
    return v.map((item, i) => {
      if (typeof item !== 'string') throw bad(`${field}[${i}]`, 'must be a string');
      return shortText(item, `${field}[${i}]`, maxLen);
    });
  };
  const innerId = (v, field) => {
    const s = str(v, field, { required: true });
    if (!INNER_ID_RE.test(s)) throw bad(field, `has characters other than letters, digits, - and _ ("${s}")`);
    return s;
  };

  const title = str(raw.title, 'title', { required: true });
  const subtitle = str(raw.subtitle, 'subtitle');

  // targets
  const targets = {};
  if (raw.targets !== undefined) {
    if (!isObj(raw.targets)) throw bad('targets', 'must be an object');
    for (const [name, t] of Object.entries(raw.targets)) {
      const f = `targets.${name}`;
      if (!isObj(t)) throw bad(f, 'must be an object');
      const origin = str(t.origin, `${f}.origin`, { required: true });
      let u;
      try {
        u = new URL(origin);
      } catch {
        throw bad(`${f}.origin`, `is not a web address ("${origin}")`);
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw bad(`${f}.origin`, 'must start with http:// or https://');
      // What the frames of this target may use (the iframe's allow attribute): feature names separated by semicolons.
      const allow = str(t.allow, `${f}.allow`).trim();
      if (allow && (allow.length > 200 || !/^[a-z][a-z-]*(?: *; *[a-z][a-z-]*)* *;?$/.test(allow))) throw bad(`${f}.allow`, 'must be feature names separated by semicolons, for example "translator; language-detector"');
      targets[name] = { label: str(t.label, `${f}.label`) || name, origin: u.origin, hint: str(t.hint, `${f}.hint`), ...(allow ? { allow } : {}) };
    }
  }

  // viewports
  let viewports = DEFAULT_VIEWPORTS.map((v) => ({ ...v }));
  if (raw.viewports !== undefined) {
    if (!Array.isArray(raw.viewports) || raw.viewports.length === 0) throw bad('viewports', 'must be a non-empty list');
    viewports = [];
    raw.viewports.forEach((v, i) => {
      const f = `viewports[${i}]`;
      if (!isObj(v)) throw bad(f, 'must be an object');
      const vid = innerId(v.id, `${f}.id`);
      if (viewports.some((x) => x.id === vid)) throw bad(`${f}.id`, `"${vid}" is used twice`);
      for (const k of ['width', 'height']) {
        if (!Number.isInteger(v[k]) || v[k] < 100 || v[k] > 10000) throw bad(`${f}.${k}`, 'must be a whole number of pixels between 100 and 10000');
      }
      viewports.push({ id: vid, label: str(v.label, `${f}.label`) || vid, width: v.width, height: v.height });
    });
  }
  const viewportIds = new Set(viewports.map((v) => v.id));

  // asset roots
  const assetRoots = {};
  const assetDirs = {};
  if (raw.assetRoots !== undefined) {
    if (!isObj(raw.assetRoots)) throw bad('assetRoots', 'must be an object');
    for (const [name, folder] of Object.entries(raw.assetRoots)) {
      if (!/^[A-Za-z0-9_-]+$/.test(name)) throw bad(`assetRoots.${name}`, 'has a name with characters other than letters, digits, - and _');
      if (typeof folder !== 'string' || !folder) throw bad(`assetRoots.${name}`, 'must be a folder path');
      assetRoots[name] = folder;
      assetDirs[name] = path.resolve(dir, folder);
    }
  }

  // sessions
  const sessionDefs = [];
  if (raw.sessions !== undefined) {
    if (!Array.isArray(raw.sessions)) throw bad('sessions', 'must be a list');
    raw.sessions.forEach((s, i) => {
      const f = `sessions[${i}]`;
      if (!isObj(s)) throw bad(f, 'must be an object');
      const sid = innerId(s.id, `${f}.id`);
      if (sessionDefs.some((x) => x.id === sid)) throw bad(`${f}.id`, `"${sid}" is used twice`);
      const target = str(s.target, `${f}.target`, { required: true });
      if (!targets[target]) throw bad(`${f}.target`, `names "${target}", which is not in targets`);
      const def = { id: sid, label: str(s.label, `${f}.label`) || sid, target };
      if (s.cookie !== undefined) {
        const c = s.cookie;
        if (!isObj(c)) throw bad(`${f}.cookie`, 'must be an object');
        def.cookie = {
          name: str(c.name, `${f}.cookie.name`, { required: true }),
          file: str(c.file, `${f}.cookie.file`, { required: true }),
          jsonPath: str(c.jsonPath, `${f}.cookie.jsonPath`, { required: true }),
          stripPrefix: str(c.stripPrefix, `${f}.cookie.stripPrefix`),
        };
        if (!COOKIE_NAME_RE.test(def.cookie.name)) throw bad(`${f}.cookie.name`, 'is not a valid cookie name');
      } else if (s.clear !== undefined) {
        if (!Array.isArray(s.clear) || s.clear.length === 0 || s.clear.some((n) => typeof n !== 'string' || !COOKIE_NAME_RE.test(n))) {
          throw bad(`${f}.clear`, 'must be a list of cookie names');
        }
        def.clear = s.clear.slice();
      } else {
        throw bad(f, 'needs either "cookie" or "clear"');
      }
      sessionDefs.push(def);
    });
  }

  // the account a board opens its decisions with, unless a decision asks for another
  let defaultSession = null;
  if (raw.defaultSession !== undefined && raw.defaultSession !== null) {
    if (typeof raw.defaultSession !== 'string') throw bad('defaultSession', 'must be a string');
    if (!sessionDefs.some((s) => s.id === raw.defaultSession)) throw bad('defaultSession', `names "${raw.defaultSession}", which is not in sessions`);
    defaultSession = raw.defaultSession;
  }

  // groups
  if (!Array.isArray(raw.groups) || raw.groups.length === 0) throw bad('groups', 'must be a non-empty list');
  const groups = [];
  raw.groups.forEach((g, gi) => {
    const f = `groups[${gi}]`;
    if (!isObj(g)) throw bad(f, 'must be an object');
    const gid = innerId(g.id, `${f}.id`);
    if (groups.some((x) => x.id === gid)) throw bad(`${f}.id`, `"${gid}" is used twice`);
    const pick = g.pick === undefined ? 'one' : g.pick;
    if (pick !== 'one' && pick !== 'none') throw bad(`${f}.pick`, 'must be "one" or "none"');
    if (!Array.isArray(g.options) || g.options.length === 0) throw bad(`${f}.options`, 'must be a non-empty list');
    const options = [];
    g.options.forEach((o, oi) => {
      const of = `${f}.options[${oi}]`;
      if (!isObj(o)) throw bad(of, 'must be an object');
      const oid = innerId(o.id, `${of}.id`);
      if (options.some((x) => x.id === oid)) throw bad(`${of}.id`, `"${oid}" is used twice in group "${gid}"`);
      let notes = [];
      if (o.notes !== undefined) {
        if (!Array.isArray(o.notes) || o.notes.some((n) => typeof n !== 'string')) throw bad(`${of}.notes`, 'must be a list of strings');
        notes = o.notes.slice();
      }
      let live = null;
      if (o.live !== undefined && o.live !== null) {
        if (!isObj(o.live)) throw bad(`${of}.live`, 'must be an object');
        if (o.live.url !== undefined) {
          const url = str(o.live.url, `${of}.live.url`, { required: true });
          let u;
          try {
            u = new URL(url);
          } catch {
            throw bad(`${of}.live.url`, `is not a web address ("${url}")`);
          }
          if (u.protocol !== 'http:' && u.protocol !== 'https:') throw bad(`${of}.live.url`, 'must start with http:// or https://');
          live = { target: null, url: u.href };
        } else {
          const tname = str(o.live.target, `${of}.live.target`, { required: true });
          if (!targets[tname]) throw bad(`${of}.live.target`, `names "${tname}", which is not in targets`);
          const p = str(o.live.path, `${of}.live.path`) || '/';
          if (!p.startsWith('/')) throw bad(`${of}.live.path`, 'must start with /');
          const query = {};
          if (o.live.query !== undefined) {
            if (!isObj(o.live.query)) throw bad(`${of}.live.query`, 'must be an object');
            for (const [k, v] of Object.entries(o.live.query)) {
              if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw bad(`${of}.live.query.${k}`, 'must be a string');
              query[k] = String(v);
            }
          }
          const u = new URL(p, targets[tname].origin + '/');
          for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v); // an empty value stays: ?ui=
          live = { target: tname, url: u.href, ...(targets[tname].allow ? { allow: targets[tname].allow } : {}) };
        }
      }
      const shots = {};
      if (o.shots !== undefined) {
        if (!isObj(o.shots)) throw bad(`${of}.shots`, 'must be an object');
        for (const [vid, list] of Object.entries(o.shots)) {
          const sf = `${of}.shots.${vid}`;
          if (!viewportIds.has(vid)) throw bad(sf, `is not one of the viewports (${[...viewportIds].join(', ')})`);
          if (!Array.isArray(list)) throw bad(sf, 'must be a list');
          shots[vid] = list.map((s, si) => {
            const pf = `${sf}[${si}]`;
            if (!isObj(s)) throw bad(pf, 'must be an object');
            const label = str(s.label, `${pf}.label`, { required: true });
            const src = str(s.src, `${pf}.src`, { required: true });
            const slash = src.indexOf('/');
            const rootName = slash > 0 ? src.slice(0, slash) : '';
            if (!rootName || !assetRoots[rootName]) {
              throw bad(`${pf}.src`, `must start with an asset root name and a slash (one of: ${Object.keys(assetRoots).join(', ') || 'none defined'}), got "${src}"`);
            }
            const tail = src.slice(slash + 1);
            if (!tail || tail.split('/').some((seg) => seg === '..' || seg === '' || seg === '.')) throw bad(`${pf}.src`, `is not a clean path ("${src}")`);
            return { label, src, url: `/boards/${id}/assets/${rootName}/${tail.split('/').map(encodeURIComponent).join('/')}` };
          });
        }
      }
      options.push({ id: oid, label: str(o.label, `${of}.label`) || oid, summary: str(o.summary, `${of}.summary`), notes, live, shots });
    });
    let recommended = null;
    if (g.recommended !== undefined && g.recommended !== null) {
      if (typeof g.recommended !== 'string' || !options.some((o) => o.id === g.recommended)) {
        throw bad(`${f}.recommended`, `names "${g.recommended}", which is not an option of this group`);
      }
      recommended = g.recommended;
    }
    let defaultViewport = null;
    if (g.defaultViewport !== undefined && g.defaultViewport !== null) {
      if (!viewportIds.has(g.defaultViewport)) throw bad(`${f}.defaultViewport`, `names "${g.defaultViewport}", which is not one of the viewports`);
      defaultViewport = g.defaultViewport;
    }
    const section = shortText(g.section, `${f}.section`, 60);
    const steps = textList(g.steps, `${f}.steps`, 8, 300);
    const caveats = textList(g.caveats, `${f}.caveats`, 6, 300);
    let session = null;
    if (g.session !== undefined && g.session !== null) {
      if (typeof g.session !== 'string') throw bad(`${f}.session`, 'must be a string');
      if (!sessionDefs.some((s) => s.id === g.session)) throw bad(`${f}.session`, `names "${g.session}", which is not in sessions`);
      session = g.session;
    }
    groups.push({
      id: gid,
      title: str(g.title, `${f}.title`) || gid,
      question: str(g.question, `${f}.question`),
      description: str(g.description, `${f}.description`),
      pick,
      recommended,
      defaultViewport,
      section,
      steps,
      caveats,
      session,
      options,
    });
  });

  return {
    id,
    title,
    subtitle,
    targets,
    viewports,
    assetRoots,
    assetDirs, // server only: never sent to the page
    sessionDefs, // server only
    defaultSession,
    sessions: sessionDefs.map((s) => ({ id: s.id, label: s.label, target: s.target, kind: s.cookie ? 'set' : 'clear' })),
    groups,
    dir,
  };
}

/** The shape sent to the page: no absolute asset folders, no cookie files. */
export function publicBoard(board, decisionsPath) {
  const { assetDirs, sessionDefs, dir, assetRoots, ...rest } = board;
  return { ...rest, decisionsPath };
}
