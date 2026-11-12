// Left sidebar: board title, decisions with their status, progress, account switch, target state, save state.
import { h, rerender } from '../lib/dom.js';
import { groupHref } from '../router.js';
import { state, subscribe, groupDecision, isStaleChoice, isDecided, decidedCount, chooseSession, refreshHealth, saveLabel, reviewState, visibleList, toggleSection, setUndecidedOnly, dismissNotice } from '../store.js';
import { optionLabel, clock } from '../lib/format.js';
import { firstWords } from '../lib/rules.js';
import { sectionRuns, sectionCount, isOpen, sectionKey, isNewGroup, newCount } from '../lib/sections.js';
import { mountFinish } from './finish.js';
import { assistantSidebarLine } from './assistant.js';
import { scrollToReveal } from '../lib/reload.js';

export function mountSidebar(root) {
  const head = h('section', { class: 'sb-head' });
  const progress = h('section', { class: 'sb-progress' }); // stays in view while the list scrolls
  const notice = h('section', { class: 'sb-notice', 'aria-label': 'Text that was not saved', hidden: '' });
  const groups = h('section', { class: 'sb-groups' });
  const finish = h('section', { class: 'sb-finish finish', 'aria-label': 'Finish the review' });
  const foot = h('section', { class: 'sb-foot' });
  const assistantBox = h('div', { class: 'assistant-slot', 'data-slot': 'assistant-sidebar' });
  const sessionBox = h('div');
  const targetsBox = h('div');
  const saveBox = h('div', { 'aria-live': 'polite' });
  foot.append(assistantBox, sessionBox, targetsBox, saveBox);
  root.replaceChildren(head, progress, notice, groups, finish, foot);
  mountFinish(finish, 'sidebar');

  const drawHead = () =>
    rerender(head, () => {
      const b = state.board;
      if (!b) return [];
      return [
        state.boards && state.boards.length > 1 ? h('a', { class: 'sb-link', href: '#/', style: 'margin:0 0 8px' }, 'All boards') : null,
        h('h1', { class: 'sb-title' }, b.title),
        b.subtitle ? h('p', { class: 'sb-sub' }, b.subtitle) : null,
      ];
    });

  /** One decision in the list: its mark, title, status and, if the board was finished before without it, a "New" tag. */
  const row = (g) => {
    const b = state.board;
    const d = groupDecision(g.id);
    const current = state.route.name === 'group' && state.view && state.view.group === g.id;
    let status;
    let mark = 'dec-mark';
    let cls = 'dec-status';
    if (g.pick === 'none') {
      if (isDecided(g)) {
        status = firstWords(d.note) || 'Looked at';
        mark += ' done';
        cls += ' done';
      } else {
        status = 'Notes only';
        mark += ' notes';
      }
    } else if (d.choice && isStaleChoice(g)) {
      status = `Chosen earlier: ${d.choice} (no longer on this board)`;
    } else if (d.choice) {
      status = optionLabel(g, d.choice);
      mark += ' done';
      cls += ' done';
    } else status = 'Undecided';
    const fresh = isNewGroup(g, state.review && state.review.submitted, isDecided);
    return h(
      'a',
      { class: 'dec-link', href: groupHref(b.id, g.id), 'aria-current': current ? 'page' : null, 'data-fk': `dec:${g.id}` },
      h('span', { class: mark, 'aria-hidden': 'true' }),
      h('span', { class: 'dec-title' }, g.title, fresh ? h('span', { class: 'tag-new' }, h('span', { class: 'sr-only' }, ' · '), 'New') : null),
      h('span', { class: cls }, d.choice && !isStaleChoice(g) ? h('span', { class: 'sr-only' }, 'Chosen: ') : null, status),
    );
  };

  const drawGroups = () =>
    rerender(groups, () => {
      const b = state.board;
      if (!b) return [];
      const submitted = state.review && state.review.submitted;
      const decidedFn = (g) => isDecided(g);
      const shown = new Set(visibleList().map((g) => g.id));
      const activeId = state.route.name === 'group' && state.view ? state.view.group : null;
      const flow = h('div', { class: 'dec-flow' });
      let plain = null; // the list that holds consecutive groups without a section
      sectionRuns(b.groups).forEach((run, ri) => {
        const rows = run.groups.filter((g) => shown.has(g.id));
        if (!rows.length) return; // a section left with nothing to show is not shown
        if (!run.section) {
          if (!plain) flow.append((plain = h('ol', { class: 'dec-list' })));
          for (const g of rows) plain.append(h('li', null, row(g)));
          return;
        }
        plain = null;
        const open = isOpen(run, state.nav.collapsed, activeId);
        const { done: d, total: t } = sectionCount(run, decidedFn);
        const fresh = newCount(run, submitted, decidedFn);
        const listId = `sec-list-${ri}`;
        flow.append(
          h(
            'div',
            { class: 'dec-section' },
            h(
              'h2',
              { class: 'sec-head' },
              h(
                'button',
                {
                  type: 'button',
                  class: 'sec-toggle',
                  'aria-expanded': open ? 'true' : 'false',
                  'aria-controls': open ? listId : null, // a collapsed section has no list in the page to point at
                  'data-fk': sectionKey(run),
                  title: open && state.nav.collapsed.has(sectionKey(run)) ? 'Stays open while it holds the decision you are on' : null,
                  onclick: () => toggleSection(sectionKey(run)),
                },
                h('span', { class: 'sec-chevron', 'aria-hidden': 'true' }),
                h('span', { class: 'sec-name' }, run.section),
                h('span', { class: 'sec-count' }, `${d} of ${t}`, fresh ? h('span', { class: 'sec-new' }, ` · ${fresh} new`) : null),
              ),
            ),
            open ? h('ol', { class: 'dec-list', id: listId }, rows.map((g) => h('li', null, row(g)))) : null,
          ),
        );
      });
      const list = shown.size ? flow : h('p', { class: 'sb-empty' }, 'Everything is decided.');
      const summaryCurrent = state.route.name === 'summary';
      return [
        list,
        h('a', { class: 'sb-link', href: `#/b/${encodeURIComponent(b.id)}/summary`, 'aria-current': summaryCurrent ? 'page' : null, 'data-fk': 'summary-link' }, 'Summary of all decisions'),
      ];
    });

  const drawProgress = () =>
    rerender(progress, () => {
      const b = state.board;
      if (!b) return [];
      const total = b.groups.length;
      const done = decidedCount();
      const rs = reviewState();
      const sub = state.review && state.review.submitted;
      // A finished review still tells the truth: the bar is the decided share and the count stays.
      const progressNote = rs === 'finished' ? `Finished · ${clock(sub.at)}` : rs === 'changed' ? 'Changed since you finished' : null;
      const progressPct = total ? Math.round((done / total) * 100) : 0;
      return [
        h('p', { class: 'sb-label' }, 'Decisions'),
        h('p', { class: 'progress ' + rs, 'data-fk': 'progress' }, h('span', { class: 'progress-line' }, h('span', null, `${done} of ${total} decided`), progressNote ? h('span', { class: 'progress-note' }, progressNote) : null), h('span', { class: 'progress-bar', role: 'presentation' }, h('i', { style: `width:${progressPct}%` }))),
        h('button', { type: 'button', class: 'filter-toggle', 'aria-pressed': state.nav.undecidedOnly ? 'true' : 'false', 'data-fk': 'filter:undecided', title: 'Hide the decisions you have decided', onclick: () => setUndecidedOnly(!state.nav.undecidedOnly) }, h('span', { class: 'filter-box', 'aria-hidden': 'true' }), 'Undecided only'),
      ];
    });

  /** Which account is active, and, when the open decision asked for it, one quiet line that says so. */
  const sessionLine = (b) => {
    const { last, asked } = state.session;
    const active = b.sessions.find((x) => x.id === last);
    if (asked && last === asked && active) return h('p', { class: 'session-asked' }, `This decision is shown as: ${active.label}`);
    return h('p', { class: 'session-asked' }, active ? `Active: ${active.label}` : 'Not set from this page yet');
  };

  const drawSession = () =>
    rerender(sessionBox, () => {
      const b = state.board;
      if (!b || !b.sessions.length) return [];
      const res = state.session.result;
      return [
        h('p', { class: 'sb-label', id: 'session-label' }, 'Account in the frames'),
        h(
          'div',
          { class: 'session-list', role: 'group', 'aria-labelledby': 'session-label' },
          b.sessions.map((s) =>
            h('button', { type: 'button', class: 'session-opt' + (state.session.last === s.id ? ' on' : ''), 'aria-pressed': state.session.last === s.id ? 'true' : 'false', 'data-fk': `session:${s.id}`, onclick: () => chooseSession(s.id) }, s.label),
          ),
        ),
        sessionLine(b),
        res ? h('p', { class: 'session-note ' + (res.ok ? 'ok' : 'err'), role: res.ok ? 'status' : 'alert' }, res.text) : null,
      ];
    });

  const drawTargets = () =>
    rerender(targetsBox, () => {
      const b = state.board;
      if (!b) return [];
      const names = Object.keys(b.targets);
      if (!names.length) return [];
      return [
        h('p', { class: 'sb-label' }, 'Sites'),
        names.map((n) => {
          const t = b.targets[n];
          const r = state.health[n];
          const checking = !r && state.healthState !== 'done';
          return h(
            'div',
            { class: 'target' },
            h(
              'div',
              { class: 'target-line' },
              h('span', { class: 'dot ' + (checking ? '' : r && r.ok ? 'ok' : 'bad'), 'aria-hidden': 'true' }),
              h('span', null, `${t.label}: `),
              checking ? h('span', null, 'checking…') : r && r.ok ? h('span', { class: 'ok-text' }, 'answering') : h('span', { class: 'bad-text' }, 'not answering'),
              h('button', { type: 'button', class: 'btn btn-small', 'data-fk': `retry:${n}`, onclick: () => refreshHealth(), disabled: state.healthState === 'loading' ? true : null }, 'Retry'),
            ),
            !checking && !(r && r.ok) && t.hint ? h('span', { class: 'hint' }, t.hint) : null,
            h('span', { class: 'hint' }, t.origin),
          );
        }),
      ];
    });

  const drawSave = () =>
    rerender(saveBox, () => [h('div', { class: 'save-state' + (state.save.state === 'error' ? ' err' : '') }, h('span', { class: 'dot ' + (state.save.state === 'error' ? 'bad' : state.save.state === 'saving' ? '' : 'ok'), 'aria-hidden': 'true' }), saveLabel())]);

  /** The text of a decision that was removed from the board while it was being written: said once, kept here to copy until dismissed. */
  const drawNotice = () => {
    const n = state.notice;
    if (!n) {
      notice.hidden = true;
      notice.replaceChildren();
      return;
    }
    const area = h('textarea', { class: 'notice-text', rows: '4', readonly: '', 'aria-label': 'The text that was not saved', value: n.text });
    notice.hidden = false;
    notice.replaceChildren(
      h('div', { class: 'notice-box', role: 'status' },
        h('p', null, h('b', null, 'Not saved. '), `The decision "${n.title}" was removed from the board file while you were writing, so your latest text for it could not be saved (what was saved before stays in the decisions file). Copy it here if you want to keep it.`),
        area,
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn btn-small', 'data-fk': 'notice:copy', onclick: async () => { try { await navigator.clipboard.writeText(n.text); } catch { area.select(); } } }, 'Copy'),
          h('button', { type: 'button', class: 'btn btn-small', 'data-fk': 'notice:dismiss', onclick: () => dismissNotice() }, 'Dismiss'))),
    );
  };

  const drawAssistant = () => rerender(assistantBox, () => assistantSidebarLine());

  /**
   * Brings the open decision's row into view in the list (the list only, never the page), with its section heading
   * when both fit. No animation, and the keyboard focus is left where it is.
   */
  const revealOpen = ({ withHead = true } = {}) => {
    const link = groups.querySelector('.dec-link[aria-current="page"]');
    if (!link || !groups.clientHeight) return;
    const box = groups.getBoundingClientRect();
    const up = groups.scrollTop - box.top; // client y -> distance from the top of the scrolled content
    const row = link.closest('li') || link;
    const rect = row.getBoundingClientRect();
    const sec = link.closest('.dec-section');
    const head = sec && sec.querySelector('.sec-head');
    const to = scrollToReveal({
      rowTop: rect.top + up,
      rowBottom: rect.bottom + up,
      headTop: head && withHead ? head.getBoundingClientRect().top + up : null,
      viewTop: groups.scrollTop,
      viewHeight: groups.clientHeight,
    });
    if (to !== null) groups.scrollTo({ top: to, behavior: 'instant' });
  };
  let revealedFor = null;
  let revealAt = 0;
  const revealSoon = () => {
    revealAt = Date.now();
    revealOpen();
  };
  // The footer below the list grows as the accounts and the sites' state arrive, and the list shrinks with it:
  // for a moment after the open decision changed, keep it in view while the list changes height.
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (Date.now() - revealAt < 3000) revealOpen(); }).observe(groups);

  const all = () => { drawHead(); drawProgress(); drawGroups(); drawAssistant(); drawSession(); drawTargets(); drawSave();
    // only a new open decision (or a new board) brings the list along; switching option or size within one does not
    const at = state.route.name === 'group' && state.view ? `${state.boardId}/${state.boardRev}/${state.view.group}` : null;
    if (at !== revealedFor) {
      revealedFor = at;
      if (at) revealSoon();
    }
  };
  subscribe(['route', 'boards'], all);
  // a choice or a note must not pull the list back; opening or closing a section or the filter may need the open row shown
  // A redraw can make the open row taller (a chosen option with a long label) or move it (decisions read again from
  // disk): then it is brought into view, the row only. A row that is fully in view stays where the reviewer left it.
  // Only a row that was fully in view is brought back: a list the reviewer scrolled away by hand stays where it is.
  const openRowShown = () => {
    const link = groups.querySelector('.dec-link[aria-current="page"]');
    if (!link || !groups.clientHeight) return false;
    const box = groups.getBoundingClientRect();
    const rect = (link.closest('li') || link).getBoundingClientRect();
    // A pixel of slack: a row the page itself placed at the list's edge lands a fraction of a pixel past it.
    return rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
  };
  subscribe(['decisions', 'review'], () => {
    const wasShown = openRowShown();
    drawProgress(); drawGroups();
    if (wasShown) revealOpen({ withHead: false });
  });
  subscribe(['nav'], () => { drawProgress(); drawGroups(); revealSoon(); });
  subscribe(['review', 'assistant'], drawAssistant);
  subscribe(['session'], drawSession);
  subscribe(['health'], drawTargets);
  subscribe(['save'], drawSave);
  subscribe(['notice'], drawNotice);
  drawNotice();
  all();
}
