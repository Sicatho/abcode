// A tiny element builder and a re-render helper that keeps keyboard focus.
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value' || k === 'checked') el[k] = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  add(el, kids);
  return el;
}

function add(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

/** Replaces a container's children; if focus was inside, puts it back on the element with the same data-fk. */
export function rerender(container, build) {
  const active = document.activeElement;
  const fk = active && active !== document.body && container.contains(active) ? active.getAttribute('data-fk') : null;
  const top = container.scrollTop;
  const out = build();
  container.replaceChildren(...(Array.isArray(out) ? out.flat(3).filter(Boolean) : [out].filter(Boolean)));
  container.scrollTop = top;
  if (fk) {
    const again = container.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if (again) again.focus({ preventScroll: true });
  }
}

export function isTyping(target) {
  if (!target || !target.tagName) return false;
  const t = target.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || target.isContentEditable;
}
