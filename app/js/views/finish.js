// The "Finish review" control: a button that says how far the review is, and a small inline
// confirmation (not window.confirm) when decisions are still open. Shown in the sidebar and on the summary.
import { h, rerender } from '../lib/dom.js';
import { state, subscribe, decidedCount, reviewState, askFinish, finishReview, finishedHref } from '../store.js';

const slots = new Map(); // where -> element

/** Fills `el` with the control and keeps it current. `where` is 'sidebar' or 'summary'. */
export function mountFinish(el, where) {
  slots.set(where, el);
  draw(where, el);
}
subscribe(['review', 'decisions', 'route'], () => {
  for (const [where, el] of slots) {
    if (!el.isConnected) slots.delete(where);
    else draw(where, el);
  }
});

let opener = null; // where the keyboard was when the question opened: { el, fk, where }

/** Opens the confirmation in the place that is on screen, and puts the keyboard on its button. */
export function openFinish(where) {
  const a = document.activeElement;
  opener = a && a !== document.body && !(a instanceof HTMLIFrameElement) ? { el: a, fk: a.getAttribute('data-fk'), where } : { el: null, fk: null, where };
  askFinish(where);
  requestAnimationFrame(() => document.querySelector('.finish-ask [data-fk="finish:go"]')?.focus());
}
/** Closes the question (Esc, "Keep reviewing") and gives the keyboard back to the control that opened it. */
export function closeFinish() {
  const back = opener;
  opener = null;
  askFinish(null);
  if (!back) return;
  // the control may have been redrawn meanwhile: find it again by its key, else the Finish button of that place
  const again = (back.el && back.el.isConnected && back.el) || (back.fk && document.querySelector(`[data-fk="${CSS.escape(back.fk)}"]`)) || document.querySelector(`[data-fk="finish:open:${back.where}"]`);
  if (again) again.focus({ preventScroll: true });
}
/** The place the F key opens the confirmation in. */
export const finishPlace = () => (state.route.name === 'summary' ? 'summary' : state.route.name === 'finished' && reviewState() === 'changed' ? 'finished' : 'sidebar');

export function finishLabel() {
  const undecided = state.board.groups.length - decidedCount();
  const again = reviewState() === 'changed';
  if (undecided > 0) return `${again ? 'Finish again' : 'Finish'} with ${undecided} undecided`;
  return again ? 'Finish again' : 'Finish review';
}

function draw(where, el) {
  rerender(el, () => build(where));
}

function build(where) {
  const b = state.board;
  if (!b) return [];
  const total = b.groups.length;
  const done = decidedCount();
  const undecided = total - done;
  const rs = reviewState();
  const f = state.finish;
  const out = [];

  if (rs === 'finished') {
    out.push(h('a', { class: 'btn btn-block btn-finished', href: finishedHref(), 'data-fk': `finish:view:${where}` }, '✓ Review finished'), h('p', { class: 'finish-count' }, 'Open the finish page'));
    return out;
  }

  if (f.ask === where) {
    out.push(
      h(
        'div',
        { class: 'finish-ask', role: 'group', 'aria-label': 'Confirm finishing the review' },
        h('p', { class: 'finish-ask-title' }, undecided > 0 ? `Finish with ${undecided} undecided?` : 'Finish the review?'),
        h('p', { class: 'finish-ask-text' }, undecided > 0 ? 'Those decisions are saved as not decided. You can still change anything and finish again.' : (state.assistant.listening ? `${done} of ${total} decided. Your decisions are saved as finished, and the assistant that is waiting will be told.` : `${done} of ${total} decided. Your decisions are saved as finished.`)),
        h(
          'div',
          { class: 'finish-ask-actions' },
          h('button', { type: 'button', class: 'btn btn-primary', 'data-fk': 'finish:go', onclick: () => finishReview() }, undecided > 0 ? 'Finish anyway' : 'Finish review'),
          h('button', { type: 'button', class: 'btn', 'data-fk': 'finish:cancel', onclick: () => closeFinish() }, 'Keep reviewing'),
        ),
      ),
    );
  } else {
    out.push(
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-block ' + (undecided > 0 ? '' : 'btn-primary'),
          'data-fk': `finish:open:${where}`,
          disabled: f.busy ? true : null,
          title: 'Finish the review (F)',
          onclick: () => (undecided > 0 ? openFinish(where) : finishReview()),
        },
        f.busy ? 'Finishing…' : finishLabel(),
      ),
      h('p', { class: 'finish-count' }, `${done} of ${total} decided`),
    );
  }
  if (f.error) out.push(h('p', { class: 'finish-error', role: 'alert' }, f.error));
  return out;
}
