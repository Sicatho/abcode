// The state of a review, derived from the board and its decisions file. It is never stored.
//   open      the review was never finished
//   finished  finished, and since then no decision changed and no group was added to the board
//   changed   finished earlier, but a decision changed or a new group appeared since
import { countDecided } from '../app/js/lib/rules.js';
import { readDecisions } from './decisions.mjs';

/** The state, from a board and its decisions (as read by readDecisions). */
export function reviewState(board, decisions) {
  const sub = decisions.submitted;
  if (!sub) return 'open';
  const known = new Set(sub.groupIds);
  if (board.groups.some((g) => !known.has(g.id))) return 'changed';
  for (const d of Object.values(decisions.groups)) {
    if (d && typeof d.updatedAt === 'string' && d.updatedAt > sub.at) return 'changed';
  }
  return 'finished';
}

/** { state, decided, total, submitted } for a board whose decisions are already in hand. */
export function reviewOf(board, decisions) {
  return {
    state: reviewState(board, decisions),
    decided: countDecided(board, decisions),
    total: board.groups.length,
    submitted: decisions.submitted || null,
  };
}

/** The one call that answers "has this board been finished, and is that still true?". */
export function boardReview(board) {
  return reviewOf(board, readDecisions(board));
}
