// The summary: every decision with the choice, the notes and the time, plus the file on disk.
import { h } from '../lib/dom.js';
import { state, groupDecision, decidedCount, isStaleChoice, picturesOf } from '../store.js';
import { pictureRow } from './pictures.js';
import { optionLabel, summaryText, when, copyText } from '../lib/format.js';
import { sectionRuns } from '../lib/sections.js';
import { mountFinish } from './finish.js';

let copiedTimer = null;

/** One card per decision: the verdict, the notes and when it changed. Shared with the finish page. */
export function decisionItems(b) {
  const out = [];
  let index = 0;
  let prev = null;
  for (const run of sectionRuns(b.groups)) {
    if (run.section) out.push(h('h2', { class: 'sum-section' }, run.section));
    else if (prev && prev.section) out.push(h('hr', { class: 'sum-rule' })); // a decision that stands alone is closed off from the section above
    for (const g of run.groups) out.push(decisionItem(b, g, index++));
    prev = run;
  }
  return out;
}

function decisionItem(b, g, i) {
  const d = groupDecision(g.id);
  const stale = isStaleChoice(g);
  const verdict = g.pick === 'none' ? (d.done ? 'Notes only · looked at' : 'Notes only') : stale ? `Chosen earlier: ${d.choice} (no longer on this board)` : d.choice ? optionLabel(g, d.choice) : 'Undecided';
  const optNotes = Object.entries(d.optionNotes || {}).filter(([, t]) => t);
  return h(
    'article',
    { class: 'sum-item' },
    h('h3', null, h('a', { href: `#/b/${encodeURIComponent(b.id)}/g/${encodeURIComponent(g.id)}` }, `${i + 1}. ${g.title}`)),
    h('p', { class: 'sum-choice' + (g.pick === 'none' || !d.choice || stale ? ' none' : '') }, verdict),
    d.note ? h('div', { class: 'sum-note' }, h('small', null, g.pick === 'none' ? 'Notes' : 'Note on the decision'), d.note) : null,
    picturesOf(g.id).length ? h('div', { class: 'sum-note sum-pics' }, h('small', null, `Pictures (${picturesOf(g.id).length})`), pictureRow(b.id, g.id, picturesOf(g.id))) : null,
    optNotes.map(([oid, t]) => h('div', { class: 'sum-note' }, h('small', null, `Note on ${optionLabel(g, oid)}`), t)),
    d.updatedAt ? h('p', { class: 'sum-time' }, `Changed ${when(d.updatedAt)}`) : null,
  );
}

export function drawSummary(root) {
  const b = state.board;
  if (!b) return;
  const status = h('span', { class: 'copied', role: 'status' });
  const copy = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-primary',
      onclick: async () => {
        const ok = await copyText(summaryText(b, state.decisions));
        status.textContent = ok ? 'Copied' : 'Could not copy';
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => (status.textContent = ''), 1800);
      },
    },
    'Copy as text',
  );
  const finishSlot = h('div', { class: 'finish sum-finish' });
  root.replaceChildren(
    h(
      'div',
      { class: 'inner' },
      h('h1', null, 'Summary'),
      h('p', { class: 'lead' }, `${b.title}: ${decidedCount()} of ${b.groups.length} decided.`),
      h('div', { class: 'sum-actions' }, copy, status),
      decisionItems(b),
      h(
        'div',
        { class: 'sum-file' },
        h('p', { style: 'margin:0 0 6px' }, 'Every change is saved to this file as you make it:'),
        h('code', null, b.decisionsPath),
        h('p', { style: 'margin:8px 0 0' }, 'An assistant can read your decisions straight from that file; there is nothing to copy or send.'),
      ),
      h('div', { class: 'sum-finish-wrap' }, finishSlot),
    ),
  );
  mountFinish(finishSlot, 'summary');
}
