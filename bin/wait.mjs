#!/usr/bin/env node
// review-board-wait: blocks until the review of a board is finished, prints the decisions, and exits.
// It reads files only (no server needed). See README.md, "Telling an assistant when you finish".
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBoard } from '../lib/boards.mjs';
import { readDecisions } from '../lib/decisions.mjs';
import { buildDigest, formatDigest, readReceipt, writeReceipt, isUnreported, writeHeartbeat, removeHeartbeat, HEARTBEAT_EVERY_MS } from '../lib/listen.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const POLL_MS = 500;

const USAGE = `Usage: review-board-wait --board <id> [--boards <folder>] [--timeout <seconds>] [--json]

Waits until the review of a board is finished in the Review Board page, prints the decisions,
and exits. A finish that happened while nobody was waiting is reported at once, once.

  --board <id>        the board to wait for (required)
  --boards <folder>   the folder holding the boards (default: the boards folder next to the tool)
  --timeout <seconds> give up after this long: prints one line and exits with code 2
  --json              print one JSON object instead of text
  --help              this text

Exit codes: 0 reported, 1 the board is missing or unreadable, 2 timed out.
`;

function parse(argv) {
  const opts = { board: null, boards: path.join(here, '..', 'boards'), timeout: null, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline = null;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq !== -1) {
      inline = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    const value = () => {
      const v = inline !== null ? inline : argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value.`);
      return v;
    };
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--board') opts.board = value();
    else if (a === '--boards') opts.boards = path.resolve(value());
    else if (a === '--timeout') {
      const n = Number(value());
      if (!Number.isFinite(n) || n < 0) throw new Error('--timeout must be a number of seconds.');
      opts.timeout = n;
    } else throw new Error(`Unknown option "${a}". Try --help.`);
  }
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The submission to report now, or null. Reads the board and decisions fresh each time. */
function pending(opts) {
  const board = loadBoard(opts.boards, opts.board);
  const decisions = readDecisions(board);
  return isUnreported(decisions.submitted, readReceipt(board)) ? { board, decisions } : null;
}

async function main() {
  let opts;
  try {
    opts = parse(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    return 1;
  }
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (!opts.board) {
    console.error('Say which board to wait for: --board <id>. Try --help.');
    return 1;
  }

  let board;
  let found;
  try {
    board = loadBoard(opts.boards, opts.board);
    found = pending(opts);
  } catch (err) {
    console.error(err.message);
    return 1;
  }

  let beat = null;
  const startedAt = new Date().toISOString();
  const stop = () => {
    clearInterval(beat);
    removeHeartbeat(board);
  };
  process.on('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    try {
      process.on(sig, () => process.exit(130));
    } catch {}
  }

  if (!found) {
    try {
      writeHeartbeat(board, startedAt);
      beat = setInterval(() => {
        try {
          writeHeartbeat(board, startedAt);
        } catch {}
      }, HEARTBEAT_EVERY_MS);
    } catch (err) {
      console.error(`Could not write the listener file in ${board.dir}: ${err.message}`);
      return 1;
    }
    const deadline = opts.timeout === null ? Infinity : Date.now() + opts.timeout * 1000;
    while (!found) {
      if (Date.now() >= deadline) {
        console.log(`No finished review for board "${opts.board}" after ${opts.timeout} seconds.`);
        stop();
        return 2;
      }
      await sleep(Math.min(POLL_MS, Math.max(1, deadline - Date.now())));
      try {
        found = pending(opts);
      } catch {} // a file in the middle of being replaced, or a board being edited: look again
    }
  }

  const digest = buildDigest(found.board, found.decisions);
  process.stdout.write(opts.json ? JSON.stringify(digest, null, 2) + '\n' : formatDigest(digest));
  try {
    writeReceipt(found.board, found.decisions.submitted.at);
  } catch (err) {
    console.error(`Reported, but could not write the receipt: ${err.message}`);
  }
  stop();
  return 0;
}

main().then((code) => {
  process.exitCode = code;
});
