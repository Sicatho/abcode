# Review Board

A small tool for reviewing options. You list decisions; each decision has options; every option can be seen **live** (the real local site in a frame, at desktop or phone size) and as **photographs**. Switching option is one key. You pick one, leave a note, and every change is saved at once to a JSON file on disk, so an assistant can read your decisions from there instead of from chat.

No dependencies, no build step: Node 22 or newer on the server, plain ES modules and CSS in the browser.

## Run it

```
node server.mjs                      # http://127.0.0.1:4600/
node server.mjs --port 4700          # another port
node server.mjs --boards D:/my-boards
```

Flags: `--port` (default 4600), `--host` (default 127.0.0.1; leaving this machine lets others change your decisions), `--boards` (default `./boards`). The server prints the address to open. The server answers only loopback host names (127.0.0.1, localhost, [::1]) and the exact `--host` value; any other Host header gets 421 (if you use `--host` with a LAN name, open the board by exactly that name). Open it on **127.0.0.1**, not `localhost` (a request for `localhost` is redirected to `127.0.0.1`, so that cookies and frames share one host name).

`npm start` does the same. `npm test` (which runs `node --test test/*.test.mjs`) runs the server tests.

One board is included: `example` (needs no running site; one live option points at a dead port on purpose, to show the "not answering" state). Retry on the "not answering" card also refreshes the sidebar's target state. It also shows sections, steps, caveats, a notes-only decision and accounts that follow the decision.

**Your own boards.** A project keeps its boards in a folder of its own (for example `review/boards/<id>/board.json`, next to the code under review, or anywhere else) and starts the server with `node server.mjs --boards <that folder>`. Boards, photographs and decisions then live with the project and the tool stays a separate install.

## Add a board

1. Make a folder `boards/<id>/` (the id is the folder name, `[a-z0-9-]+`).
2. Put a `board.json` in it (below) and any photographs under a folder you name in `assetRoots`.
3. Reload the page. Boards are read on every request, so no restart is needed.

Minimal example:

```json
{
  "title": "My site",
  "subtitle": "Options under review",
  "targets": {
    "local": { "label": "Local dev server", "origin": "http://127.0.0.1:5180", "hint": "Start it with: npm run dev" }
  },
  "assetRoots": { "shots": "shots" },
  "groups": [
    {
      "id": "header",
      "title": "Header",
      "question": "Which header should the site keep?",
      "recommended": "b",
      "options": [
        { "id": "a", "label": "Today", "live": { "target": "local", "path": "/", "query": { "ui": "" } },
          "shots": { "desktop": [ { "label": "Top", "src": "shots/a-desktop.png" } ] } },
        { "id": "b", "label": "A · Slim", "summary": "Half the height.", "notes": ["Fewer links"],
          "live": { "target": "local", "path": "/", "query": { "ui": "slim" } } }
      ]
    }
  ]
}
```

## Config reference (`board.json`)

Unknown fields are ignored. Optional fields have defaults. Mistakes are reported with the file and the field, for example `board.json: "groups[1].recommended" names "zzz", which is not an option of this group.` A broken board is listed with its error on the boards page and does not stop the others.

| Field | Meaning |
|---|---|
| `title`, `subtitle` | Shown at the top of the sidebar. `title` is required. |
| `targets` | `{ name: { label, origin, hint } }`: sites that live views point at. `hint` is shown when the site does not answer. |
| `viewports` | `[ { id, label, width, height } ]`: the sizes offered. Default: `desktop` 1440x900 and `phone` 390x844. |
| `assetRoots` | `{ name: folder }`: folders with photographs, relative to the board folder or absolute. Served under `/boards/<id>/assets/<name>/...`. |
| `sessions` | Optional one-click accounts, see below. |
| `defaultSession` | Optional: the id of a session. Opening a decision makes this account active (unless the decision names another), see "Accounts that follow the decision". |
| `groups` | The decisions, in order. |

