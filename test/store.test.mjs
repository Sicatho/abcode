// The page's store, run in Node with a few browser globals stubbed, against a real server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBoards, cleanup, startServer } from './helpers.mjs';

test('the boards list shows current counts every time it is shown, also right after an edit', async () => {
  const dir = makeBoards();
  const srv = await startServer(dir);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => realFetch(new URL(url, `http://${srv.host}`), init);
  globalThis.location = { hash: '' };
  globalThis.history = { replaceState: (_s, _t, url) => { globalThis.location.hash = url; } };
  try {
    const store = await import('../app/js/store.js');
    const { state, applyRoute, setChoice, toggleDone, reviewState, finishReview } = store;
    const demo = () => state.boards.find((b) => b.id === 'demo');

    await applyRoute({ name: 'boards' });
    assert.equal(demo().decided, 0);

    await applyRoute({ name: 'group', board: 'demo', group: 'g1', params: {} });
    setChoice('g1', 'a'); // saved after the page has moved on: leaving must not lose the count
    await applyRoute({ name: 'boards' });
    assert.equal(demo().decided, 1, 'the list is asked for again and includes the edit that was still waiting');

    await applyRoute({ name: 'group', board: 'demo', group: 'g2', params: {} });
    toggleDone('g2');
    assert.equal(state.decisions.groups.g2.done, true);
    await applyRoute({ name: 'boards' });
    assert.equal(demo().decided, 2);
    assert.equal(demo().review.state, 'open');

    // a change made outside the page (an assistant, another window) shows up on the next visit
    await realFetch(`http://${srv.host}/api/boards/demo/decisions`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groups: { g1: { choice: null } } }) });
    await applyRoute({ name: 'boards' });
    assert.equal(demo().decided, 1);

    // finishing, and the state that follows
    await applyRoute({ name: 'group', board: 'demo', group: 'g1', params: {} });
    assert.equal(reviewState(), 'open');
    await finishReview();
    assert.equal(state.review.state, 'finished');
    assert.equal(reviewState(), 'finished');
    assert.match(globalThis.location.hash, /finished$/);
    setChoice('g1', 'b');
    assert.equal(reviewState(), 'changed', 'an edit waiting to be saved already reads as changed');
    await store.flushNow();
    assert.equal(state.review.state, 'changed', 'and the server agrees once it is saved');
    await applyRoute({ name: 'boards' });
    assert.equal(demo().review.state, 'changed');
  } finally {
    globalThis.fetch = realFetch;
    await srv.close();
    cleanup(dir);
  }
});

test('leaving a removed decision with unsaved text says so once, keeps the text to copy and clears the warning', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { GOOD_BOARD } = await import('./helpers.mjs');
  const dir = makeBoards();
  const srv = await startServer(dir);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => realFetch(new URL(url, `http://${srv.host}`), init);
  globalThis.location = { hash: '' };
  globalThis.history = { replaceState: (_s, _t, url) => { globalThis.location.hash = url; } };
  try {
    const store = await import('../app/js/store.js');
    const { state, applyRoute, setNote, refreshBoardFromDisk, saveLabel, dismissNotice } = store;
    await applyRoute({ name: 'group', board: 'demo', group: 'g1', params: {} });
    await store.flushNow();
    const without = { ...GOOD_BOARD, groups: GOOD_BOARD.groups.filter((g) => g.id !== 'g1') };
    fs.writeFileSync(path.join(dir, 'demo', 'board.json'), JSON.stringify(without));
    setNote('g1', 'my unsaved words');
    await refreshBoardFromDisk({ force: true });
    assert.equal(state.orphan, 'g1');
    assert.match(saveLabel(), /removed from the board/);
    assert.ok(state.board.groups.some((g) => g.id === 'g1'), 'the old board is held');
    await applyRoute({ name: 'group', board: 'demo', group: 'g2', params: {} });
    assert.equal(state.orphan, null);
    assert.ok(!/removed from the board/.test(saveLabel()));
    assert.match(state.notice.text, /my unsaved words/);
    assert.equal(state.notice.title, 'First');
    await new Promise((r) => setTimeout(r, 300)); // the board is read again
    assert.ok(!state.board.groups.some((g) => g.id === 'g1'), 'the new board came in');
    assert.equal(state.view.group, 'g2');
    dismissNotice();
    assert.equal(state.notice, null);
  } finally {
    globalThis.fetch = realFetch;
    await srv.close();
    cleanup(dir);
  }
});

async function removedDecisionRun(body) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { GOOD_BOARD } = await import('./helpers.mjs');
  const dir = makeBoards();
  const srv = await startServer(dir);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => realFetch(new URL(url, `http://${srv.host}`), init);
  globalThis.location = { hash: '' };
  globalThis.history = { replaceState: (_s, _t, url) => { globalThis.location.hash = url; } };
  try {
    const store = await import('../app/js/store.js');
    const without = { ...GOOD_BOARD, groups: GOOD_BOARD.groups.filter((g) => g.id !== 'g1') };
    const remove = () => fs.writeFileSync(path.join(dir, 'demo', 'board.json'), JSON.stringify(without));
    await store.applyRoute({ name: 'group', board: 'other', group: 'g2', params: {} }); // the module keeps the last test's board: load this one afresh
    await body({ store, remove, srv, realFetch });
  } finally {
    globalThis.fetch = realFetch;
    await srv.close();
    cleanup(dir);
  }
}

test('typing on a removed decision after the hold does not stop later choices from saving', async () => {
  await removedDecisionRun(async ({ store, remove, srv, realFetch }) => {
    const { state, applyRoute, setNote, refreshBoardFromDisk, saveLabel } = store;
    await applyRoute({ name: 'group', board: 'demo', group: 'g1', params: {} });
    await store.flushNow();
    remove();
    setNote('g1', 'first words');
    await refreshBoardFromDisk({ force: true });
    assert.equal(state.orphan, 'g1');
    setNote('g1', 'first words and more');
    await new Promise((r) => setTimeout(r, 900)); // the save timer runs with only the removed decision waiting
    await applyRoute({ name: 'group', board: 'demo', group: 'g2', params: {} });
    assert.equal(state.orphan, null);
    await new Promise((r) => setTimeout(r, 300)); // the board is read again
    store.toggleDone('g2');
    await Promise.race([store.flushNow(), new Promise((_, rej) => setTimeout(() => rej(new Error('flush never settled')), 3000))]);
    assert.ok(!/Saving/.test(saveLabel()), 'the save line is not stuck on Saving');
    const res = await realFetch(`http://${srv.host}/api/boards/demo/decisions`);
    const saved = await res.json();
    assert.equal(JSON.stringify(saved) && saved.groups && saved.groups.g2 && saved.groups.g2.done, true, JSON.stringify(saved));
  });
});

test('leaving a removed decision whose text was saved already gives no notice', async () => {
  await removedDecisionRun(async ({ store, remove }) => {
    const { state, applyRoute, setNote, refreshBoardFromDisk } = store;
    await applyRoute({ name: 'group', board: 'demo', group: 'g1', params: {} });
    setNote('g1', 'saved already');
    await store.flushNow();
    remove();
    await refreshBoardFromDisk({ force: true });
    await applyRoute({ name: 'group', board: 'demo', group: 'g2', params: {} });
    assert.equal(state.notice, null);
    assert.equal(state.orphan, null);
  });
});
