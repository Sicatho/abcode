// Times, labels and the plain-text summary.
// Every time on the page goes through these helpers, which use the browser's own locale, so they all read alike.
function parse(iso) {
  const d = iso ? new Date(iso) : new Date();
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The time of day, in the browser's locale ("16:59" or "4:59 PM"). */
export function clock(iso) {
  const d = parse(iso);
  return d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
}

/** The date, in the browser's locale ("11 Nov 2026"). */
export function dateOf(iso) {
  const d = parse(iso);
  return d ? d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

/** Date and time ("11 Nov 2026, 16:59"). */
export function stamp(iso) {
  return iso && parse(iso) ? `${dateOf(iso)}, ${clock(iso)}` : '';
}

/** "today 16:59" for today, else the date and the time. */
export function when(iso) {
  const d = iso ? parse(iso) : null;
  if (!d) return '';
  return d.toDateString() === new Date().toDateString() ? `today ${clock(iso)}` : `${dateOf(iso)} ${clock(iso)}`;
}

export function optionLabel(group, id) {
  const o = group.options.find((x) => x.id === id);
  return o ? o.label : id;
}

export function summaryText(board, decisions) {
  const lines = [`${board.title}: decisions${decisions.updatedAt ? ` (saved ${when(decisions.updatedAt)})` : ''}`, ''];
  board.groups.forEach((g, i) => {
    const d = decisions.groups[g.id] || {};
    const prevSection = i > 0 ? board.groups[i - 1].section || null : null;
    if (g.section && (i === 0 || prevSection !== g.section)) lines.push('', `== ${g.section} ==`);
    else if (!g.section && prevSection) lines.push('', '== (no section) ==');
    const verdict = g.pick === 'none' ? (d.done ? 'Notes only · looked at' : 'Notes only') : d.choice && !g.options.some((o) => o.id === d.choice) ? `Chosen earlier: ${d.choice} (no longer on this board)` : d.choice ? optionLabel(g, d.choice) : 'Undecided';
    lines.push(`${i + 1}. ${g.title}: ${verdict}`);
    if (d.note) lines.push(`   Note: ${d.note.replace(/\n/g, '\n   ')}`);
    for (const [oid, t] of Object.entries(d.optionNotes || {})) {
      if (t) lines.push(`   Note on ${optionLabel(g, oid)}: ${t.replace(/\n/g, '\n   ')}`);
    }
    if (Array.isArray(d.pictures) && d.pictures.length) lines.push(`   Pictures: ${d.pictures.length} (the files are listed in the decisions file)`);
  });
  return lines.join('\n');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    ta.remove();
    return ok;
  }
}
