// What the page says about an assistant (a model working with the person) that waits for the finish.
// The command `review-board-wait` keeps a heartbeat file; the server reports it at GET /status.
// Two places: a quiet line in the sidebar while one is waiting, and the line on the finish page.
import { h } from '../lib/dom.js';
import { stamp } from '../lib/format.js';
import { state, subscribe, reviewState, assistantStatus, ASSISTANT_PATIENCE_MS } from '../store.js';

function lineContent() {
  const path = state.board.decisionsPath;
  const status = assistantStatus();
  if (status === 'received') return { cls: 'is-received', kids: [h('span', { class: 'assistant-mark done', 'aria-hidden': 'true' }, '✓'), h('span', null, 'Your assistant has your decisions.')] };
  if (status === 'earlier') return { cls: 'is-earlier', kids: [`Your assistant has the decisions from ${stamp(state.review.submitted.at)}. Finish again to send the changes.`] };
  if (status === 'waiting') return { cls: 'is-waiting', kids: [h('span', { class: 'dot pulse', 'aria-hidden': 'true' }), h('span', null, 'An assistant is waiting. Finish again to send your changes.')] };
  if (status === 'telling') return { cls: 'is-telling', kids: [h('span', { class: 'assistant-mark pending', 'aria-hidden': 'true' }), h('span', null, 'Telling your assistant…')] };
  return { cls: 'is-saved', kids: ['Saved. No assistant is waiting right now. It will read your decisions from this file the next time you ask it.', h('code', { class: 'assistant-path' }, path)] };
}

/** The line for the finish page: a paragraph that keeps itself current while it is on screen. */
export function assistantLine() {
  const p = h('p', { class: 'assistant-line', role: 'status' });
  let timer = null;
  const draw = () => {
    if (!p.isConnected && p.dataset.drawn) {
      unsubscribe();
      clearTimeout(timer);
      return;
    }
    const { cls, kids } = lineContent();
    p.className = `assistant-line ${cls}`;
    p.replaceChildren(...kids.map((k) => (k instanceof Node ? k : document.createTextNode(k))));
    p.dataset.drawn = '1';
    // a finish that was not picked up in time turns into the plain "saved" wording without another answer
    clearTimeout(timer);
    const sub = state.review && state.review.submitted;
    if (sub && assistantStatus() === 'telling') timer = setTimeout(draw, Math.max(50, Date.parse(sub.at) + ASSISTANT_PATIENCE_MS - Date.now() + 20));
  };
  const unsubscribe = subscribe(['assistant', 'review'], draw);
  draw();
  return p;
}

/** The sidebar line: only while an assistant is waiting and the review is not finished. Returns nodes for the slot. */
export function assistantSidebarLine() {
  if (!state.assistant.listening || reviewState() === 'finished') return [];
  return [h('p', { class: 'assistant-waiting', role: 'status' }, h('span', { class: 'dot pulse', 'aria-hidden': 'true' }), h('span', null, 'An assistant is waiting for you to finish.'))];
}
