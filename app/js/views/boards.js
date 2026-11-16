// The list of boards (shown when there is more than one, or when something went wrong).
import { h } from '../lib/dom.js';
import { state } from '../store.js';

export function drawBoards(root) {
  const boards = state.boards || [];
  root.replaceChildren(
    h(
      'div',
      { class: 'inner' },
      h('h1', null, 'ABCode'),
      state.loadError
        ? h('p', { class: 'lead', role: 'alert', style: 'color:var(--danger)' }, state.loadError)
        : h('p', { class: 'lead' }, boards.length ? 'Pick a board to review.' : 'No boards yet.'),
      boards.length === 0 && !state.loadError ? h('p', { class: 'empty-note' }, 'Add a folder boards/<id>/ with a board.json in it, then reload this page. The README shows the format.') : null,
      boards.map((b) =>
        h(
          'a',
          { class: 'board-card', href: `#/b/${encodeURIComponent(b.id)}` },
          h('h2', null, b.title),
          b.error ? h('p', { class: 'err' }, b.error) : h('p', null, `${b.decided} of ${b.groups} decided${b.subtitle ? ' · ' + b.subtitle : ''}`),
          b.review && b.review.state !== 'open'
            ? h('p', { class: 'card-state ' + b.review.state }, b.review.state === 'finished' ? '✓ Finished' : 'Changed since finished')
            : null,
        ),
      ),
    ),
  );
}
