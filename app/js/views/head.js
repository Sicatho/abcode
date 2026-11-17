// The decision's title, question and description, and the option tabs (an ARIA tablist with roving focus).
// A long description is folded to three lines, so that it never takes the room of what is being judged. "more" opens it
// whole OVER the page below it (nothing moves and no frame is rescaled); "less", Escape, D, another option or a press
// anywhere else folds it again.
import { h, rerender } from '../lib/dom.js';
import { state, subscribe, currentGroup, groupDecision, setView } from '../store.js';

let descOpen = false;
let foldedHeight = 0; // the folded description's height, kept as the opened one's place in the page
let apply = () => {};
let headRoot = null;

export const isDescriptionOpen = () => descOpen;

export function setDescriptionOpen(open) {
  if (descOpen === !!open) return;
  const wrap = headRoot && headRoot.querySelector('.desc-wrap');
  if (open && wrap) foldedHeight = wrap.offsetHeight;
  descOpen = !!open;
  apply();
}

/** The D key: opens a folded description or folds an open one. A description that fits has no fold and nothing happens. */
export function toggleDescription() {
  if (descOpen) return setDescriptionOpen(false);
  const toggle = headRoot && headRoot.querySelector('.desc-toggle');
  if (toggle && !toggle.hidden) setDescriptionOpen(true);
}

export function mountHead(root) {
  headRoot = root;

  /** Folded, the styles cut the paragraph at three lines: the button is offered only when words are in fact cut. */
  function measure() {
    const box = root.querySelector('.desc-box');
    if (!box) return;
    const toggle = box.querySelector('.desc-toggle');
    if (descOpen) {
      toggle.hidden = false;
      return;
    }
    const p = box.querySelector('.group-desc');
    toggle.hidden = p.scrollHeight <= p.clientHeight + 1;
  }

  const toggleWords = () => ({
    'aria-expanded': descOpen ? 'true' : 'false',
    'aria-label': descOpen ? 'Fold the description' : 'Read the whole description',
    title: descOpen ? 'Fold the description (D)' : 'Read the whole description (D)',
  });

  /** Opens or folds the description that is on the page, in place: no element is replaced, so a press that folds it
   *  (on an option's tab, say) still reaches what was pressed. */
  apply = () => {
    const wrap = root.querySelector('.desc-wrap');
    if (!wrap) return;
    const box = wrap.querySelector('.desc-box');
    const toggle = wrap.querySelector('.desc-toggle');
    wrap.style.minHeight = descOpen && foldedHeight ? `${foldedHeight}px` : '';
    box.classList.toggle('is-open', descOpen);
    for (const [name, value] of Object.entries(toggleWords())) toggle.setAttribute(name, value);
    toggle.textContent = descOpen ? 'less' : 'more';
    if (!descOpen) box.scrollTop = 0;
    measure();
  };

  function description(g) {
    if (!g.description) return null;
    return h(
      'div',
      { class: 'desc-wrap', style: descOpen && foldedHeight ? `min-height: ${foldedHeight}px` : null },
      h(
        'div',
        { class: descOpen ? 'desc-box is-open' : 'desc-box' },
        h('p', { class: 'group-desc', id: 'group-desc' }, g.description),
        h(
          'button',
          {
            type: 'button',
            class: 'desc-toggle',
            hidden: true,
            ...toggleWords(),
            'aria-controls': 'group-desc',
            'data-fk': 'desc-toggle',
            onclick: () => setDescriptionOpen(!descOpen),
          },
          descOpen ? 'less' : 'more',
        ),
      ),
    );
  }

  function draw() {
    const g = currentGroup();
    if (!g) return;
    const chosen = groupDecision(g.id).choice;
    rerender(root, () => [
      h('h1', { class: 'group-title' }, g.title),
      g.question ? h('p', { class: 'group-question' }, g.question) : null,
      description(g),
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
    measure();
  }
  const redraw = () => {
    if (state.route.name === 'group') draw();
  };

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

  // A press anywhere outside the opened description folds it. A press inside a live frame never reaches this page: the
  // window loses the focus to the frame instead, which is how that case is seen.
  document.addEventListener('pointerdown', (e) => {
    if (descOpen && !(e.target instanceof Element && e.target.closest('.desc-box'))) setDescriptionOpen(false);
  }, true);
  window.addEventListener('blur', () => {
    if (!descOpen) return;
    setTimeout(() => {
      if (descOpen && document.activeElement && document.activeElement.tagName === 'IFRAME') setDescriptionOpen(false);
    }, 0);
  });
  // The fold depends on the width: look again when the head is resized (folded only; an opened one keeps its button).
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (!descOpen) measure(); }).observe(root);

  // Another option or another decision: what is being judged changed, so an opened description folds.
  subscribe(['route'], () => {
    descOpen = false;
    redraw();
  });
  subscribe(['decisions'], redraw);
}
