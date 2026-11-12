// The stage: live frames (kept alive, moved by transform) and photographs (one shared scroll position).
import { h } from '../lib/dom.js';
import { state, subscribe, currentGroup, currentOption, shownViewports, refreshHealth, setView, setScale, groupHasShots, activeShotLabel, contentKey } from '../store.js';

const BEZEL = 6;
const PAD = 20;
const GAP = 20;
const CAP = 42;

export function mountStage(root) {
  const liveScroll = h('div', { class: 'live-scroll' });
  const layer = h('div', { class: 'live-layer' });
  const caps = h('div', { class: 'caption-layer' });
  liveScroll.append(layer);
  const card = h('div', { class: 'stage-card', role: 'status' });
  const photoRoot = h('div', { class: 'photo-root' });
  root.replaceChildren(liveScroll, card, photoRoot);

  // ---------- live ----------
  const frames = new Map(); // "<option>|<viewport>" -> record
  let frameGroup = null;
  let seenEpoch = 0;
  let forceBackground = false;
  let bgTimer = null;

  function ensureFrame(opt, vp) {
    const key = `${opt.id}|${vp.id}`;
    let rec = frames.get(key);
    if (rec) return rec;
    const loadingEl = h('div', { class: 'frame-loading' }, 'Loading…');
    const iframe = h('iframe', { title: `${opt.label}, ${vp.label} ${vp.width} by ${vp.height}`, width: vp.width, height: vp.height, style: `width:${vp.width}px;height:${vp.height}px` });
    const wrap = h('div', { class: 'frame-wrap not-started', style: 'visibility:hidden' }, iframe, loadingEl);
    rec = { key, opt, vp, wrap, iframe, loadingEl, url: opt.live.url, started: false, loaded: false, shown: false };
    iframe.addEventListener('load', () => {
      if (!rec.started) return;
      rec.loaded = true;
      rec.loadingEl.hidden = true;
      schedule();
    });
    frames.set(key, rec);
    layer.append(wrap);
    return rec;
  }

  function start(rec) {
    if (rec.started) return;
    rec.started = true;
    rec.wrap.classList.remove('not-started');
    rec.iframe.src = rec.url;
  }

  /** The shown frames load first; the rest of the decision's frames follow once those have loaded. */
  function schedule() {
    const shown = [...frames.values()].filter((r) => r.shown);
    shown.forEach(start);
    const ready = shown.every((r) => r.loaded);
    if (ready || forceBackground) {
      for (const r of frames.values()) start(r);
    } else if (!bgTimer) {
      bgTimer = setTimeout(() => {
        bgTimer = null;
        forceBackground = true;
        schedule();
      }, 4000);
    }
  }

  function showCard(content) {
    liveScroll.hidden = true;
    card.hidden = false;
    card.replaceChildren(h('div', null, content));
    setScale(null);
  }

  function updateLive(g) {
    photoRoot.hidden = true;
    const v = state.view;
    const opt = currentOption();
    const sizes = shownViewports();
    const opts = v.layout === 'side' ? g.options.filter((o) => o.live) : [opt];
    const showPhotos = groupHasShots(g) ? h('button', { type: 'button', class: 'btn', onclick: () => setView({ mode: 'shots' }) }, 'Show photographs instead') : null;

    if (!opts.length || !opts.every((o) => o.live)) {
      return showCard([
        h('h3', null, 'This option has no live view'),
        h('p', { class: 'muted' }, `${opt.label} is only available as photographs.`),
        h('div', { class: 'row' }, showPhotos),
      ]);
    }
    const targets = [...new Set(opts.map((o) => o.live.target).filter(Boolean))];
    if (targets.some((t) => !state.health[t]) && state.healthState !== 'done') {
      return showCard([h('h3', null, 'Checking the site…'), h('p', { class: 'muted' }, targets.map((t) => state.board.targets[t].label).join(', '))]);
    }
    const down = targets.find((t) => !(state.health[t] && state.health[t].ok));
    if (down) {
      const t = state.board.targets[down];
      return showCard([
        h('h3', null, `${t.label} is not answering`),
        h('p', null, 'Nothing replied at ', h('code', null, t.origin), '.'),
        t.hint ? h('p', null, t.hint) : null,
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => refreshHealth(), disabled: state.healthState === 'loading' ? true : null }, state.healthState === 'loading' ? 'Checking…' : 'Retry'), showPhotos),
      ]);
    }
    card.hidden = true;
    liveScroll.hidden = false;
    layoutFrames(g, opts, sizes);
  }

  function layoutFrames(g, opts, sizes) {
    const v = state.view;
    const W = liveScroll.clientWidth;
    const H = liveScroll.clientHeight;
    if (!W || !H) return;

    if (state.frameEpoch !== seenEpoch) {
      seenEpoch = state.frameEpoch;
      for (const r of frames.values()) {
        if (!r.started) continue;
        r.loaded = false;
        r.loadingEl.hidden = false;
        r.iframe.src = r.url;
      }
    }

    let rows;
    if (v.layout === 'side') rows = sizes.length > 1 ? sizes.map((vp) => opts.map((o) => ({ o, vp }))) : [opts.map((o) => ({ o, vp: sizes[0] }))];
    else rows = [sizes.map((vp) => ({ o: opts[0], vp }))];

    // every live option of the decision at the shown sizes is kept loaded
    for (const r of frames.values()) r.shown = false;
    const placed = new Map();
    const cellRecs = rows.map((row) => row.map((c) => ensureFrame(c.o, c.vp)));
    cellRecs.flat().forEach((r) => (r.shown = true));
    for (const o of g.options) if (o.live) for (const vp of sizes) ensureFrame(o, vp);

    const ww = (vp) => vp.width + 2 * BEZEL;
    const wh = (vp) => vp.height + 2 * BEZEL;
    const rowSum = rows.map((row) => row.reduce((a, c) => a + ww(c.vp), 0));
    const rowGap = rows.map((row) => GAP * (row.length - 1));
    const rowH = rows.map((row) => Math.max(...row.map((c) => wh(c.vp))));
    const sumH = rowH.reduce((a, b) => a + b, 0);
    const fixedV = rows.length * CAP + GAP * (rows.length - 1);
    let s = 1;
    if (!state.ui.liveFull) {
      s = Math.min(1, (H - 2 * PAD - fixedV) / sumH);
      rows.forEach((_, i) => { s = Math.min(s, (W - 2 * PAD - rowGap[i]) / rowSum[i]); });
      s = Math.max(s, 0.05);
    }
    const maxRowW = Math.max(...rows.map((_, i) => rowSum[i] * s + rowGap[i]));
    const layerW = Math.max(W, maxRowW + 2 * PAD);
    const contentH = sumH * s + fixedV;
    const layerH = Math.max(H, contentH + 2 * PAD);
    layer.style.width = `${layerW}px`;
    layer.style.height = `${layerH}px`;

    caps.replaceChildren();
    let y = (layerH - contentH) / 2;
    rows.forEach((row, ri) => {
      let x = (layerW - (rowSum[ri] * s + rowGap[ri])) / 2;
      row.forEach((c, ci) => {
        const rec = cellRecs[ri][ci];
        placed.set(rec.key, { x, y, s });
        const w = ww(c.vp) * s;
        caps.append(
          h('div', { class: 'caption' + (v.layout === 'side' && c.o.id === v.option ? ' is-active' : ''), style: `left:${x - 10}px;top:${y + wh(c.vp) * s + 6}px;width:${w + 20}px` }, h('b', null, c.o.label), h('span', null, `${c.vp.label} ${c.vp.width}×${c.vp.height}`)),
        );
        x += w + GAP;
      });
      y += rowH[ri] * s + CAP + GAP;
    });
    layer.append(caps);

    for (const rec of frames.values()) {
      let pos = placed.get(rec.key);
      let visible = Boolean(pos);
      if (!pos) {
        // a kept-loaded frame waits exactly where the shown frame of its size is, so the swap is instant
        const twin = [...placed.entries()].find(([k]) => k.endsWith(`|${rec.vp.id}`));
        pos = twin ? twin[1] : { x: 0, y: 0, s: 0.01 };
      }
      rec.wrap.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${pos.s})`;
      rec.wrap.style.visibility = visible ? 'visible' : 'hidden';
      rec.wrap.classList.toggle('is-active', visible && v.layout === 'side' && rec.opt.id === v.option);
    }
    setScale(s);
    schedule();
  }

  // ---------- photographs ----------
  let photoKey = '';
  let photoLabel = null;
  let photoScroll = 0;
  let restoreUntil = 0;
  let userActive = false;
  const scrollers = [];

  function restoreScroll() {
    if (Date.now() > restoreUntil || userActive) return;
    for (const sc of scrollers) if (sc.scrollTop !== photoScroll) sc.scrollTop = photoScroll;
  }

  function updatePhotos(g) {
    liveScroll.hidden = true;
    card.hidden = true;
    photoRoot.hidden = false;
    setScale(null);
    const v = state.view;
    const sizes = shownViewports();
    const label = activeShotLabel();
    const key = [g.id, sizes.map((s) => s.id).join(','), v.layout, state.ui.photoFull, label].join('|');
    if (key !== photoKey) {
      if (label !== photoLabel || !photoKey.startsWith(g.id + '|')) photoScroll = 0;
      photoKey = key;
      photoLabel = label;
      scrollers.length = 0;
      userActive = false;
      restoreUntil = Date.now() + 1500;
      photoRoot.className = 'photo-root' + (state.ui.photoFull ? ' photos-full' : '');
      photoRoot.replaceChildren(
        ...sizes.map((vp) => {
          const scroller = h('div', { class: 'photo-scroll', tabindex: '0', role: 'region', 'aria-label': `Photographs, ${vp.label}` });
          const mark = () => (userActive = true);
          scroller.addEventListener('wheel', mark, { passive: true });
          scroller.addEventListener('pointerdown', mark);
          scroller.addEventListener('keydown', mark);
          scroller.addEventListener('touchstart', mark, { passive: true });
          scroller.addEventListener('scroll', () => {
            if (Date.now() < restoreUntil && !userActive) return;
            photoScroll = scroller.scrollTop;
          });
          scrollers.push(scroller);
          scroller.append(
            h(
              'div',
              { class: 'photo-cols' },
              g.options.map((o) => {
                const shot = (o.shots[vp.id] || []).find((s) => s.label === label);
                return h(
                  'figure',
                  { class: 'photo', 'data-option': o.id },
                  v.layout === 'side' ? h('figcaption', null, o.label) : null,
                  shot
                    ? h('img', { src: shot.url, style: state.ui.photoFull ? null : `max-width:${vp.width}px`, alt: `${o.label}: ${shot.label}, ${vp.label}`, decoding: 'async', onload: restoreScroll })
                    : h('div', { class: 'no-photo' }, label ? 'No photograph of this state for this option' : 'No photographs at this size'),
                );
              }),
            ),
          );
          return h('div', { class: 'photo-col' }, sizes.length > 1 ? h('div', { class: 'photo-col-head' }, `${vp.label} · ${vp.width}×${vp.height}`) : null, scroller);
        }),
      );
      restoreScroll();
    }
    for (const fig of photoRoot.querySelectorAll('.photo')) {
      const active = fig.dataset.option === v.option;
      fig.classList.toggle('is-active', active);
      fig.classList.toggle('side', v.layout === 'side');
      fig.hidden = v.layout === 'one' && !active;
    }
  }

  // ---------- wiring ----------
  function update() {
    const g = currentGroup();
    if (!g || state.route.name !== 'group') return;
    const gk = contentKey(g); // a change elsewhere on the board leaves these frames (and the photographs' scroll) alone
    if (frameGroup !== gk) {
      frameGroup = gk;
      frames.clear();
      layer.replaceChildren();
      forceBackground = false;
      seenEpoch = state.frameEpoch;
      photoKey = '';
    }
    if (state.view.mode === 'live') updateLive(g);
    else updatePhotos(g);
  }

  root.setAttribute('aria-label', 'Stage');
  new ResizeObserver(() => {
    if (state.route.name === 'group' && state.view && state.view.mode === 'live' && !liveScroll.hidden) update();
  }).observe(root);
  subscribe(['route', 'health', 'frames', 'ui'], update);
}
