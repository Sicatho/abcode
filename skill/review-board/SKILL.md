---
name: review-board
description: Puts UI choices and pre-ship visual checks on a local Review Board page instead of in chat. Each decision shows its options live, as the real local site in frames at desktop and phone size, and as photographs. The user flips between them with one key, picks one, writes notes and presses Finish. You wait in the background and get their decisions back as text, without them typing anything in chat. Use it whenever a person has to choose between designs, layouts, styles or wordings they need to see, or has to sign off visual changes before they ship. That includes "A/B", "which looks better", "show me the options", "before and after", "let me see it first", several UI changes waiting for approval, a user tired of screenshots in chat, or any decision that is easier to make by looking than by reading. Use it even when the user does not name Review Board.
---

# Review Board

Review Board is a small local web app with no dependencies (Node 22+). You write a `board.json` that lists **decisions** (called groups), each with **options**. The page shows every option live in a frame (the real site, at the exact width of a desktop or a phone) and as photographs. The user switches between options with one key, picks one, writes notes, and presses **Finish review**. Every change is saved to `decisions.json` beside the board. A wait command you start in the background exits when the user finishes and prints the decisions, and that wakes you up.

This is better than screenshots in chat because the user sees the real thing at real sizes and compares options by blinking between them at the same scroll position. Their answers also come back as structured data tied to each decision, not as a loose message you have to interpret.

## When to use it, and when not

Use it when the answer depends on looking:

- two or more designs, layouts, colour schemes, components or wordings for the same place;
- a batch of UI changes that needs sign-off before it ships (a before/after check);
- a review where the user should click around a page at phone size and say what bothers them (a notes-only decision);
- a user who has said, in any words, that screenshots in chat are tiring or hard to compare.

Do not use it for:

- a single yes/no question, or anything that reads fine as a sentence. Ask in chat; a board is slower for that.
- changes with no visible difference (refactors, server code, copy that only appears in logs);
- work with no local site to frame and no photographs to show. A board with nothing to look at is a form, and chat is a better form.

When in doubt, offer it in one sentence ("I can put the three versions on a review board so you can flip between them. Want that?") rather than building it unasked for a small question.

## 1. Find the tool

Look in this order, and stop at the first that works:

1. A file `tool-path.txt` in the same folder as this `SKILL.md`. The installer (`bin/install-skill.mjs`) wrote it, and it holds the absolute path of the tool's folder (the one with `server.mjs`, `bin/wait.mjs`, `README.md`). Use `node <tool>/server.mjs` and `node <tool>/bin/wait.mjs`.
2. The commands `review-board` (the server) and `review-board-wait` (the wait command) on PATH, if the tool was linked or installed as a package. Check with `review-board-wait --help`. They take the same flags as the two scripts.
3. Otherwise ask the user where Review Board is. Do not search the whole disk for it.

Read the tool's `README.md` once if anything here seems out of date. The README describes the installed version; this skill describes how to work with it.

Below, `<tool>` stands for the tool's folder, `<boards>` for the absolute path of the project's boards folder (step 3), `<id>` for the board's id and `<port>` for the server's port (step 5).

## 2. Make the options showable

Every option needs something to show: a live address, photographs, or both. Pick the cheapest way that shows the real difference.

- **A URL flag that switches variants.** Best for options. Build the variants behind a query parameter the site reads, for example `?ui=slim` and `?ui=cards`, with no flag meaning today's design. Each option's `live` names the same page with a different `query`. Every query key is sent even when its value is empty (`"ui": ""` gives `?ui=`), so "today" can be an explicit empty flag. Keep the flag temporary and remove it once the user has chosen.
- **A second copy of the site on another port.** Best for before/after. Run the old version (for example a `git worktree` of the base commit) on one port and the new one on another, and make two targets, `before` and `after`. Both copies talk to whatever back end and database you point them at, so make sure that is a local or test one.
- **Photographs only.** When nothing can run live (a state that is hard to reach, a site that refuses to be framed), or as an addition to live frames for states a frame cannot show: hover, a menu that is open, dark mode, an empty account, touch. See `references/photographs.md` for a small capture script.

Use `127.0.0.1` in every origin, not `localhost`. The board itself runs on 127.0.0.1 (a request for `localhost` is redirected there), and one-click accounts work only when the board and the site share a host name.

## 3. Write the board

A board is a folder `<boards>/<id>/` holding `board.json`. The id is the folder name and may contain only `a-z`, `0-9` and `-` (no capitals, no `_`); a folder with any other name is not listed at all. Photographs go in a subfolder that the board names in `assetRoots`.

