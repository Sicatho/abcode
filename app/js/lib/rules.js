// Rules shared by the server and the page, so the two can never disagree about what "decided" means.
// Pure functions only: no DOM, no Node modules.

/**
 * Is this decision settled?
 * - A normal group: its choice is an option the board still offers.
 * - A notes-only group (pick "none"): it is marked as looked at ("done"), or it has a note.
 */
export function isDecided(group, decision) {
  if (!decision) return false;
  if (group.pick === 'none') return decision.done === true || Boolean(decision.note && decision.note.trim());
  return decision.choice != null && group.options.some((o) => o.id === decision.choice);
}

/** How many of the board's groups are decided. `decisions` is the `groups` object of the decisions file. */
export function countDecided(board, decisions) {
  const groups = (decisions && decisions.groups) || {};
  return board.groups.filter((g) => isDecided(g, groups[g.id])).length;
}

/** The first few words of a note, for a one-line status. */
export function firstWords(note, count = 6) {
  const words = String(note || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return words.slice(0, count).join(' ') + (words.length > count ? '…' : '');
}
