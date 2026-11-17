// Keyboard shortcuts. Never active while typing in a field.
import { isTyping } from './lib/dom.js';
import { state, setView, setUi, goGroup, toggleChoice, toggleDone, reloadFrames, shotLabels, activeShotLabel, currentGroup, reviewState } from './store.js';
import { isPictureOpen } from './views/pictures.js';
import { openFinish, closeFinish, finishPlace } from './views/finish.js';
import { isDescriptionOpen, setDescriptionOpen, toggleDescription } from './views/head.js';

export function installKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (isPictureOpen()) return; // the picture is a dialog: the page behind it takes no key
    if (e.key === 'Escape') {
      if (state.ui.help) setUi({ help: false });
      else if (state.finish.ask) closeFinish();
      else if (isDescriptionOpen()) setDescriptionOpen(false);
      else if (state.ui.drawer) setUi({ drawer: false });
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) return;
    if (e.key === '?') {
      e.preventDefault();
      setUi({ help: !state.ui.help });
      return;
    }
    if (state.ui.help) return;
    if (e.key.toLowerCase() === 'f' && state.board && ['group', 'summary', 'finished'].includes(state.route.name)) {
      // F opens the confirmation, unless the review is already finished (then there is nothing to confirm)
      if (reviewState() !== 'finished' && (state.route.name !== 'finished' || reviewState() === 'changed')) openFinish(finishPlace());
      e.preventDefault();
      return;
    }
    if (state.route.name !== 'group' || !state.view) return;
    const g = currentGroup();
    const v = state.view;
    const ids = g.options.map((o) => o.id);
    const i = ids.indexOf(v.option);
    const key = e.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;
    let handled = true;
    if (/^[1-9]$/.test(key)) {
      if (ids[Number(key) - 1]) setView({ option: ids[Number(key) - 1] });
    } else if (key === 'ArrowRight') setView({ option: ids[(i + 1) % ids.length] });
    else if (key === 'ArrowLeft') setView({ option: ids[(i - 1 + ids.length) % ids.length] });
    else if (key === 'ArrowDown' || lower === 'j') goGroup(1);
    else if (key === 'ArrowUp' || lower === 'k') goGroup(-1);
    else if (lower === 'l') setView({ mode: 'live' });
    else if (lower === 'p') setView({ mode: 'shots' });
    else if (lower === 'v') {
      const order = state.board.viewports.map((x) => x.id);
      if (order.length >= 2) order.push('both');
      setView({ viewport: order[(order.indexOf(v.viewport) + 1) % order.length] });
    } else if (lower === 's') setView({ layout: v.layout === 'side' ? 'one' : 'side' });
    else if (lower === 'c') {
      if (g.pick === 'none') toggleDone(g.id);
      else toggleChoice(g.id, v.option);
    } else if (lower === 'r') reloadFrames();
    else if (lower === 'd') toggleDescription();
    else if (key === '[' || key === ']') {
      const labels = shotLabels();
      if (v.mode === 'shots' && labels.length) {
        const at = labels.indexOf(activeShotLabel());
        setView({ shot: labels[(at + (key === ']' ? 1 : -1) + labels.length) % labels.length] });
      }
    } else handled = false;
    if (handled) e.preventDefault();
  });
}