**Keep boards in the project, never in the tool's folder.** Make a folder such as `<project>/review-boards/` and pass its absolute path with `--boards` to **both** the server and the wait command. The tool's own `boards/` folder is for its example only. Both commands fall back to it when `--boards` is left out, so forgetting the flag on one of them makes it look in the wrong place: the wait command then exits at once with `There is no board called "<id>" (looked for <path>)`. Add these lines to the project's `.gitignore` (with your folder's name if it is not `review-boards`), because they hold one person's answers and the wait command's state:

```
review-boards/**/decisions.json
review-boards/**/decisions.history.jsonl
review-boards/**/receipt.json
review-boards/**/listener.json
review-boards/**/*.tmp
```

The full field list, with types, limits and defaults, is in `references/board-json.md`. Read it before you write a board with sections, accounts, extra viewports or photographs. A small complete board, `<boards>/checkout/board.json`:

```json
{
  "title": "Checkout page",
  "subtitle": "Two layouts for the order summary",
  "targets": {
    "local": { "label": "Dev server", "origin": "http://127.0.0.1:5180", "hint": "Start it with: npm run dev" }
  },
  "groups": [
    {
      "id": "summary-layout",
      "title": "Order summary",
      "question": "Which order summary should the checkout keep?",
      "description": "Same cart of three items. Look at the phone size first: that is where most orders come from.",
      "recommended": "sticky",
      "defaultViewport": "phone",
      "steps": ["Scroll to the bottom of the page.", "Press V to see the desktop size."],
      "caveats": ["Touch scrolling: the frame scrolls with a mouse wheel."],
      "options": [
        { "id": "today", "label": "Today", "summary": "The summary sits under the form.",
          "live": { "target": "local", "path": "/checkout", "query": { "ui": "" } } },
        { "id": "sticky", "label": "A · Sticky total", "summary": "The total and the Pay button stay at the bottom of the screen while you scroll.",
          "notes": ["Always one tap to pay", "Covers 72px of the page on a phone"],
          "live": { "target": "local", "path": "/checkout", "query": { "ui": "sticky-total" } } }
      ]
    }
  ]
}
```

**What makes a board invalid.** The server refuses the whole board and names the file and the field. Avoid these, because the user would see an error instead of the board:

- `title` missing or blank; `groups` missing or empty; a group whose `options` is missing or empty. A notes-only group (`pick: "none"`) also needs at least one option: it is what the frame shows.
- An id of a group, option, viewport or session that does not start with a letter or digit, contains anything but letters, digits, `-` and `_`, or is used twice in its list (option ids: twice in their group).
- A name that points at nothing: `live.target` not in `targets`, `recommended` not an option of its group, `defaultViewport` not a viewport id, `session` or `defaultSession` not a session id, a session's `target` not in `targets`, a `shots` key that is not a viewport id.
- A target `origin` or a `live.url` that is not `http://` or `https://`; a `live.path` that does not start with `/`; a `query` value that is not a string, number or boolean.
- A photograph `src` that does not start with an `assetRoots` name and a slash, or has `.`, `..` or empty segments. Any board with `shots` therefore needs `assetRoots`.
- A session with neither `cookie` nor `clear`, or a cookie name that is not a valid cookie token.
- `section` longer than 60 characters, more than 8 `steps` or 6 `caveats`, or any of them blank or longer than 300 characters.

Unknown fields are ignored without a word, so a misspelt field name (`recomended`) is silently dropped. Check the normalized board in step 6 to catch that.

Notes on what matters most:

- `id`s of groups and options are what decisions are stored under. Keep an id when the question stays the same, so the user's answer stays attached. Give a new id when you change the question materially, so an old answer does not silently carry over.
- `pick: "none"` makes a notes-only decision (no Choose button; "Mark as looked at" instead). Use it for "look at this and tell me what you would change".
- `recommended` shows a "Suggested" tag. Use it when you have a real opinion and say why in the description; leave it out when you do not.
- For 10 or more decisions, give groups a `section` (consecutive groups with the same section form one collapsible heading in the sidebar), so the user can see where they are. Keep each section's groups next to each other: the same name split by another section makes two sections.

## 4. One-click accounts ("sessions")

Many pages look different signed in. A board can offer one-click accounts: the user (or the board) picks "Test user" or "Signed out" under "Account in the frames" in the sidebar, the server sets or clears the site's session cookie, and the frames reload. `board.defaultSession` and `group.session` make the right account active automatically, so a decision about a signed-in page is never judged while signed out.

