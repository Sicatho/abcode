// Talks to the Review Board server. Every failure becomes an Error with a readable sentence.
async function call(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new Error('The Review Board server is not answering.');
  }
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const err = new Error((data && data.error) || `The server answered ${res.status}.`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const enc = encodeURIComponent;
export const listBoards = () => call('GET', '/api/boards');
export const getBoard = (id) => call('GET', `/api/boards/${enc(id)}`);
export const getDecisions = (id) => call('GET', `/api/boards/${enc(id)}/decisions`);
export const saveDecisions = (id, body) => call('PUT', `/api/boards/${enc(id)}/decisions`, body);
export const submit = (id) => call('POST', `/api/boards/${enc(id)}/submit`);
export const getStatus = (id) => call('GET', `/api/boards/${enc(id)}/status`);
export const getHealth = (id) => call('GET', `/api/boards/${enc(id)}/health`);
export const postSession = (id, sessionId) => call('POST', `/api/boards/${enc(id)}/session/${enc(sessionId)}`);

/** A last-chance save while the page closes. */
export function saveBeacon(id, body) {
  try {
    fetch(`/api/boards/${enc(id)}/decisions`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true });
  } catch {}
}
