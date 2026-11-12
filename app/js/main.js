// Starts the page: mounts the views, listens to the address.
import { state, subscribe, applyRoute, setUi, refreshBoardFromDisk, beaconSave, resumeFollow, recheckSession, startStatusPolling, stopStatusPolling } from './store.js';
import { parseHash } from './router.js';
import { mountSidebar } from './views/sidebar.js';
import { mountHead } from './views/head.js';
import { mountControls } from './views/controls.js';
import { mountStage } from './views/stage.js';
import { mountPanel } from './views/panel.js';
import { mountHelp } from './views/help.js';
import { drawBoards } from './views/boards.js';
import { drawSummary } from './views/summary.js';
import { drawFinished, refreshFinished } from './views/finished.js';
import { installKeys } from './keys.js';
import { installFocusKeeper } from './lib/focus.js';

const $ = (id) => document.getElementById(id);
const shell = $('app');

mountSidebar($('sidebar'));
mountHead($('group-head'));
mountControls($('controls'));
mountStage($('stage'));
mountPanel($('panel'));
mountHelp($('overlay-root'));
installKeys();
installFocusKeeper();
$('backdrop').addEventListener('click', () => setUi({ drawer: false }));

function showRoute() {
  const r = state.route.name;
  const kind = r === 'group' ? 'group' : r === 'summary' ? 'summary' : r === 'finished' ? 'finished' : 'boards';
  shell.dataset.route = kind;
  $('boards-view').hidden = kind !== 'boards';
  $('summary-view').hidden = kind !== 'summary';
  $('finished-view').hidden = kind !== 'finished';
  $('group-view').hidden = kind !== 'group';
  if (kind === 'boards') drawBoards($('boards-view'));
  if (kind === 'summary') drawSummary($('summary-view'));
  if (kind === 'finished') drawFinished($('finished-view'));
  document.title = state.board && kind !== 'boards' ? `${state.board.title} · Review Board` : 'Review Board';
}

subscribe(['route', 'boards'], showRoute);
subscribe(['route'], () => (state.route.name === 'boards' ? stopStatusPolling() : startStatusPolling()));
subscribe(['decisions'], () => {
  if (state.route.name === 'summary') drawSummary($('summary-view'));
});
subscribe(['decisions', 'review'], () => {
  if (state.route.name === 'finished') refreshFinished($('finished-view'));
});
const narrow = window.matchMedia('(max-width: 1199px)');
let drawerWas = false;
function syncDrawer() {
  const open = state.ui.drawer;
  shell.classList.toggle('drawer-open', open);
  const trap = (open && narrow.matches) || state.ui.help;
  for (const id of ['sidebar', 'main']) $(id).inert = trap;
  $('panel').inert = state.ui.help;
  if (open && !drawerWas) {
    // move focus into the drawer once it is visible
    requestAnimationFrame(() => {
      const first = $('panel').querySelector('.panel-close, button, textarea, [href]');
      if (first && state.ui.drawer) first.focus();
    });
  } else if (!open && drawerWas) {
    const btn = document.querySelector('[data-fk="c:details"]');
    if (btn && narrow.matches) btn.focus();
  }
  drawerWas = open;
}
subscribe(['ui'], syncDrawer);
narrow.addEventListener('change', syncDrawer);

window.addEventListener('hashchange', () => applyRoute(parseHash(location.hash)));
window.addEventListener('pagehide', beaconSave);
window.addEventListener('pageshow', (e) => {
  if (e.persisted) applyRoute(parseHash(location.hash)); // restored from the browser's back/forward cache
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    recheckSession(); // another board on the same site may have set an account while this tab was away
    resumeFollow(); // an account change that waited while the page was hidden
    // the list of boards is asked for again whenever it comes back into view
    if (state.route.name === 'boards') applyRoute(state.route);
    else {
      refreshBoardFromDisk();
      startStatusPolling();
    }
  } else {
    beaconSave();
    stopStatusPolling();
  }
});
// the window regains focus (coming back from a frame, another window or another tab): read the board again
window.addEventListener('focus', () => {
  recheckSession();
  if (document.visibilityState === 'visible' && state.route.name !== 'boards') refreshBoardFromDisk();
});
// another tab wrote the account it set on a site: this page may no longer know which account the frames carry
window.addEventListener('storage', (ev) => {
  if (ev.key === null || ev.key.startsWith('rb:account-on:')) recheckSession();
});
applyRoute(parseHash(location.hash));
