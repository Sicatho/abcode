// The finish page: shown right after finishing, and again at #/b/<board>/finished.
import { h } from '../lib/dom.js';
import { state, reviewState, decidedCount } from '../store.js';
import { groupHref } from '../router.js';
import { stamp } from '../lib/format.js';
import { decisionItems } from './summary.js';
import { assistantLine } from './assistant.js';
import { mountFinish } from './finish.js';

// Drawn with SVG so it can draw itself: a ring, then a check mark (about 700ms; see components.css).
const SEAL = `<svg class="seal" viewBox="0 0 120 120" width="120" height="120" aria-hidden="true" focusable="false">
  <circle class="seal-disc" cx="60" cy="60" r="54"/>
  <circle class="seal-ring" cx="60" cy="60" r="54" pathLength="1"/>
  <circle class="seal-inner" cx="60" cy="60" r="45"/>
  <path class="seal-check" d="M38 62 L54 78 L84 44" pathLength="1"/>
</svg>`;

// What the page shows depends on the review and its state only. Opening or closing the finish question
// changes neither, so it does not redraw the page (the seal would draw itself again).
const signature = () => JSON.stringify([state.review, reviewState()]);

/** Redraws only when what the page shows has changed. */
function finishSlot() {
  const el = h('div', { class: 'finish-slot' });
  mountFinish(el, 'finished');
  return el;
}

export function refreshFinished(root) {
  if (root.dataset.sig !== signature()) drawFinished(root);
}

export function drawFinished(root) {
  const b = state.board;
  const sub = state.review && state.review.submitted;
  if (!b || !sub) return;
  root.dataset.sig = signature();
  const changed = reviewState() === 'changed';
  const seal = h('div', { class: 'seal-wrap' });
  seal.innerHTML = SEAL;
  const place = state.view ? state.view.group : b.groups[0].id;
  root.replaceChildren(
    h(
      'div',
      { class: 'inner finish-page' },
      seal,
      h('h1', { class: 'finish-title' }, 'Review finished'),
      h('p', { class: 'finish-line' }, changed ? `At the finish: ${sub.decided} of ${sub.total} decided · now ${decidedCount()} of ${b.groups.length} · ${stamp(sub.at)}` : `${sub.decided} of ${sub.total} decided · ${stamp(sub.at)}`),
      changed
        ? h(
            'div',
            { class: 'finish-changed', role: 'status' },
            h('span', null, 'Changed since you finished.'),
            finishSlot(),
          )
        : null,
      h('div', { class: 'assistant-slot', 'data-slot': 'assistant-line' }, assistantLine()),
      h(
        'div',
        { class: 'finish-actions' },
        h('a', { class: 'btn btn-primary', href: groupHref(b.id, place), 'data-fk': 'finished:back' }, 'Back to the board'),
        h('a', { class: 'btn', href: `#/b/${encodeURIComponent(b.id)}/summary` }, 'Summary'),
      ),
      h('h2', { class: 'finish-sub' }, changed ? 'Your decisions now' : 'What you decided'),
      decisionItems(b),
    ),
  );
}