When it switches: every time a decision is opened, by any route (the sidebar, the keys, a direct link such as `#/b/<id>/g/<group>`, a reload, or the page restoring the last place), the page takes the group's `session`, else the board's `defaultSession`. If this page did not set that account last on the site (the memory is kept per host name of the site, with the board and session that set it, so another board on the same site, in any tab, makes this page set the account again), the page sets it and reloads the frames. Changing option, size or mode does not switch again; the Summary and finish pages never switch. A hidden page waits until it is seen again. A refusal is shown under the account buttons and not retried until the user opens another decision. A manual switch holds until the next decision. The page remembers the last account in the browser, so if the user signs out inside a frame, the page does not know: tell them to press the account's button again.

Safety, and why:

- **Local test accounts only.** The cookie is handed to anyone who can open the board, and the board is meant for one machine. Never use a real person's account or a production session.
- **The cookie value lives in a local file, not in `board.json`.** A session names a JSON file, a dot path inside it and the cookie name. The server reads the file when the switch happens, puts the value only in a `Set-Cookie` header, and never shows it in a response body or a log. `board.json` may end up in a repository; the cookie file must not (add it to `.gitignore`).
- **Never put passwords, API keys or tokens in `board.json`.** There is no field for them, and there should not be.
- Getting the cookie: the usual way is a small script in the project's dev tooling that signs a seeded test account in against the local site and writes its cookie to a file like `dev-accounts.json`. If the project has nothing like that, ask the user before creating test accounts.
- The cookie is set without a Domain on the board's host name, and browsers send cookies by host name, not port, so it reaches every site on 127.0.0.1. The switch works only when the board page and the session's target share that host name. Otherwise the server answers 409 with a sentence saying which address to open.

## 5. Start the server so that it stays up

```
node <tool>/server.mjs --boards <boards> --port 4600
```

Run it so that it keeps running after your call returns. In Claude Code that is the shell tool with `run_in_background` set to `true`, or a terminal tab the user can see. In another harness, use whatever it has for a command that keeps running; if it has nothing, ask the user to run the command in a terminal and keep it open. A server started in a foreground command that you wait on blocks you, and one started in a throwaway shell dies when the shell does. It listens on 127.0.0.1 by default. Do not pass `--host` with another address: anyone who can reach the page can change the decisions.

It prints two lines: `Review Board is running. Open http://127.0.0.1:4600/` and `Boards in <folder>: <ids>`. Check that the folder is `<boards>` and that your id is listed. If it says `Port 4600 is already in use. Try --port <other>.`, a server may already be running there. Ask it `GET http://127.0.0.1:4600/api/boards/<id>`: if the answer's `decisionsPath` is `<boards>/<id>/decisions.json`, that server reads your folder and you can use it. If it answers `There is no board called "<id>"` or another path, it reads someone else's folder, so start yours on the next free port (`--port 4601`, and so on) and use that port everywhere below. Never stop a server you did not start.

Boards are read from disk on every request, so editing `board.json` needs no restart. An open page picks up a changed board when the reviewer comes back to its tab, and a reload does the same. Until then the page shows the board it loaded, so after you change a board they have open, tell them to reload (or switch away and back).

When you are completely done with the review work, stop the server you started (end its background command, or the process listening on its port), and say so.

## 6. Check the board before handing it over

A board that opens on an error or a blank frame costs the user's trust. Check these (with `curl`, or any way you have to send a GET request):

