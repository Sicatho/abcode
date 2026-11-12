// The hash is the address of a view: #/b/<board>/g/<group>?o=&v=&m=&l=&s=  , #/b/<board>/summary and #/b/<board>/finished
const KEYS = ['o', 'v', 'm', 'l', 's'];

function dec(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parseHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  if (!h) return { name: 'empty' };
  const q = h.indexOf('?');
  const pathPart = q === -1 ? h : h.slice(0, q);
  const query = q === -1 ? '' : h.slice(q + 1);
  const segs = pathPart.split('/').filter(Boolean).map(dec);
  if (segs[0] === 'b' && segs[1]) {
    const board = segs[1];
    if (segs[2] === 'summary') return { name: 'summary', board };
    if (segs[2] === 'finished') return { name: 'finished', board };
    if (segs[2] === 'g' && segs[3]) {
      const params = {};
      const sp = new URLSearchParams(query);
      for (const k of KEYS) if (sp.has(k)) params[k] = sp.get(k);
      return { name: 'group', board, group: segs[3], params };
    }
    return { name: 'board', board };
  }
  return { name: 'boards' };
}

export function buildHash(route) {
  const e = encodeURIComponent;
  if (route.name === 'boards') return '#/';
  if (route.name === 'summary') return `#/b/${e(route.board)}/summary`;
  if (route.name === 'finished') return `#/b/${e(route.board)}/finished`;
  if (route.name === 'board') return `#/b/${e(route.board)}`;
  const sp = [];
  for (const k of KEYS) {
    const v = route.params && route.params[k];
    if (v !== undefined && v !== null && v !== '') sp.push(`${k}=${e(v)}`);
  }
  return `#/b/${e(route.board)}/g/${e(route.group)}${sp.length ? '?' + sp.join('&') : ''}`;
}

export function groupHref(board, group) {
  return buildHash({ name: 'group', board, group, params: {} });
}