A **group**: `id`, `title`, `question`, `description`, `pick` (`"one"`, the default, or `"none"` for look-and-comment only: no Choose button, the choice is always null), `recommended` (an option id, shown as "Suggested"), `defaultViewport` (a viewport id), `options`, and four optional fields for boards with many decisions:

| Group field | Meaning |
|---|---|
| `section` | A string of 1 to 60 characters. Consecutive groups with the same section form one section; a group without one stands alone. The sidebar, the Summary and the finish page show a heading for each section. |
| `steps` | A list of at most 8 strings of 1 to 300 characters: what to do to see the decision. Shown as a numbered list under the small heading "To see it" in the right panel. |
| `caveats` | A list of at most 6 strings of 1 to 300 characters: what the live frame cannot show (hover, touch, motion, a sign-in). Shown as a plain, quieter list under "The live frame cannot show", below the steps. |
| `session` | The id of a session. When this decision is opened, that account becomes the active one. It must name a session of the board. |

An **option**: `id` (unique in its group), `label`, `summary`, `notes` (list of strings), `live`, `shots`.

- `live` is `{ "target": "<target name>", "path": "/x", "query": { "key": "value" } }` or `{ "url": "http://..." }`. The address is the target's origin plus the path plus the query. **Every query key is sent, also when its value is empty** (`"ui": ""` gives `?ui=`), because an empty value is meaningful to a site that switches layouts by flag.
- `shots` is `{ "<viewport id>": [ { "label": "Top", "src": "<asset root name>/<path>" } ] }`. The photograph selector offers the union of the labels available at the current size, in first-seen order; an option without that photograph says so.

A **session** is either a cookie to set or cookies to clear:

```json
{ "id": "user", "label": "Test user", "target": "local",
  "cookie": { "name": "app_session", "file": "E:/path/accounts.json", "jsonPath": "accounts.user.cookie", "stripPrefix": "app_session=" } }
{ "id": "out", "label": "Signed out", "target": "local", "clear": ["app_session"] }
```

`file` is relative to the board folder or absolute. The server reads the JSON file, follows `jsonPath` (dots), removes `stripPrefix` from the start of the string and answers with `Set-Cookie: <name>=<value>; Path=/; HttpOnly; SameSite=Lax` (no Domain). A `clear` entry answers with `Max-Age=0` for each name. Browsers scope cookies by host name, not by port, so a cookie set by this server (127.0.0.1:4600) is sent to the site under review (127.0.0.1:5180). Rules: the request's host name must be a loopback address and equal the host name of the session's target origin, otherwise the answer is 409 with a sentence saying which host name to open; the cookie value never appears in a response body or a log; a missing file or path gives a 404 with a sentence. After a switch the page reloads its frames and remembers the chosen account (localStorage).

**Accounts that follow the decision.** With `board.defaultSession` or `group.session` set, opening a decision makes its account active: the group's `session` if it has one, else the board's `defaultSession`. If that account is not the one set last, the page sets it through the same session endpoint and reloads the frames, exactly as the manual switch does. It looks once per change of decision (not when you change option, size or mode), never while the page is hidden (it waits until the page is seen again), and when the endpoint refuses it shows the error line under the accounts and does not try again until you move to another decision. The account section shows which account is active and, when the decision asked for it, one line: "This decision is shown as: <label>". The manual switch still works and holds until you move to another decision. The account last set is remembered per host name of the session's site (a cookie belongs to a host, not to a board), together with the board and the session that set it. A board shows an account as active only when it set it itself: if another board that shows the same site has set an account since, or nothing was ever set from this page, the page says "Not set from this page yet" and sets the account again when a decision asks for one. The record is checked again when the tab is seen again, when the window regains focus, when another tab writes it, and before a decision's account is looked at, so two tabs on two boards of one site never both claim the account. A board with neither field behaves as before. Both fields must name an existing session, otherwise the board is reported with the file and the field.

## Where decisions are stored

`boards/<id>/decisions.json`, rewritten at every change (written to a temp file and renamed, so it is always valid JSON):

