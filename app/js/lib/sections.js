// Pure helpers for sections, the "Undecided only" filter, the "New" marker and the account a decision asks for.
// No DOM, no store: shared by the views and tested with node:test.

/** Consecutive groups with the same section form one entry: [ { section: string|null, groups: [...] } ]. A group without a section stands alone. */
export function sectionRuns(groups) {
  const runs = [];
  for (const g of groups) {
    const name = g.section || null;
    const last = runs[runs.length - 1];
    if (last && name !== null && last.section === name) last.groups.push(g);
    else runs.push({ section: name, groups: [g] });
  }
  return runs;
}

/** The groups the sidebar shows (and the keys walk). The active group is always in. */
export function visibleGroups(groups, { undecidedOnly = false, isDecided = () => false, activeId = null } = {}) {
  if (!undecidedOnly) return groups.slice();
  return groups.filter((g) => g.id === activeId || !isDecided(g));
}

/** The group `offset` steps from the active one among the visible groups; null at either end. */
export function neighbour(visible, activeId, offset) {
  const i = visible.findIndex((g) => g.id === activeId);
  if (i < 0) return offset > 0 ? visible[0] || null : visible[visible.length - 1] || null;
  return visible[i + offset] || null;
}

/** "3 of 12": decided groups of a run, out of all of its groups (the filter does not change it). */
export function sectionCount(run, isDecided) {
  return { done: run.groups.filter(isDecided).length, total: run.groups.length };
}

/** The key a run is remembered under: its first group's id, so two sections of one name stay apart. */
export function sectionKey(run) {
  return `sec:${run.groups[0].id}`;
}

/** A section is shown open when it is not collapsed or when it holds the active group. */
export function isOpen(run, collapsed, activeId) {
  return !collapsed.has(sectionKey(run)) || run.groups.some((g) => g.id === activeId);
}

/**
 * Is this group new since the review was last finished? Only a board that was finished before has "new" groups:
 * those whose id is not among submitted.groupIds. Once the group is decided it is no longer marked.
 */
export function isNewGroup(group, submitted, isDecided = () => false) {
  if (!submitted || !Array.isArray(submitted.groupIds)) return false;
  return !submitted.groupIds.includes(group.id) && !isDecided(group);
}

/** How many groups of a run are new (see isNewGroup). */
export function newCount(run, submitted, isDecided) {
  return run.groups.filter((g) => isNewGroup(g, submitted, isDecided)).length;
}

/** The account opening this group asks for: its own, else the board's default, else none. */
export function wantedSession(board, group) {
  return (group && group.session) || (board && board.defaultSession) || null;
}
