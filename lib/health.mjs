// Is each target site answering? Any HTTP answer counts, whatever its status.

export async function checkOrigin(origin, timeoutMs = 1500) {
  const started = Date.now();
  try {
    const res = await fetch(origin, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    res.body?.cancel().catch(() => {});
    return { ok: true, status: res.status, ms: Date.now() - started };
  } catch {
    return { ok: false, status: null, ms: Date.now() - started };
  }
}

export async function checkTargets(board, timeoutMs = 1500) {
  const names = Object.keys(board.targets);
  const results = await Promise.all(names.map((n) => checkOrigin(board.targets[n].origin, timeoutMs)));
  return Object.fromEntries(names.map((n, i) => [n, results[i]]));
}
