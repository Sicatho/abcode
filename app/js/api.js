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

/** The address of a picture (the file name is the server's own). */
export const pictureUrl = (board, gid, name) => `/api/boards/${enc(board)}/groups/${enc(gid)}/pictures/${enc(name)}`;

/** Sends one picture as its own bytes. `ctx` says which option, size and mode were showing. */
export async function uploadPicture(board, gid, file, ctx) {
  const q = new URLSearchParams();
  for (const k of ['option', 'viewport', 'mode']) if (ctx && ctx[k]) q.set(k, ctx[k]);
  let res;
  try {
    res = await fetch(`/api/boards/${enc(board)}/groups/${enc(gid)}/pictures?${q}`, {
      method: 'POST',
      headers: { 'Content-Type': /^image\//.test(file.type) ? file.type : 'application/octet-stream' },
      body: file,
      cache: 'no-store',
    });
  } catch {
    throw new Error('The Review Board server is not answering. The picture was not saved.');
  }
  return answer(res);
}

export async function deletePicture(board, gid, name) {
  let res;
  try {
    res = await fetch(pictureUrl(board, gid, name), { method: 'DELETE', cache: 'no-store' });
  } catch {
    throw new Error('The Review Board server is not answering. The picture was not removed.');
  }
  return answer(res);
}

async function answer(res) {
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