```json
{
  "board": "example",
  "updatedAt": "2026-11-11T10:42:07.120Z",
  "groups": {
    "button-style": {
      "choice": "filled",
      "note": "Make the button bigger.",
      "optionNotes": { "filled": "Love the solid colour." },
      "updatedAt": "2026-11-11T10:42:07.120Z"
    },
    "empty-state": {
      "choice": null,
      "note": "",
      "optionNotes": {},
      "done": true,
      "updatedAt": "2026-11-11T10:44:31.002Z"
    }
  },
  "submitted": {
    "at": "2026-11-11T10:51:00.418Z",
    "decided": 2,
    "total": 2,
    "groupIds": ["button-style", "empty-state"]
  }
}
```

- `choice` is an option id or `null`. For `pick: "none"` groups it is always `null` and the note is the answer.
- Decisions for groups or options that are no longer on the board are kept in the file, and editing a note never drops them (the server keeps a stored choice or option note that the board no longer offers; an explicit clear of a choice that is still on the board works as usual); the page shows them as "Chosen earlier" and does not count them as decided.
- `done` is only for `pick: "none"` groups (the page's "Mark as looked at"). It is stored as `true` and left out when it is off. A notes-only decision counts as decided when it is marked `done` or has a non-empty note. A body that does not mention `done` leaves the stored value alone; `done: true` on a group with options is refused.
- `submitted` is written by finishing the review (below), never by a save: a `PUT` keeps it exactly as it is and ignores one in the body. `groupIds` are the ids of the groups on the board at that moment. It is absent until the review is first finished.
- A save that changes nothing writes no file and no history line.
- A group is absent until something is chosen or written. A missing file means no decisions.
- Each save also appends one line to `boards/<id>/decisions.history.jsonl`: `{ "at": "...", "groups": { ... } }`. Finishing the review appends `{ "at": "...", "event": "submitted", "decided": 2, "total": 2 }`.
- Saves are checked: known group ids only; the choice must be an option of that group; each text at most 4000 characters; the whole body at most 64 KB.

**An assistant reads the decisions from that file** (the Summary page shows its path). Nothing needs to be copied or sent.

### Finishing the review

When you are done, press **Finish review** (sidebar, under the list; also at the bottom of the Summary page; key `F`). It stores `submitted` in the decisions file and shows the finish page. With decisions still open the button reads "Finish with 2 undecided" and asks once more, in the page, before sending.

The state of a review is derived on the server every time it is asked for, never stored:

| State | Meaning |
|---|---|
| `open` | never finished |
| `finished` | finished, and since then no decision changed and no group was added to the board |
| `changed` | finished earlier, but a decision changed (a decision's `updatedAt` is later than `submitted.at`) or a group appeared on the board that was not in `submitted.groupIds` |

The answer is `{ "state": "finished", "decided": 2, "total": 2, "submitted": { ... } | null }` (`lib/review.mjs`, `boardReview(board)` is the one call that returns it). It comes with the boards list, the decisions and every save, so the page never works it out itself. What counts as "decided" is one function, `app/js/lib/rules.js`, used by the server and the page. A review that changed can be finished again; the new `submitted` replaces the old one (the history keeps both lines).

### Telling an assistant when you finish

An assistant that works with you (an AI coding assistant that can run a command in the background and is woken when it exits) can wait for the finish instead of being told in chat:

```
node bin/wait.mjs --board <id> [--boards <folder>] [--timeout <seconds>] [--json]
review-board-wait --board <id>          # the same, when the tool is installed (package.json "bin")
```

The command needs no running server: it reads the board folder (`board.json`, `decisions.json`) directly. It blocks until the review is finished in the page, prints the decisions, and exits.

**What it prints.** Plain text for an assistant to read: the board's title and id, when it was finished, "N of M decided" (the current count; when decisions changed after the finish it also says "At the finish: … Now: …"); then for every decision on the board, in order, its title and id, the chosen option (label and id), or "Looked at (notes only)", or "Undecided", then its note and the notes on its options; then stored decisions for decisions or options that are no longer on the board, marked as such; last, the absolute path of the decisions file. With `--json` it prints one JSON object with the same content (`board`, `state`, `finishedAt`, `decided`, `total` (current), `atFinish` (`{ decided, total }` as stored at the finish), `groups[]` with `status` (`chosen`, `looked-at`, `noted`, `undecided`), `choice`, `note`, `optionNotes`, `removedChoice`, `removedOptionNotes`, then `removedGroups[]` and `decisionsFile`).

**Exit codes.** `0` a finish was reported. `1` the board is missing or its `board.json` cannot be read, or an option is wrong (one sentence on stderr). `2` `--timeout` passed without a finish (one line on stdout). Without `--timeout` it waits without limit. `--help` prints the usage.

**Once only.** `boards/<id>/receipt.json` records what was reported: `{ "submittedAt": "<the "at" of the finish>", "reportedAt": "<time>" }`. On start, a finish newer than the receipt is reported at once (a review finished while nobody was waiting is not lost); otherwise the command checks the file twice a second until one appears. The same finish is never reported twice. Finishing again after changes is a new finish and is reported again.

**The heartbeat.** While it waits, the command rewrites `boards/<id>/listener.json` every 2 seconds: `{ "pid", "startedAt", "beatAt" }` (written to a temp file and renamed, like the decisions). It removes the file when it exits for any reason it can see, including Ctrl-C; after a hard kill the file is simply too old to count.

**What the page does with this.** `GET /api/boards/<id>/status` answers `{ "state": "open|finished|changed", "submitted": { ... } | null, "listening": true|false, "received": true|false }`: `listening` is true while a heartbeat younger than 6 seconds exists, `received` is true when the receipt's `submittedAt` equals the finish's `at`. The page asks it every 3 seconds while it is visible, and every second on the finish page while the line there still reads "Telling your assistant…" (it stops if the server stops answering). In the sidebar, a pulsing dot and "An assistant is waiting for you to finish." appear while one is listening. On the finish page the line under the heading has five wordings, all of them shown by the page:

| Situation | The line |
|---|---|
| a listening assistant has not picked the finish up yet (for up to 15 seconds) | "Telling your assistant…" |
| the assistant has the finish | "Your assistant has your decisions." |
| nobody is listening, or 15 seconds passed without a receipt | "Saved. No assistant is waiting right now. It will read your decisions from this file the next time you ask it." and, on its own line below, the path of the decisions file in a small monospace style that may break anywhere |
| the review changed after the finish, and an assistant already has the earlier finish | "Your assistant has the decisions from <date and time>. Finish again to send the changes." |
| the review changed after the finish, and an assistant is waiting | "An assistant is waiting. Finish again to send your changes." |

(With the review changed and nobody listening, the page shows the third wording.)

Both files sit next to `decisions.json` and belong to one person's machine: the included `.gitignore` leaves `receipt.json` and `listener.json` out of a published repository.

## Install the skill

The folder `skill/review-board` is a skill for AI coding assistants. It teaches an assistant when a visual decision belongs on a Review Board (several options to compare, changes to sign off), how to write the `board.json`, start the server, wait for the review with `review-board-wait` and read the decisions back. Install it once per machine:

```
node bin/install-skill.mjs                        # into ~/.claude/skills/review-board
node bin/install-skill.mjs --dest <folder>        # into another skills folder
node bin/install-skill.mjs --dry-run              # show what would be written, change nothing
review-board-install-skill                        # the same, when the tool is installed (package.json "bin")
```

It copies the skill's files to the destination (default: `.claude/skills/review-board` in your home folder) and writes `tool-path.txt` there, holding the absolute folder of this tool, so the assistant can find `server.mjs` and `bin/wait.mjs`. Running it again updates the skill: the skill's own files are overwritten and nothing else in the folder is deleted. An existing empty folder is a valid destination. A folder that holds a different skill (a `SKILL.md` with another name), or other files and no copy of this skill, is refused and left untouched. Start a new assistant session afterwards so it sees the skill.

## Server API

```
GET  /api/boards                          [ { id, title, subtitle, groups, decided, review } ]
GET  /api/boards/<id>                     the normalized board (shot urls filled in)
GET  /api/boards/<id>/decisions           the decisions, plus `review` (state and counts)
PUT  /api/boards/<id>/decisions           save; returns the saved object plus `review` (Content-Type: application/json)
POST /api/boards/<id>/submit              finish the review; no body; returns the decisions plus `review`
GET  /api/boards/<id>/status              { state, submitted, listening, received } (is an assistant waiting, did it get the last finish)
GET  /api/boards/<id>/health              { <target>: { ok, status, ms } }
POST /api/boards/<id>/session/<session>   set or clear the cookie; 204
GET  /boards/<id>/assets/<root>/<path>    a photograph
```

Safety: listens on 127.0.0.1 by default; a PUT or POST (including `submit`) whose `Origin` header is present and is not this server's own origin is refused (403); PUT needs `application/json`; request paths cannot leave their root (`..`, encoded `..`, NUL, absolute paths, backslashes and drive letters are refused, links are resolved before the check); directories are never listed; no CORS headers; errors are JSON with an `error` sentence.

## The page

Hash routes (linkable): `#/` boards, `#/b/<board>/g/<group>?o=<option>&v=<viewport|both>&m=<live|shots>&l=<one|side>&s=<photograph label>`, `#/b/<board>/summary`, `#/b/<board>/finished`. The last place is restored when the page opens with no hash. With one board, the list is skipped.

Live frames have the exact CSS size of the chosen viewport and are scaled down to fit the stage (the scale is shown; "100%" shows them at full size and lets the stage scroll). All options of the decision are kept loaded at the shown size (the shown ones first), so switching is instant. "Both" shows the active option at every size; "Side by side" shows every option. Photographs share one scroll position across options, so switching blinks between them at the same place.

A board is read again when the tab becomes visible and when the window regains focus (at most once every 4 seconds), so edits to `board.json` made while you were away show up without a reload: the board, the decisions and the review state are fetched; if the board changed it is redrawn and the open decision stays open when it still exists, else the first undecided one opens. A note you are typing keeps its text and cursor, and edits that are still waiting to be saved are never replaced by the file. A board that is broken at that moment is ignored and the page stays as it is. If the board no longer has the decision you are writing in and what you wrote could not be saved (the server only accepts decisions of the board on disk), the page keeps the old board and your text, says so under the note and in the save line, and takes in the new board when you press "Discard it and update the board" or move to another decision.

The boards list asks the server again every time it is shown (also after going back from a board and with the browser's back button), so its counts and "Finished" or "Changed since finished" marks are current.

**Sections.** Consecutive groups with the same `section` form one section. In the sidebar each section has a quiet heading (small text, a hairline, no box) with its name and how many of its decisions are decided ("3 of 12"). The heading is a button: it collapses and expands the section (`aria-expanded`), and the choice is remembered per board in the browser (localStorage). The section that holds the open decision is always shown open; a collapsed section still shows its heading and count. Up/Down and K/J walk the decisions in board order across sections; moving into a collapsed section shows it open while you are in it. The Summary page and the finish page list the decisions under the same headings.

**The open decision stays in view.** The list of decisions scrolls by itself (the list only, never the page) so that the open decision is fully visible with its section heading when both fit, when the page opens, when you move with K/J or Up/Down (also into a collapsed section, which opens), and when the filter or a section changes the list. Choosing an option or typing a note does not move the list. There is no animation; the keyboard focus is not moved.

**Undecided only.** A small toggle under the progress bar hides decided decisions and the sections left with nothing to show. The open decision always stays visible, so it disappears from the list only after you move on. It is remembered per board. While it is on, Up/Down and K/J walk only the visible decisions, and the section counts still count all of the section's decisions.

**New.** When a board has been finished before and a decision's id is not among `submitted.groupIds`, the sidebar shows a small "New" tag on it until it is decided, and its section heading says how many are new ("0 of 7 · 2 new").

**Steps and caveats.** A decision's `steps` and `caveats` appear in the right panel under the option's text: the numbered "To see it" list, then "The live frame cannot show" in a quieter colour.

**Notes-only decisions.** In a `pick: "none"` group the right panel has a **Mark as looked at** button (key `C`; press again to unmark). The sidebar shows such a decision as decided with "Looked at", or with the first words of its note when it has one.

**The finish page** (`#/b/<board>/finished`, shown right after finishing and reachable again): a seal that draws itself (no motion when the system asks for reduced motion), "Review finished", how many were decided and when, a line for the assistant, every decision with its choice and note, and the buttons "Back to the board" and "Summary". The sidebar's progress keeps telling the truth after a finish: the bar is filled to the decided share, "3 of 20 decided" stays, and "Finished · <time>" is shown beside it (also when decisions were left undecided); if something changes afterwards it reads "Changed since you finished" and the button reads "Finish again" (with decisions still undecided, "Finish again with 13 undecided", counting the undecided ones; without a change since the finish it reads "Finish review", or "Finish with 13 undecided"). Every time on the page (saved, changed, finished) is written by one helper in the browser's own locale, so they all read alike.

### Keyboard

Never active while typing in a field. `?` shows this in the page.

| Key | Action |
|---|---|
| `1` – `9` | choose the option tab |
| `←` `→` | previous / next option |
| `↑` `↓` or `K` `J` | previous / next decision (the visible ones, in board order, across sections) |
| `L` / `P` | live / photographs |
| `V` | cycle the size (each viewport, then Both) |
| `S` | toggle side by side |
| `C` | choose or clear the active option (in a notes-only decision: mark as looked at, or unmark) |
| `F` | open the finish question (not while typing) |
| `R` | reload the live frames |
| `[` `]` | previous / next photograph |
| `Esc` | close the help, the drawer or the finish question |

After you click inside a live frame, the frame has the keyboard; click outside it before using a key.

## Limits

- A frame shows the layout at phone width, but not touch behaviour: hover and pointer media queries still see a mouse.
- A live frame is another site, so while it holds the keyboard focus this page hears no keys. The board takes the focus back whenever it moves into a frame without the pointer being over one (sites often focus something as they load) and again when the pointer leaves a frame; while the pointer is inside a frame the keys belong to the page in it, and a small hint says so (`app/js/lib/focus.js`).
- Frames of another origin cannot be scrolled in step.
- A site that forbids framing (`X-Frame-Options`, `frame-ancestors`) shows blank; use "Open in a new tab".
- The account switch needs the board and the site on the same host name (both `127.0.0.1`).
- Flags that a site remembers in `localStorage` can leak between frames if a frame is reloaded without its query.
- The page is made for 1100px wide and up; under 1200px the right panel becomes a drawer.
- Decisions are one file per board with last-write-wins: do not review the same board in two windows at once.

## Files

```
server.mjs            entry, flags (bin: review-board)
bin/wait.mjs          blocks until the review is finished, prints the decisions (bin: review-board-wait)
bin/install-skill.mjs copies skill/review-board into the assistant's skills folder (bin: review-board-install-skill)
lib/app.mjs           routes and the safety rules
lib/http.mjs          router, JSON, body cap, content types
lib/boards.mjs        find, validate, normalize boards
lib/decisions.mjs     read, validate, atomic save, history, submit
lib/review.mjs        the derived state of a review (open, finished, changed)
lib/listen.mjs        receipt and heartbeat files, the status answer, the digest the wait command prints
lib/assets.mjs        safe static files
lib/sessions.mjs      one-click accounts
lib/health.mjs        is each target answering
app/                  index.html, styles/{tokens,layout,components}.css, js/ (store, router, keys, api, views/, lib/ with rules.js shared with the server, and sections.js for sections, the filter, the New marker and the account a decision asks for, reload.js for a board changed on disk, revealing the open row and the account remembered per site)
boards/               boards (each: board.json, decisions.json, receipt.json and listener.json when used)
.gitignore            keeps decisions, receipts and heartbeats out of a published repository
test/*.test.mjs       node:test suites
test/visual/shoot.mjs the one visual script (RB_VISUAL=1, needs puppeteer-core and a running server on a spare port); its photographs of the example board are in test/visual/photos/
```
