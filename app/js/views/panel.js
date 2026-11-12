// Right panel: the active option, the Choose button and the two note fields.
import { h } from '../lib/dom.js';
import { state, subscribe, currentGroup, currentOption, groupDecision, toggleChoice, toggleDone, setNote, setOptionNote, setUi, flushNow, discardRemovedNote, contentKey } from '../store.js';
import { when, optionLabel } from '../lib/format.js';

export function mountPanel(root) {
  let key = '';
  let chooseBtn = null;
  let noteArea = null;
  let optArea = null;
  let stamp = null;
  let badgesBox = null;
  let orphanBox = null;
  let shown = null; // the decision and option the panel was last built for

  // The panel is rebuilt when the board changes on disk. If the keyboard focus was inside it (in the drawer under 1200px
  // it must stay there, the rest of the page is inert), it goes back to the same control, else to the first one that shows.
  function focusToken() {
    const a = document.activeElement;
    if (!a || a === document.body || !root.contains(a)) return null;
    return { id: a.id || null, fk: a.getAttribute('data-fk'), close: a.classList.contains('panel-close') };
  }
  function refocus(tok) {
    if (!tok) return;
    const a = document.activeElement;
    if (a && a !== document.body && root.contains(a)) return;
    let el = null;
    if (tok.id) el = root.querySelector('#' + CSS.escape(tok.id));
    if (!el && tok.fk) el = root.querySelector('[data-fk="' + CSS.escape(tok.fk) + '"]');
    if (!el && tok.close) el = root.querySelector('.panel-close');
    const shows = (x) => x.getClientRects().length > 0;
    if (!el || !shows(el)) el = [...root.querySelectorAll('.panel-close, button, textarea, [href]')].find(shows) || null;
    if (el) el.focus({ preventScroll: true });
  }

  function build(g, opt) {
    const hadFocus = focusToken();
    const d = groupDecision(g.id);
    const none = g.pick === 'none';
    chooseBtn = h('button', {
      type: 'button',
      class: 'btn btn-block',
      'data-fk': none ? 'p:done' : 'p:choose',
      onclick: () => (none ? toggleDone(g.id) : toggleChoice(g.id, state.view.option)),
      title: none ? 'Mark as looked at, or take the mark off (C)' : 'Choose or clear (C)',
    });
    noteArea = h('textarea', {
      id: 'note-group',
      rows: '4',
      maxlength: '4000',
      value: d.note,
      oninput: (e) => setNote(g.id, e.target.value),
      onblur: () => flushNow(),
    });
    optArea = h('textarea', {
      id: 'note-option',
      rows: '2',
      maxlength: '4000',
      value: d.optionNotes[opt.id] || '',
      oninput: (e) => setOptionNote(g.id, state.view.option, e.target.value),
      onblur: () => flushNow(),
    });
    const typing = document.activeElement && (document.activeElement.id === 'note-group' || document.activeElement.id === 'note-option') && root.contains(document.activeElement) ? { id: document.activeElement.id, from: document.activeElement.selectionStart, to: document.activeElement.selectionEnd } : null;
    stamp = h('p', { class: 'field-hint' });
    orphanBox = h('div', { class: 'panel-block orphan', role: 'alert', hidden: '' });
    badgesBox = h('div', { class: 'badges' });
    root.replaceChildren(
      ...[
      h('div', { class: 'panel-top' }, h('span', { class: 'sb-label', style: 'margin:0' }, 'This option'), h('button', { type: 'button', class: 'btn btn-small panel-close', onclick: () => setUi({ drawer: false }) }, 'Close')),
      h('div', null, h('h2', null, opt.label), badgesBox),
      opt.summary ? h('p', { class: 'summary' }, opt.summary) : null,
      opt.notes.length ? h('ul', null, opt.notes.map((n) => h('li', null, n))) : null,
      g.steps.length ? h('div', { class: 'panel-block steps' }, h('h3', null, 'To see it'), h('ol', null, g.steps.map((t) => h('li', null, t)))) : null,
      g.caveats.length ? h('div', { class: 'panel-block caveats' }, h('h3', null, 'The live frame cannot show'), h('ul', null, g.caveats.map((t) => h('li', null, t)))) : null,
      none ? h('p', { class: 'field-hint' }, 'This decision is for looking and commenting only. There is nothing to choose. When you have seen enough, mark it as looked at, or just write a note.') : null,
      orphanBox,
      chooseBtn,
      h('div', { class: 'field' }, h('label', { for: 'note-group' }, none ? 'Your notes' : 'What you would change, or a mix of options'), noteArea, h('span', { class: 'field-hint' }, 'Saved by itself.')),
      h('div', { class: 'field small' }, h('label', { for: 'note-option' }, `Note on ${opt.label}`), optArea),
      stamp,
      ].filter(Boolean),
    );
    // the focus and the cursor come back only into the same field of the same decision (and option)
    const same = shown && shown.group === g.id && (!typing || typing.id !== 'note-option' || shown.option === opt.id);
    shown = { group: g.id, option: opt.id };
    if (typing && same) {
      // the panel was rebuilt while a note was being typed (the board changed on disk): the cursor stays where it was
      const again = document.getElementById(typing.id);
      if (again) {
        again.focus({ preventScroll: true });
        try { again.setSelectionRange(typing.from, typing.to); } catch {}
      }
    }
    refocus(hadFocus);
  }

  function refresh(g, opt) {
    const d = groupDecision(g.id);
    const none = g.pick === 'none';
    const chosen = none ? d.done === true : d.choice === opt.id;
    chooseBtn.className = 'btn btn-block ' + (chosen ? 'btn-chosen' : 'btn-primary');
    chooseBtn.setAttribute('aria-pressed', chosen ? 'true' : 'false');
    chooseBtn.textContent = none ? (chosen ? '✓ Looked at (press to unmark)' : 'Mark as looked at') : chosen ? '✓ Chosen (press to clear)' : 'Choose this option';
    // text fields are only overwritten from outside when they are not being typed in
    if (document.activeElement !== noteArea && noteArea.value !== d.note) noteArea.value = d.note;
    const on = d.optionNotes[opt.id] || '';
    if (document.activeElement !== optArea && optArea.value !== on) optArea.value = on;
    badgesBox.replaceChildren(
      ...[
        g.recommended === opt.id ? h('span', { class: 'badge suggest' }, 'Suggested') : null,
        none ? (chosen ? h('span', { class: 'badge chosen' }, '✓ Looked at') : null) : chosen ? h('span', { class: 'badge chosen' }, '✓ Chosen') : d.choice ? h('span', { class: 'badge' }, g.options.some((o) => o.id === d.choice) ? `Chosen: ${optionLabel(g, d.choice)}` : `Chosen earlier: ${d.choice} (no longer on the board)`) : null,
      ].filter(Boolean),
    );
    const gone = state.orphan === g.id;
    orphanBox.hidden = !gone;
    if (gone && !orphanBox.firstChild) {
      orphanBox.replaceChildren(
        h('p', null, 'This decision was removed from the board file while you were writing. What you write from here cannot be saved (what was saved before stays in the decisions file). Copy your text if you want to keep it.'),
        h('button', { type: 'button', class: 'btn btn-small', 'data-fk': 'p:discard', onclick: () => discardRemovedNote() }, 'Discard it and update the board'),
      );
    } else if (!gone && orphanBox.firstChild) {
      const hadFocus = focusToken();
      orphanBox.replaceChildren();
      refocus(hadFocus);
    }
    stamp.textContent = d.updatedAt ? `Last changed ${when(d.updatedAt)}` : '';
  }

  function draw() {
    const g = currentGroup();
    const opt = currentOption();
    if (!g || !opt || state.route.name !== 'group') return;
    const k = `${contentKey(g)}/${opt.id}`; // not rebuilt for a change elsewhere on the board
    if (k !== key) {
      key = k;
      build(g, opt);
    }
    refresh(g, opt);
  }

  subscribe(['route', 'decisions', 'save'], draw);
}
