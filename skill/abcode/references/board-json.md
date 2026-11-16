# board.json and the files around it

The complete reference for an ABCode board: what you write (`board.json`), what the page writes (`decisions.json`), what the wait command writes (`receipt.json`, `listener.json`), and the addresses you can read. If anything here disagrees with the tool's own `README.md`, the README describes the installed version, so follow it.

## Contents

1. [Where a board lives](#1-where-a-board-lives)
2. [How mistakes are reported](#2-how-mistakes-are-reported)
3. [The board (top level)](#3-the-board-top-level)
4. [Targets](#4-targets)
5. [Viewports](#5-viewports)
6. [Asset roots and photographs](#6-asset-roots-and-photographs)
7. [Sessions (one-click accounts)](#7-sessions-one-click-accounts)
8. [Groups (decisions)](#8-groups-decisions)
9. [Options](#9-options)
10. [decisions.json](#10-decisionsjson)
11. [receipt.json and listener.json](#11-receiptjson-and-listenerjson)
12. [The wait command's output](#12-the-wait-commands-output)
13. [Server addresses](#13-server-addresses)
14. [Example: an options board](#14-example-an-options-board)
15. [Example: a before/after check board](#15-example-a-beforeafter-check-board)

## 1. Where a board lives

```
<boards>/                     the folder passed with --boards (the project's own, never the tool's)
  <id>/                       the board id: the folder name, only a-z, 0-9 and -
    board.json                you write this
    shots/...                 photographs, under a folder named in assetRoots
    decisions.json            written by the page at every change
    decisions.history.jsonl   one line per save and per finish
    pictures/<decision id>/   screenshots the user added to a decision (written by the page)
    receipt.json              written by the wait command when it reports a finish
    listener.json             the wait command's heartbeat while it waits
```

Only folders whose name matches `[a-z0-9-]+` and that hold a `board.json` are boards; any other folder is not listed. Pass the absolute path of `<boards>` with `--boards` to both the server and the wait command. Both fall back to the tool's own `boards/` folder, which is for the tool's example only, and a relative path is read from the current folder.

Boards are read from disk on every request, so changes need no server restart. An open page picks up a changed board when the reviewer comes back to its tab, and a reload does the same; until then the page shows the board it loaded. A UTF-8 byte order mark at the start of `board.json` is tolerated. The `*.tmp` files are the temporary halves of atomic writes and disappear at once.

## 2. How mistakes are reported

Unknown fields are ignored. A mistake (a wrong type, an empty or over-long value, an id that names nothing) stops the board from loading and is reported as one sentence with the file and the field:

```
E:/project/review-boards/checkout/board.json: "groups[1].recommended" names "zzz", which is not an option of this group.
```

A file that is not JSON at all gives `<file> is not valid JSON: <the parser's message>`.

You get that sentence from `GET /api/boards/<id>` (as `{ "error": "..." }`, status 500; a board that does not exist is 404), from the boards list (the broken board is listed as `{ id, title: id, groups: 0, error }`; the others still work), and from the wait command (on stderr, exit code 1, but only when it starts: a board broken while it waits is read again until it is fixed).

Ids inside a board (viewports, sessions, groups, options) must start with a letter or digit and contain only letters, digits, `-` and `_`. Each must be unique in its list; option ids are unique within their group. The board id itself (the folder name) is stricter: `a-z`, `0-9` and `-` only.

Every rule that refuses a board, in one list:

- `title` missing, not a string, or blank. Any other text field that is given but is not a string.
- `groups` missing or empty; a group's `options` missing or empty, also for `pick: "none"`; `pick` other than `"one"` or `"none"`.
- An id that breaks the rule above, or is used twice.
- `targets` not an object; a target without `origin`, or with an origin that is not an `http://` or `https://` address.
- `viewports` given but empty; a width or height that is not a whole number from 100 to 10000.
- `assetRoots` not an object; a root name with characters other than letters, digits, `-` and `_`; a folder that is not a non-empty string.
- A session whose `target` is not in `targets`; a session with neither `cookie` nor `clear`; a `cookie` without `name`, `file` or `jsonPath`; a cookie name, or a name in `clear`, that is not a valid cookie token; an empty `clear`.
- `defaultSession` or a group's `session` naming no session; `recommended` naming no option of its group; `defaultViewport` naming no viewport.
- `section` blank or over 60 characters; `steps` with more than 8 items or `caveats` with more than 6; any step or caveat blank or over 300 characters.
- An option's `notes` that is not a list of strings; `live` that is not an object; `live.url` that is not an `http://` or `https://` address; `live.target` not in `targets`; `live.path` not starting with `/`; a `query` value that is an object, a list or null.
- `shots` keyed by something that is not a viewport id; a photograph without `label` or `src`; a `src` that does not start with an `assetRoots` name and a slash, or has `.`, `..` or empty segments.

Unknown fields are ignored without a word, so a misspelt field (`recomended`) is simply missing from the normalized board. Read `GET /api/boards/<id>` back after writing a board to catch that.

## 3. The board (top level)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `title` | string, required, not blank | | Shown at the top of the sidebar and in the boards list. |
| `subtitle` | string | `""` | A line under the title. |
| `targets` | object | `{}` | The sites live frames point at. See 4. |
| `viewports` | list | desktop 1440x900, phone 390x844 | The sizes offered. See 5. |
| `assetRoots` | object | `{}` | Folders with photographs. See 6. |
| `sessions` | list | `[]` | One-click accounts. See 7. |
| `defaultSession` | string, a session id | none | The account to make active when a decision opens that has no `session` of its own. Must name a session in `sessions`. |
| `groups` | list, required, at least one | | The decisions, in the order shown. See 8. |

## 4. Targets

`targets` is an object: `{ "<name>": { "label", "origin", "hint" } }`. The name is what options and sessions refer to.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `origin` | string, required | | `http://` or `https://` plus host and port. Only the origin is kept; a path is dropped. Use `127.0.0.1`, not `localhost`. |
| `label` | string | the name | Shown in the sidebar's "Sites" list ("<label>: answering"), on the "not answering" card, and in the sentence of a refused account switch. |
| `hint` | string | `""` | Shown when the site does not answer, for example `Start it with: npm run dev -- --port 5181`. |

`GET /api/boards/<id>/health` reports whether each target answers. Any HTTP answer counts as `"ok": true`, whatever its status, so also read `status`: a 404 or 500 there means the frames will show an error page.

## 5. Viewports

A non-empty list of `{ "id", "label", "width", "height" }`. If you give the list, it replaces the defaults entirely.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id, required | | Used by `shots` and `defaultViewport`. |
| `label` | string | the id | Shown on the size control. |
| `width`, `height` | whole numbers, 100 to 10000 | | The CSS size of the live frame. |

The default is `[{ "id": "desktop", "label": "Desktop", "width": 1440, "height": 900 }, { "id": "phone", "label": "Phone", "width": 390, "height": 844 }]`. With two or more viewports, the size control (key `V`) also offers "Both".

## 6. Asset roots and photographs

`assetRoots` is an object `{ "<name>": "<folder>" }`. The name may contain letters, digits, `-` and `_`. The folder is relative to the board folder or absolute. Files are served under `/boards/<id>/assets/<name>/<path>`. The server never lists a folder and never serves a path that leaves its root.

An option's `shots` refers to files as `"<asset root name>/<path inside it>"`, for example `"shots/sticky-phone-top.png"` with `"assetRoots": { "shots": "shots" }`. See 9 and `photographs.md`. The folder is not checked when the board loads: a missing file shows up only as a broken picture, so open one photograph's `url` to check. Pictures are served as PNG, JPEG (`.jpg`, `.jpeg`), GIF, WebP, AVIF or SVG.

## 7. Sessions (one-click accounts)

A list. Each session either sets one cookie read from a local file or clears cookies.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id, required | | Referred to by `defaultSession` and `group.session`. |
| `label` | string | the id | The button text, for example `Test user`. |
| `target` | string, required | | A target name in `targets`. The page's host name must equal this target's host name for the switch to work. |
| `cookie` | object | | Set a cookie. Give either `cookie` or `clear` (with both, `cookie` is used). |
| `cookie.name` | string, required | | The site's session cookie name. |
| `cookie.file` | string, required | | A JSON file on this machine, relative to the board folder or absolute. |
| `cookie.jsonPath` | string, required | | Dot path to a string inside the file, for example `accounts.user.cookie`. |
| `cookie.stripPrefix` | string | `""` | Removed from the start of the value, for example `app_session=` when the file holds a whole `name=value` pair. |
| `clear` | list of cookie names, at least one | | Clear these cookies (sign out). |

```json
"sessions": [
  { "id": "user", "label": "Test user", "target": "local",
    "cookie": { "name": "app_session", "file": "../../.dev/accounts.json", "jsonPath": "accounts.user.cookie", "stripPrefix": "app_session=" } },
  { "id": "out", "label": "Signed out", "target": "local", "clear": ["app_session"] }
]
```

What happens on a switch: the page sends `POST /api/boards/<id>/session/<session>`. The server reads the file when asked and answers `204` with `Set-Cookie: <name>=<value>; Path=/; HttpOnly; SameSite=Lax` (no Domain), or `Max-Age=0` for each cleared name. Browsers scope cookies by host name, not port, so a cookie set by the board on 127.0.0.1:4600 is sent to the site on 127.0.0.1:5180. The value never appears in a response body or a log. Then the page reloads its frames.

Refusals, each with a sentence that the page shows on its error line: `409` when the page's host name is not a loopback address equal to the target's host name (open the board at the address the sentence names); `404` for an unknown session, a missing file, or nothing at `jsonPath`; `500` when the file is not JSON or the value cannot be a cookie value.

Use only local test accounts, and keep the cookie file out of version control. `board.json` never holds a cookie value, a password or a token.

**Accounts that follow the decision.** When the board has `defaultSession`, or the group being opened has `session`, opening that group makes its account active: `group.session` if it has one, else `board.defaultSession`. "Opening" is any way a group becomes the one on screen: a click in the sidebar, Up/Down or K/J, a direct link (`#/b/<id>/g/<group>`), a reload, or the page restoring the last place when it opens with no hash. If the wanted account is not the one this page set last on the site (remembered in localStorage per host name of the site, together with the board and session that set it; another board on the same site, in any tab, replaces the record and so makes this board set its account again), the page sets it through the same endpoint and reloads the frames, as the manual switch does; if it is, nothing is sent. Changing option, size, mode or layout does not switch again, and the Summary and finish pages never switch.

The sidebar's "Account in the frames" section shows the buttons, then one line: "This decision is shown as: <label>" when the group's own `session` is active, else "Active: <label>", else "Not set from this page yet". After a switch a second line says what happened ("Switched to <label> for this decision. Frames reloaded." for a group's own `session`, "Switched to <label>. Frames reloaded." for the default, "Now using: <label>. Frames reloaded." for a manual switch, "<label>: cookies cleared. Frames reloaded." for a `clear` session, or the server's refusal). A manual switch still works and holds until the user moves to another group. The page switches at most once per change of group, waits while the page is hidden and switches when it is seen again, and does not retry when the server refuses. Because the page only remembers what it set (and says "Not set from this page yet" when another board on the same site set an account since), a sign-out done inside a frame goes unnoticed: pressing the account's button again sets it. Boards with neither field never switch by themselves: the account is whatever the user last picked.

## 8. Groups (decisions)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id, required | | Decisions are stored under it. Keep it while the question is the same. |
| `title` | string | the id | The short name in the sidebar and the digest. |
| `question` | string | `""` | The plain question the user answers. |
| `description` | string | `""` | What is compared, what is held constant, where to look. |
| `pick` | `"one"` or `"none"` | `"one"` | `"none"` is a notes-only decision: no Choose button, the choice is always null, and "Mark as looked at" (key `C`) instead. It still needs at least one option, which is what the frame shows. |
| `recommended` | option id | none | Shown as "Suggested" on that option's tab and in the right panel. |
| `defaultViewport` | viewport id | the size last used, else the first viewport | The size the decision opens at. A `v=` in the address wins over it. It cannot be `"both"`. |
| `section` | string, 1 to 60 characters | none | Consecutive groups with the same section form one section. See below. |
| `steps` | list of at most 8 strings, each 1 to 300 characters | `[]` | Shown in the right panel under the description as a numbered list headed "To see it". |
| `caveats` | list of at most 6 strings, each 1 to 300 characters | `[]` | Shown under the steps, in a quieter colour, headed "The live frame cannot show". |
| `session` | session id | none | The account to make active when this group opens (see 7). Must name a session in `sessions`. |
| `options` | list, required, at least one | | See 9. |

**Sections.** The sidebar shows a quiet heading before the first group of each section with the section's name and how many of its groups are decided ("3 of 12"). The heading collapses and expands the section; the choice is remembered per board in the browser. The section holding the active group is always open. Up/Down and K/J walk the groups in board order across sections and open a collapsed section they move into. The Summary page and the finish page list decisions under the same headings. Groups without a section stand alone. Only consecutive groups join: two runs with the same name, split by another section, are two sections, so keep each section's groups together.

**Live or photographs.** A decision opens in the mode last used; when none of its options has the one last used (no `live`, or no `shots`), it opens in the other. The first decision opens live when any option has `live`.

**"Undecided only".** A toggle in the sidebar hides decided groups and any section left empty; the active group always stays visible, and Up/Down then walk only the visible groups. Remembered per board in the browser.

**"New".** When the board has been finished before and a group's id is not in `submitted.groupIds`, the sidebar shows a small "New" tag on it until it is decided, and its section heading says how many are new. Give a new question a new id so the tag appears.

## 9. Options

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id, required | | Unique within the group. Key `1` to `9` picks options in list order. |
| `label` | string | the id | The tab text. Keep it short: `A · Sticky total`, `Today`. |
| `summary` | string | `""` | One or two sentences on what is different. |
| `notes` | list of strings | `[]` | Short trade-offs, shown as a list. |
| `live` | object or null | none | What the live frame loads. |
| `shots` | object | `{}` | Photographs per viewport. |

`live` takes one of two forms:

```json
{ "target": "local", "path": "/checkout", "query": { "ui": "sticky-total" } }
{ "url": "http://127.0.0.1:5180/checkout?ui=sticky-total" }
```

With a target, the address is the target's origin plus `path` (must start with `/`, default `/`) plus `query`. Every query key is sent, also when its value is empty: `"ui": ""` gives `?ui=`. Query values may be strings, numbers or booleans and are sent as text. With `url`, the address is used as it is (http or https). An option with no `live` has photographs only.

`shots` is `{ "<viewport id>": [ { "label", "src" } ] }`. Each viewport id must be one of the board's viewports. `label` (required) names the state ("Top", "Menu open", "Dark"); `src` (required) is `<asset root name>/<path>` with no `.`, `..` or empty segments. The photograph selector offers the union of labels at the current size, in first-seen order, so use the same labels across options for the same state; an option without that photograph says so.

## 10. decisions.json

Written by the page at every change, atomically (a temp file renamed over the old one), so it is always valid JSON. Read it if you need to; do not write it while the user is reviewing. A missing file means no decisions.

```json
{
  "board": "checkout",
  "updatedAt": "2026-05-02T14:30:41.120Z",
  "groups": {
    "summary-layout": {
      "choice": "sticky",
      "note": "Yes, but make the bar shorter.",
      "optionNotes": { "today": "Keep the item photos from this one." },
      "updatedAt": "2026-05-02T14:29:07.120Z"
    },
    "empty-cart": {
      "choice": null,
      "note": "",
      "optionNotes": {},
      "done": true,
      "updatedAt": "2026-05-02T14:30:41.120Z"
    }
  },
  "submitted": {
    "at": "2026-05-02T14:31:09.512Z",
    "decided": 2,
    "total": 3,
    "groupIds": ["summary-layout", "empty-cart", "footer"]
  }
}
```

| Field | Meaning |
|---|---|
| `groups.<id>.choice` | An option id, or `null`. Always `null` for `pick: "none"`. |
| `groups.<id>.note` | The note on the decision. At most 4000 characters. |
| `groups.<id>.optionNotes` | `{ "<option id>": "note" }`, notes on single options. Empty notes are left out. |
| `groups.<id>.done` | Only for `pick: "none"`: `true` when marked as looked at; left out when off. |
| `groups.<id>.pictures` | Screenshots the user added: `[{ "file": "pictures/<id>/<name>", "addedAt", "bytes", "option", "viewport", "mode" }]`. `file` is relative to the board's folder; `option`, `viewport` and `mode` (`live` or `shots`) say what was showing. The server owns the list: a save never changes it. For `pick: "none"` a picture counts like a note. |
| `groups.<id>.updatedAt` | When this decision last changed. |
| `submitted` | Written by Finish review, never by a save. `groupIds` are the groups on the board at that moment. Absent until the first finish; replaced by each later finish. |

A group is absent until something is chosen or written. A decision counts as decided when its choice is an option still on the board, or, for `pick: "none"`, when it is marked done or has a non-empty note. Decisions for groups or options no longer on the board are kept and shown as "Chosen earlier", but not counted.

**The state of a review** is derived, never stored: `open` (never finished), `finished` (finished, and nothing changed and no group was added since), `changed` (finished, then a decision's `updatedAt` passed `submitted.at` or a group appeared whose id is not in `submitted.groupIds`).

`decisions.history.jsonl` gets one line per save, `{ "at", "groups" }`, and one per finish, `{ "at", "event": "submitted", "decided", "total" }`.

## 11. receipt.json and listener.json

Both are written by the wait command, next to `decisions.json`, atomically. Keep them out of version control.

`receipt.json`, what was last reported:

```json
{ "submittedAt": "2026-05-02T14:31:09.512Z", "reportedAt": "2026-05-02T14:31:09.880Z" }
```

On start, the wait command reports at once any finish whose `at` is later than `submittedAt` (or any finish when there is no receipt). It never reports the same finish twice. Deleting the receipt makes the last finish reportable again.

`listener.json`, the heartbeat, rewritten every 2 seconds while the command waits and removed when it exits:

```json
{ "pid": 12345, "startedAt": "2026-05-02T14:20:00.000Z", "beatAt": "2026-05-02T14:31:08.002Z" }
```

A heartbeat older than 6 seconds counts as nobody waiting (a hard kill leaves a stale file, which is harmless).

**The status address.** `GET /api/boards/<id>/status` answers:

```json
{ "state": "finished", "submitted": { "at": "...", "decided": 2, "total": 3, "groupIds": ["..."] }, "listening": false, "received": true }
```

`listening` is true while a fresh heartbeat exists; `received` is true when the receipt's `submittedAt` equals the current finish's `at`. The page asks every 3 seconds while it is visible (every second on the finish page while it still reads "Telling your assistant…"). It uses the answer for "An assistant is waiting for you to finish." in the sidebar (shown only while the review is not finished) and for the line on the finish page:

| Situation | The line |
|---|---|
| an assistant is listening and has not picked the finish up yet (up to 15 seconds) | "Telling your assistant…" |
| the assistant has the finish | "Your assistant has your decisions." |
| nobody is listening, or 15 seconds passed without a receipt | "Saved. No assistant is waiting right now. It will read your decisions from this file the next time you ask it." and the path of `decisions.json` |
| changed after the finish, an assistant has the earlier finish | "Your assistant has the decisions from <date and time>. Finish again to send the changes." |
| changed after the finish, an assistant is waiting | "An assistant is waiting. Finish again to send your changes." |

## 12. The wait command's output

```
node <tool>/bin/wait.mjs --board <id> [--boards <folder>] [--timeout <seconds>] [--json]
abcode-wait --board <id> ...        when installed as a package
```

`--boards` defaults to the tool's own `boards/` folder, so always pass the project's folder, as an absolute path (a relative one is read from the current folder). Flags also work as `--board=<id>`. Exit codes: `0` a finish was reported; `1` the board is missing or unreadable, an option is wrong, or the heartbeat file cannot be written (one sentence on stderr); `2` `--timeout` passed (one line on stdout: `No finished review for board "<id>" after <n> seconds.`); `130` stopped by Ctrl-C or another signal. Without `--timeout` it waits without limit. It checks the files twice a second and writes the receipt right after printing.

The text output, line by line:

- `Review finished: <title> (board <id>)` and `Finished at: <ISO time>`.
- `<n> of <m> decided`, or, when decisions changed after the finish, `Note: decisions changed after this finish; what follows is their current content.` and `At the finish: <n> of <m> decided. Now: <n> of <m> decided.`
- For every decision on the board, in order: `<number>. <title> (<id>)`, then one of `Chosen: <label> (<id>)`, `Looked at (notes only)`, `Notes only` (a note but no mark) or `Undecided`; then, when present, `Stored choice "<id>" is no longer an option on the board.`, `Note:` with the note indented below, `Note on <label> (<id>):` for each option note, and `Note on option <id> (no longer on the board):` for notes on options the board no longer has.
- `Stored decisions for decisions no longer on the board:` and one line per such decision, `- <id> (no longer on the board) chose <option id>` or `looked at`, with its notes below.
- When a decision has pictures: `pictures (open each file to see it):` and one line per picture, an absolute path with forward slashes and `(added while "<option label>" was showing, <viewport>, live|photographs)`.
- Last, `Decisions file: <absolute path>`.

With `--json`:

```json
{
  "board": { "id": "checkout", "title": "Checkout page" },
  "state": "finished",
  "finishedAt": "2026-05-02T14:31:09.512Z",
  "decided": 2,
  "total": 3,
  "atFinish": { "decided": 2, "total": 3 },
  "groups": [
    { "id": "summary-layout", "title": "Order summary", "status": "chosen",
      "choice": { "id": "sticky", "label": "A · Sticky total" },
      "note": "Yes, but make the bar shorter.",
      "optionNotes": [ { "id": "today", "label": "Today", "note": "Keep the item photos from this one." } ],
      "pictures": [ { "file": "/path/to/review-boards/checkout/pictures/summary-layout/20260502-143012-ab12.png", "addedAt": "2026-05-02T14:30:12.000Z", "option": "A · Sticky total", "viewport": "Phone", "mode": "live" } ],
      "removedChoice": null, "removedOptionNotes": [] },
    { "id": "empty-cart", "title": "Empty cart", "status": "looked-at", "choice": null, "note": "", "optionNotes": [], "removedChoice": null, "removedOptionNotes": [] },
    { "id": "footer", "title": "Footer links", "status": "undecided", "choice": null, "note": "", "optionNotes": [], "removedChoice": null, "removedOptionNotes": [] }
  ],
  "removedGroups": [ { "id": "header", "choice": "slim", "note": "", "optionNotes": [], "looked": false } ],
  "decisionsFile": "/path/to/review-boards/checkout/decisions.json"
}
```

`status` is `chosen`, `looked-at`, `noted` (a notes-only decision with a note but not marked) or `undecided`. `removedChoice` is a stored choice that is no longer an option; `removedOptionNotes` are notes on options no longer on the board; `removedGroups` are decisions no longer on the board. All three are history from an earlier round.

## 13. Server addresses

```
GET  /api/boards                          [ { id, title, subtitle, groups, decided, review } ], or { id, error } for a broken board
GET  /api/boards/<id>                     the normalized board, or { error }
GET  /api/boards/<id>/decisions           decisions.json plus review { state, decided, total, submitted }
GET  /api/boards/<id>/status              { state, submitted, listening, received } (plus `pictures`, a count, when there are any)
GET  /api/boards/<id>/groups/<decision>/pictures/<name>   a picture the user added
GET  /api/boards/<id>/health              { <target>: { ok, status, ms } }
GET  /boards/<id>/assets/<root>/<path>    a photograph
PUT  /api/boards/<id>/decisions           the page's save
POST /api/boards/<id>/submit              the page's Finish review
POST /api/boards/<id>/session/<session>   the page's account switch
POST /api/boards/<id>/groups/<decision>/pictures, DELETE .../pictures/<name>   the page's picture upload and removal
```

As the assistant, use the GET addresses to check a board (HEAD works too). The PUT and POST addresses are the user's: saving and finishing for them would put words in their mouth. The normalized board fills in defaults, gives each option's `live` as `{ target, url }` with the full address (`target` is null for a `url` option) and each photograph a `url` to add to the server's origin, lists sessions as `{ id, label, target, kind }` with `kind` `set` or `clear` (no cookie files), carries `section`, `steps`, `caveats`, `session` and `defaultSession`, leaves out `assetRoots` and every folder, and adds `decisionsPath`, the absolute path of the board's `decisions.json`. That path tells you which boards folder a running server reads: if it is not `<boards>/<id>/decisions.json`, the server on that port is someone else's.

The server answers only loopback host names (and the exact `--host` it was started with; anything else gets 421); a request for `localhost` is redirected to `127.0.0.1`. A PUT or POST whose `Origin` is not the board page's own is refused with 403. Errors are JSON, `{ "error": "<a sentence>" }`; an unknown address is 404 `No such address.`

## 14. Example: an options board

One decision, three options behind a URL flag, photographs of a state the frame cannot show, and a suggested option. The site reads `?nav=` and draws the matching navigation; an empty value is today's.

`<boards>/site-nav/board.json`:

```json
{
  "title": "Site navigation",
  "subtitle": "Three ways to show the main menu",
  "targets": {
    "local": { "label": "Dev server", "origin": "http://127.0.0.1:5180", "hint": "Start it with: npm run dev" }
  },
  "assetRoots": { "shots": "shots" },
  "groups": [
    {
      "id": "main-nav",
      "title": "Main menu",
      "question": "Which main menu should the site keep?",
      "description": "The same home page with three menus. The menu is the only thing that changes. Phone first: that is where the current menu is hardest to use.",
      "recommended": "tabs",
      "defaultViewport": "phone",
      "steps": [
        "At phone size, open the menu and look at how far your thumb would travel.",
        "Press V for desktop and check that the menu still fits on one line."
      ],
      "caveats": [
        "Touch: the frame uses a mouse. The photographs labelled Menu open were taken with touch emulation."
      ],
      "options": [
        {
          "id": "today",
          "label": "Today",
          "summary": "A hamburger button at the top left that opens a full-screen list.",
          "notes": ["Familiar", "Two taps to anything"],
          "live": { "target": "local", "path": "/", "query": { "nav": "" } },
          "shots": {
            "phone": [
              { "label": "Top", "src": "shots/today-phone-top.png" },
              { "label": "Menu open", "src": "shots/today-phone-menu.png" }
            ],
            "desktop": [ { "label": "Top", "src": "shots/today-desktop-top.png" } ]
          }
        },
        {
          "id": "tabs",
          "label": "A · Bottom tabs",
          "summary": "Four tabs fixed at the bottom of the phone screen; a plain row of links on desktop.",
          "notes": ["One tap to the main pages", "Takes 56px of the phone screen"],
          "live": { "target": "local", "path": "/", "query": { "nav": "tabs" } },
          "shots": {
            "phone": [
              { "label": "Top", "src": "shots/tabs-phone-top.png" },
              { "label": "Menu open", "src": "shots/tabs-phone-menu.png" }
            ],
            "desktop": [ { "label": "Top", "src": "shots/tabs-desktop-top.png" } ]
          }
        },
        {
          "id": "drawer",
          "label": "B · Side drawer",
          "summary": "The hamburger moves to the right and opens a drawer that covers two thirds of the screen.",
          "notes": ["Reachable with the right thumb", "Still two taps"],
          "live": { "target": "local", "path": "/", "query": { "nav": "drawer" } },
          "shots": {
            "phone": [
              { "label": "Top", "src": "shots/drawer-phone-top.png" },
              { "label": "Menu open", "src": "shots/drawer-phone-menu.png" }
            ],
            "desktop": [ { "label": "Top", "src": "shots/drawer-desktop-top.png" } ]
          }
        }
      ]
    }
  ]
}
```

The photographs are in `<boards>/site-nav/shots/`.

## 15. Example: a before/after check board

The old version runs on port 5181 (a worktree of the base commit) and the new one on 5180. Two sections, steps and caveats, a default account with one decision that overrides it, and a notes-only decision.

`<boards>/release-check/board.json`:

```json
{
  "title": "Release check",
  "subtitle": "Everything that looks different in this release",
  "targets": {
    "before": { "label": "Before (base commit)", "origin": "http://127.0.0.1:5181", "hint": "In the before worktree: npm run dev -- --port 5181" },
    "after": { "label": "After (this branch)", "origin": "http://127.0.0.1:5180", "hint": "npm run dev" }
  },
  "sessions": [
    { "id": "user", "label": "Test user", "target": "after",
      "cookie": { "name": "app_session", "file": "../../.dev/accounts.json", "jsonPath": "accounts.user.cookie", "stripPrefix": "app_session=" } },
    { "id": "out", "label": "Signed out", "target": "after", "clear": ["app_session"] }
  ],
  "defaultSession": "user",
  "groups": [
    {
      "id": "profile-header",
      "section": "Signed in",
      "title": "Profile header",
      "question": "Is the new profile header ready to ship?",
      "description": "The header now shows the item count beside the name.",
      "steps": ["Open the profile from the avatar at the top right.", "Press V for the phone size and check that the name does not wrap."],
      "caveats": ["A very long name: the test user's name is short."],
      "options": [
        { "id": "before", "label": "Before", "live": { "target": "before", "path": "/me" } },
        { "id": "after", "label": "After", "summary": "Item count beside the name, avatar 20% smaller.", "live": { "target": "after", "path": "/me" } }
      ]
    },
    {
      "id": "settings-page",
      "section": "Signed in",
      "title": "Settings page",
      "question": "Are the regrouped settings easier to find?",
      "description": "Settings are now in three groups instead of one long list.",
      "steps": ["Find where to change the e-mail address.", "Find where to turn off notifications."],
      "options": [
        { "id": "before", "label": "Before", "live": { "target": "before", "path": "/settings" } },
        { "id": "after", "label": "After", "live": { "target": "after", "path": "/settings" } }
      ]
    },
    {
      "id": "home-signed-out",
      "section": "Signed out",
      "session": "out",
      "title": "Home page for a first visit",
      "question": "Does the new home page explain the site to someone who has never been here?",
      "description": "Look at it as a stranger would and write what is unclear. There is nothing to choose.",
      "pick": "none",
      "caveats": ["A real first visit: the cookie banner was dismissed in this browser long ago.", "Dark mode: the frame follows this computer's setting."],
      "options": [
        { "id": "after", "label": "After", "live": { "target": "after", "path": "/" } }
      ]
    }
  ]
}
```

Opening either "Signed in" decision makes the test user active (from `defaultSession`); opening the home page signs out (its own `session`). The cookie is set on the host name 127.0.0.1, so it reaches both the before and the after site. The two sessions name the `after` target, but either target would do, since both share that host name.
