// Keeps the keyboard with the board. A live frame is another site: once it holds the focus, this page hears no keys,
// and sites often focus something as they load. So: focus that moves into a frame while the pointer is NOT over a
// frame is taken straight back, and focus is taken back again when the pointer leaves a frame. While the pointer is
// inside a frame the keys belong to the page in it (typing in its forms works), and a small hint says so.

const frameHasFocus = () => document.activeElement instanceof HTMLIFrameElement;

export function installFocusKeeper() {
  let inside = false; // the pointer is over a live frame
  const hint = document.createElement('p');
  hint.className = 'focus-hint';
  hint.setAttribute('role', 'status');
  hint.textContent = 'Keys go to the page in the frame. Move the pointer out of it to use the shortcuts.';
  hint.hidden = true;
  document.body.append(hint);

  const sync = () => { hint.hidden = !(inside && frameHasFocus()); };
  const reclaim = () => {
    if (!inside && frameHasFocus()) {
      document.activeElement.blur();
      window.focus();
    }
    sync();
  };

  // The window loses focus when it moves into a frame; ask again a moment later, once activeElement has settled.
  window.addEventListener('blur', () => setTimeout(reclaim, 0));
  window.addEventListener('focus', sync);
  document.addEventListener('pointerover', (e) => {
    const over = e.target instanceof HTMLIFrameElement;
    if (over === inside) return;
    inside = over;
    if (inside) sync();
    else setTimeout(reclaim, 60);
  }, true);
  document.documentElement.addEventListener('pointerleave', () => { inside = false; sync(); });
  // A frame that already held the focus can take it again without a blur event here (a reload inside it): look now and then.
  setInterval(reclaim, 500);
}
