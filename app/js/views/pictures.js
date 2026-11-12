// Pictures on a decision: the row of thumbnails (panel, summary, finish page) and the large view.
import { h } from '../lib/dom.js';
import { pictureUrl } from '../api.js';
import { removePicture } from '../store.js';

const nameOf = (p) => String(p.file).split('/').pop();

// The Remove button goes with its picture: the keyboard moves on to the first thumbnail left, or to Add a picture.
async function remove(gid, file) {
  await removePicture(gid, file);
  const a = document.activeElement;
  if (a && a !== document.body && a.isConnected) return;
  const next = document.querySelector('.pics .pic-thumb') || document.querySelector('[data-fk="p:addpic"]');
  if (next) next.focus({ preventScroll: true });
}

/**
 * The thumbnails of a decision. Each is a button that opens the picture large. With `editable`, each has a
 * Remove button, and `pending` (the number being saved) adds that many "Saving…" places at the end.
 */
export function pictureRow(boardId, gid, pictures, { editable = false, pending = 0 } = {}) {
  const total = pictures.length;
  const items = pictures.map((p, i) => ({ src: pictureUrl(boardId, gid, nameOf(p)), n: i + 1, total, key: `pic:${gid}:${nameOf(p)}` }));
  const cells = pictures.map((p, i) => {
    const it = items[i];
    const open = h(
      'button',
      {
        type: 'button',
        class: 'pic-thumb',
        'data-fk': it.key,
        'aria-label': `Picture ${i + 1} of ${total}. Open`,
        title: contextLine(p),
        onclick: (e) => openPicture(items, i, e.currentTarget),
      },
      h('img', { src: it.src, alt: '', loading: 'lazy', draggable: 'false' }),
    );
    return h(
      'li',
      { class: 'pic' },
      open,
      editable ? h('button', { type: 'button', class: 'btn btn-small pic-remove', 'data-fk': `picrm:${gid}:${nameOf(p)}`, 'aria-label': `Remove picture ${i + 1}`, onclick: () => remove(gid, p.file) }, 'Remove') : null,
    );
  });
  for (let i = 0; i < pending; i++) cells.push(h('li', { class: 'pic' }, h('span', { class: 'pic-thumb pic-saving', role: 'status' }, 'Saving…')));
  return h('ul', { class: 'pic-row', 'aria-label': 'Pictures' }, cells);
}

/** What was showing when the picture was added, in words (the thumbnail's tooltip). */
function contextLine(p) {
  const bits = [p.option ? `option ${p.option}` : null, p.viewport || null, p.mode === 'live' ? 'live' : p.mode === 'shots' ? 'photographs' : null].filter(Boolean);
  return bits.length ? `Added with ${bits.join(', ')} showing` : '';
}

let current = null;

/** Opens the picture large. Escape or Close puts the focus back on the thumbnail. */
export function openPicture(items, index, opener) {
  closePicture(false);
  const app = document.getElementById('app');
  let i = index;
  const img = h('img', { class: 'pic-large-img', alt: '' });
  const title = h('h2', { id: 'pic-large-title' });
  const prev = h('button', { type: 'button', class: 'btn btn-small', 'aria-label': 'Previous picture', onclick: () => show(i - 1) }, 'Previous');
  const next = h('button', { type: 'button', class: 'btn btn-small', 'aria-label': 'Next picture', onclick: () => show(i + 1) }, 'Next');
  const close = h('button', { type: 'button', class: 'btn btn-small', 'data-pic-close': '', onclick: () => closePicture(true) }, 'Close');
  const show = (k) => {
    i = (k + items.length) % items.length;
    img.src = items[i].src;
    title.textContent = `Picture ${items[i].n} of ${items[i].total}`;
  };
  const dialog = h('div', { class: 'dialog pic-large', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pic-large-title', tabindex: '-1' }, h('div', { class: 'dialog-top' }, title, h('div', { class: 'pic-large-actions' }, items.length > 1 ? [prev, next] : null, close)), img);
  const root = h('div', { class: 'overlay pic-overlay', onclick: (e) => e.target === root && closePicture(true) }, dialog);
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation(); // the page's own Escape (drawer, help) must not also act
      closePicture(true);
    } else if (e.key === 'Tab') {
      // the page behind is inert; keep Tab inside the dialog
      const tabs = [...dialog.querySelectorAll('button')];
      const at = tabs.indexOf(document.activeElement);
      if (!tabs.length) return;
      if (e.shiftKey && at <= 0) { e.preventDefault(); tabs[tabs.length - 1].focus(); }
      else if (!e.shiftKey && at === tabs.length - 1) { e.preventDefault(); tabs[0].focus(); }
    } else if (items.length > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      show(i + (e.key === 'ArrowRight' ? 1 : -1));
    }
  };
  document.addEventListener('keydown', onKey, true);
  show(i);
  document.body.append(root);
  if (app) app.inert = true;
  close.focus();
  current = { root, onKey, app, key: opener && opener.getAttribute('data-fk'), opener };
}

export const isPictureOpen = () => !!current;

export function closePicture(restoreFocus) {
  if (!current) return;
  const { root, onKey, app, key, opener } = current;
  current = null;
  document.removeEventListener('keydown', onKey, true);
  root.remove();
  if (app) app.inert = false;
  if (!restoreFocus) return;
  // the row may have been drawn again meanwhile: find the same thumbnail by its key
  let back = opener && document.contains(opener) ? opener : key ? document.querySelector(`[data-fk="${CSS.escape(key)}"]`) : null;
  if (!back) back = document.querySelector('.pic-thumb') || document.querySelector('[data-fk="p:addpic"]');
  if (back) back.focus({ preventScroll: true });
}
