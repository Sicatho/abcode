// The controls row: view, size, layout, shots, and the live-only actions.
import { h, rerender } from '../lib/dom.js';
import { copyText } from '../lib/format.js';
import { state, subscribe, currentGroup, currentOption, groupHasLive, groupHasShots, setView, setUi, reloadFrames, shotLabels, activeShotLabel } from '../store.js';

function seg(label, items) {
  return h(
    'div',
    { class: 'ctl-group' },
    h('span', { class: 'ctl-label' }, label),
    h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': label },
      items.map((it) => h('button', { type: 'button', 'aria-pressed': it.on ? 'true' : 'false', disabled: it.disabled ? true : null, title: it.title || null, 'data-fk': it.fk, onclick: it.click }, it.text)),
    ),
  );
}

export function mountControls(root) {
  let copied = false;

  function draw() {
    const g = currentGroup();
    if (!g) return;
    const v = state.view;
    const board = state.board;
    const live = v.mode === 'live';
    const opt = currentOption();
    const kids = [];

    kids.push(
      seg('View', [
        { text: 'Live', on: live, disabled: !groupHasLive(g), fk: 'c:live', click: () => setView({ mode: 'live' }), title: 'Live (L)' },
        { text: 'Photographs', on: !live, disabled: !groupHasShots(g), fk: 'c:shots', click: () => setView({ mode: 'shots' }), title: 'Photographs (P)' },
      ]),
    );
    const sizes = board.viewports.map((vp) => ({ text: vp.label, on: v.viewport === vp.id, fk: `c:vp:${vp.id}`, click: () => setView({ viewport: vp.id }), title: `${vp.width} × ${vp.height}` }));
    if (board.viewports.length >= 2) sizes.push({ text: 'Both', on: v.viewport === 'both', fk: 'c:vp:both', click: () => setView({ viewport: 'both' }), title: 'All sizes next to each other' });
    kids.push(seg('Size', sizes));
    kids.push(
      seg('Layout', [
        { text: 'One', on: v.layout === 'one', fk: 'c:l:one', click: () => setView({ layout: 'one' }) },
        { text: 'Side by side', on: v.layout === 'side', fk: 'c:l:side', click: () => setView({ layout: 'side' }), title: 'Every option next to each other (S)' },
      ]),
    );

    if (live) {
      kids.push(
        h(
          'div',
          { class: 'ctl-group' },
          h('span', { class: 'scale-readout', 'aria-label': 'Scale', title: 'Frames are scaled to fit the stage' }, state.ui.scale === null ? '' : `${Math.round(state.ui.scale * 100)}%`),
          seg('Scale', [
            { text: 'Fit', on: !state.ui.liveFull, fk: 'c:scale:fit', click: () => setUi({ liveFull: false }) },
            { text: '100%', on: state.ui.liveFull, fk: 'c:scale:full', click: () => setUi({ liveFull: true }) },
          ]).lastElementChild,
        ),
        h('button', { type: 'button', class: 'btn', 'data-fk': 'c:reload', onclick: reloadFrames, title: 'Reload the frames (R)' }, 'Reload'),
        opt && opt.live
          ? h('a', { class: 'btn', href: opt.live.url, target: '_blank', rel: 'noopener', 'data-fk': 'c:open', title: opt.live.url }, 'Open in a new tab')
          : h('button', { type: 'button', class: 'btn', disabled: true }, 'Open in a new tab'),
      );
    } else {
      const labels = shotLabels();
      if (labels.length) {
        const active = activeShotLabel();
        kids.push(
          h(
            'div',
            { class: 'ctl-group' },
            h('span', { class: 'ctl-label' }, 'Photograph'),
            h(
              'div',
              { class: 'chips', role: 'group', 'aria-label': 'Photograph' },
              labels.map((l) => h('button', { type: 'button', class: 'chip', 'aria-pressed': l === active ? 'true' : 'false', 'data-fk': `shot:${l}`, onclick: () => setView({ shot: l }) }, l)),
            ),
          ),
        );
      }
      kids.push(
        seg('Zoom', [
          { text: 'Fit width', on: !state.ui.photoFull, fk: 'c:zoom:fit', click: () => setUi({ photoFull: false }) },
          { text: '100%', on: state.ui.photoFull, fk: 'c:zoom:full', click: () => setUi({ photoFull: true }) },
        ]),
      );
    }

    kids.push(
      h('span', { class: 'ctl-spacer' }),
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          'data-fk': 'c:copy',
          onclick: async () => {
            copied = await copyText(location.href);
            draw();
            setTimeout(() => { copied = false; draw(); }, 1600);
          },
        },
        copied ? h('span', { class: 'copied' }, 'Link copied') : 'Copy link',
      ),
      h('button', { type: 'button', class: 'btn details-btn', 'data-fk': 'c:details', 'aria-expanded': state.ui.drawer ? 'true' : 'false', onclick: () => setUi({ drawer: !state.ui.drawer }) }, 'Details and notes'),
    );
    rerender(root, () => kids);
  }

  subscribe(['route', 'ui', 'scale'], () => {
    if (state.route.name === 'group') draw();
  });
}