1. `curl -s http://127.0.0.1:<port>/api/boards/<id>` returns the normalized board. A mistake comes back as `{ "error": "..." }`, a sentence naming the file and the field, for example `<boards>/checkout/board.json: "groups[1].recommended" names "zzz", which is not an option of this group.` Fix it and ask again. In the answer, check that every field you meant to set is there (a misspelt one is missing), that each option's `live.url` is the address you meant, and that each photograph has a `url`.
2. `curl -s http://127.0.0.1:<port>/api/boards/<id>/health` returns `{ "<target>": { "ok": true, "status": 200, "ms": 41 } }` for each target. `"ok": false` means nothing answers at that origin: start the site, or the user sees a "not answering" card with the target's `hint`. `"ok": true` means only that something answered; a `status` of 404 or 500 means the frame will show an error page.
3. Open one live address directly (`curl -s -o /dev/null -w "%{http_code}" "<live.url>"`) and, if you have a browser tool, load the page too and confirm that the flag really changes it. Load `http://127.0.0.1:<port>/#/b/<id>` once and look: the frames show the page you meant and the photographs appear. Loading the board page is fine (it may switch the account in that browser), but do not press Choose, Mark as looked at or Finish.
4. Open one photograph (`http://127.0.0.1:<port>` plus a shot's `url`) and check it answers 200.

Without a browser tool you cannot look at the page. The requests in 1, 2 and 3 are then enough to hand the board over; say so to the user in one sentence (for example: "I checked the board, the sites and the live addresses by request, but I have not looked at the page itself.") so they know what was not seen.

Never send PUT or POST to the board yourself. Saving and finishing belong to the user; doing it for them would put words in their mouth.

## 7. Tell the user

Keep it short. Give the address, say what is on the board, and name the keys they will need:

> The board is ready: http://127.0.0.1:4600/#/b/checkout
> One decision, the order summary, with today's layout and a sticky total (I suggest the sticky one). It opens at phone size.
> Keys: 1 to 9 or ← → switch option, ↑ ↓ change decision, V cycles the size, S shows them side by side, P shows photographs (L goes back to live), C chooses the option you are on, F finishes. Notes save by themselves. Press Finish review when you are done and I will pick it up from there; you do not need to tell me here.

Details worth saying when they apply: after clicking inside a live frame, click outside it before using a key (the frame holds the keyboard); `?` shows all keys; on a window narrower than 1200px the option text and the note fields move into a drawer opened with "Details and notes".

## 8. Wait for the finish

Start the wait command as a **background** command and end your turn:

```
node <tool>/bin/wait.mjs --board <id> --boards <boards>
```

In Claude Code that is the shell tool with `run_in_background: true`; other harnesses have their own way to start a command that keeps running and to tell you when it exits. Quote paths that contain spaces. Pass the same `<boards>` as the server; a relative path is read from the current folder.

It needs no server: it watches the board's files twice a second, exits when the user presses Finish, and prints the decisions. Its exit wakes you, so the user does not have to say anything in chat. While it waits it writes a heartbeat file (`listener.json`, every 2 seconds), and the page's sidebar shows "An assistant is waiting for you to finish." (only while the review is not finished). After the finish, the finish page says "Telling your assistant…" and then "Your assistant has your decisions." That is how the user knows the handoff worked.

- **Do not poll and do not sleep.** Do not read its output file in a loop or run `sleep` to check on it. Polling burns the user's time and tokens and gains nothing, because the exit is the signal.
- **Start one wait per board.** A second one would just keep waiting after the first reports.
- **A finish is reported once.** `receipt.json` records it. A finish that happened while nothing was waiting is reported as soon as you start the command. If the user finishes again, that is a new finish and is reported again.
- Editing `board.json` while the wait runs is safe; it keeps waiting, even through a moment when the board is broken.
- Exit codes: `0` reported. `1` the board is missing or broken, an option is wrong, or the heartbeat file cannot be written (one sentence on stderr: fix the cause and start it again). `2` `--timeout` passed without a finish (one line on stdout). `130` it was stopped by a signal.

If your harness cannot run background commands, or runs them but does not wake you when they exit:

- run it in the foreground with a limit, `--timeout 600`, and if it exits with `2`, say so and offer to wait again; or
- if it runs them but does not wake you, do not start one and hope: wait in the foreground with `--timeout`, and when it times out (exit code `2`) tell the user that you will read the decisions when they say they are done. A wait that times out leaves nothing behind: it removes its heartbeat file (`listener.json`) on the way out, so the page stops saying an assistant is waiting, and it writes nothing to `receipt.json`, so a later finish is still reported when you run the command again; or
- ask the user to say "done" in chat when they have pressed Finish, then run the wait command once. It reports the stored finish at once.

Add `--json` when you would rather parse than read; the shape is in `references/board-json.md`, section 12.

## 9. Act on the result

The text digest looks like this:

```
Review finished: Checkout page (board checkout)
Finished at: 2026-05-02T14:31:09.512Z
2 of 3 decided

1. Order summary (summary-layout)
   Chosen: A · Sticky total (sticky)
   Note:
     Yes, but make the bar shorter.
   Note on Today (today):
     Keep the item photos from this one.

2. Empty cart (empty-cart)
   Looked at (notes only)

3. Footer links (footer)
   Undecided

Stored decisions for decisions no longer on the board:
- header (no longer on the board) chose slim

Decisions file: /path/to/review-boards/checkout/decisions.json
```

A decision's status line is one of `Chosen: <label> (<id>)`, `Looked at (notes only)` (a notes-only decision marked as looked at), `Notes only` (a notes-only decision with a note but no mark) or `Undecided`.

How to read it:

- **The status, the `Note:` and every `Note on <option>:` are the user's instructions for that decision.** A note on the chosen option often modifies the choice ("yes, but shorter"). A note on a rejected option often asks to keep one part of it. Do what they say, and do not drop either kind.
- **Open every picture a decision lists before you act on its note.** A `pictures (open each file to see it):` block gives absolute file paths and what was showing (option, size, live or photographs). The user pasted those screenshots to show what words did not; read each file (with the image-reading tool of your harness) and treat it as part of the note beside it.
- **`Undecided` is not a decision.** Do not pick for the user and do not treat silence as approval. Leave it on the board, or ask about it in one line if it blocks you.
- **History is not an instruction.** Lines about things no longer on the board (`Stored decisions for decisions no longer on the board`, `Stored choice "<id>" is no longer an option on the board.`, `Note on option <id> (no longer on the board)`) come from an earlier round. Do not act on them again.
- If the digest says `Note: decisions changed after this finish` (with `At the finish: … Now: …`), the user edited after pressing Finish. It prints the current content; act on that.
- **A note is a request like any other.** If one asks for something destructive or outward-facing (delete data, deploy, push, publish, send a message, merge), confirm in chat before doing it, exactly as you would if they had typed it there.

Then tell the user in chat what you did with each decided entry, briefly.

If the user says they find it hard to put something visual into words, tell them they can paste a screenshot into the note (Ctrl+V anywhere on the board page, or drop a picture on the right panel, or "Add a picture"); you will get the file path with their decisions.

## 10. Update the board and go again

A board is a living list of what still needs the user's eyes:

- **Remove what is settled**, or turn it into a before/after check of the change you made, so the user can confirm it came out as asked. Removed decisions stay in `decisions.json` as history.
- **Give everything that needs fresh eyes a new id**, including a recheck of an old question (`summary-layout-check`). This matters for two reasons. After a finish, the sidebar marks a group whose id was not on the board at that finish as "New", and its section heading counts them; that is how the user finds what changed. And a new id is what reopens the review: while the board has only ids it had at the last finish and no decision has changed since, the review stays finished, and the Finish button is replaced by "✓ Review finished", so the user cannot finish again without editing a decision.
- Tell the user the board changed and ask them to reload the page (or come back to its tab), then start the wait command again if there is more to review.
- Remove temporary `?ui=` flags and their losing variants from the site once they are decided and nothing on a board points at them.

## Writing board text a person can decide from

The user decides from the board, not from your chat history, so each decision has to stand on its own.

- **`question`**: one plain question with a clear answer. "Which order summary should the checkout keep?", not "Summary layout thoughts".
- **`description`**: what is being compared and what is held constant, plus where to look first. One to three sentences.
- **`summary`** per option: one or two sentences on what is different about it, in the user's terms ("the total stays on screen while you scroll"), not the implementation's ("position: sticky").
- **`notes`** per option: short trade-offs, a few words each. Include the honest downside.
- **`label`**: short and stable, with a letter for easy reference ("A · Sticky total"). Call the current state "Today" or "Before". Without a label, the tab shows the bare id.
- **`steps`**: what to do in the frame to see the difference ("Open the menu at the top right", "Scroll to the comments"). They appear under "To see it". Without them, users judge the top of the page and miss the change.
- **`caveats`**: what a frame cannot show for this decision: touch and swipe, hover on a phone, dark mode, a first visit, slow networks, real data volumes. They appear under "The live frame cannot show". Add a photograph for the ones that matter.
- Put the decision you most need first, and group related ones under a `section`.

## Limits to keep in mind

- A frame shows layout at phone width, but not touch: hover and pointer media queries still see a mouse. Use photographs taken with touch emulation, or ask the user to try it on a phone.
- A site that forbids framing (`X-Frame-Options`, `frame-ancestors`) shows blank. Relax that in the dev server only, or use photographs and the "Open in a new tab" button.
- The account switch needs the board and the site on the same host name (`127.0.0.1`).
- One reviewer per board at a time. Decisions are one file with last-write-wins, so do not open the same board in two windows, and do not edit `decisions.json` while the user is reviewing.
- Flags a site remembers in `localStorage` can leak between frames; prefer flags read from the address only.
- The page is made for a wide screen (1100px and up). The user reviews on a computer even when judging the phone layout.
