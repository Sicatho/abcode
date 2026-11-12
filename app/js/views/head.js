// The decision's title, question and description, and the option tabs (an ARIA tablist with roving focus).
import { h, rerender } from '../lib/dom.js';
import { state, subscribe, currentGroup, groupDecision, setView } from '../store.js';

export function mountHead(root) {
  function draw() {
    const g = currentGroup();
    if (!g) return;
    const chosen = groupDecision(g.id).choice;
    rerender(root, () => [
      h('h1', { class: 'group-title' }, g.title),
      g.question ? h('p', { class: 'group-question' }, g.question) : null,
      g.description ? h('p', { class: 'group-desc' }, g.description) : null,
      h(
        'div',
        { class: 'tabs', role: 'tablist', 'aria-label': 'Options', onkeydown },
        g.options.map((o, i) => {
          const selected = state.view.option === o.id;
          return h(
            'button',
            {
              type: 'button',
              class: 'tab',
              role: 'tab',
              id: `tab-${o.id}`,
              'aria-selected': selected ? 'true' : 'false',
              'aria-controls': 'stage',
              tabindex: selected ? '0' : '-1',
              'data-fk': `tab:${o.id}`,
              'data-option': o.id,
              onclick: () => setView({ option: o.id }),
            },
            h('kbd', { 'aria-hidden': 'true' }, i < 9 ? String(i + 1) : ''),
            h('span', null, o.label),
            g.recommended === o.id ? h('span', { class: 'badge suggest' }, 'Suggested') : null,
            chosen === o.id ? h('span', { class: 'badge chosen' }, '✓ Chosen') : null,
          );
        }),
      ),
    ]);
  }

  function onkeydown(e) {
    const g = currentGroup();
    const ids = g.options.map((o) => o.id);
    const i = ids.indexOf(state.view.option);
    let next = null;
    if (e.key === 'ArrowRight') next = ids[(i + 1) % ids.length];
    else if (e.key === 'ArrowLeft') next = ids[(i - 1 + ids.length) % ids.length];
    else if (e.key === 'Home') next = ids[0];
    else if (e.key === 'End') next = ids[ids.length - 1];
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    setView({ option: next });
    root.querySelector(`[data-option="${CSS.escape(next)}"]`)?.focus();
  }

  subscribe(['route', 'decisions'], () => {
    if (state.route.name === 'group') draw();
  });
}
