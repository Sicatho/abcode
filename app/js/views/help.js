// The keyboard help overlay.
import { h } from '../lib/dom.js';
import { state, subscribe, setUi } from '../store.js';

const setInert = (on) => { for (const id of ['sidebar', 'main', 'panel']) { const el = document.getElementById(id); if (el) el.inert = on; } };

const KEYS = [
  [['1'], ['9'], 'Choose the option tab (1 to 9)'],
  [['←'], ['→'], 'Previous or next option'],
  [['↑', 'K'], ['↓', 'J'], 'Previous or next decision'],
  [['L'], null, 'Live view'],
  [['P'], null, 'Photographs'],
  [['V'], null, 'Cycle the size'],
  [['S'], null, 'Toggle side by side'],
  [['C'], null, 'Choose or clear the active option (or mark a notes-only decision as looked at)'],
  [['F'], null, 'Finish the review (asks before sending)'],
  [['R'], null, 'Reload the live frames'],
  [['D'], null, 'Read the whole description of a decision, or fold it again'],
  [['['], [']'], 'Previous or next photograph'],
  [['Ctrl', 'V'], null, 'Paste a screenshot onto the open decision (or drop a picture on the panel)'],
  [['?'], null, 'Show or hide this help'],
  [['Esc'], null, 'Close this help, an opened description, the drawer or the finish question'],
];

function keyCell(a, b) {
  const out = [];
  a.forEach((k, i) => out.push(i ? ' ' : null, h('kbd', null, k)));
  if (b) {
    out.push(' ');
    b.forEach((k, i) => out.push(i ? ' ' : null, h('kbd', null, k)));
  }
  return h('dt', null, out);
}

export function mountHelp(root) {
  let opener = null;
  function draw() {
    if (!state.ui.help) {
      if (root.firstChild) {
        root.replaceChildren();
        setInert(false);
        if (opener && document.contains(opener)) opener.focus();
        opener = null;
      }
      return;
    }
    if (root.firstChild) return;
    opener = document.activeElement;
    const close = h('button', { type: 'button', class: 'btn btn-small', onclick: () => setUi({ help: false }) }, 'Close');
    const dialog = h(
      'div',
      { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'help-title', tabindex: '-1' },
      h('div', { class: 'dialog-top' }, h('h2', { id: 'help-title' }, 'Keyboard'), close),
      h('dl', { class: 'keys' }, KEYS.map(([a, b, d]) => [keyCell(a, b), h('dd', null, d)])),
      h('p', { class: 'foot' }, 'Keys do nothing while you type in a note. After clicking inside a live frame, click outside it before using a key.'),
    );
    root.replaceChildren(
      h(
        'div',
        {
          class: 'overlay',
          onclick: (e) => {
            if (e.target.classList.contains('overlay')) setUi({ help: false });
          },
        },
        dialog,
      ),
    );
    setInert(true);
    dialog.focus();
  }
  subscribe(['ui'], draw);
}
