# ABCode

ABCode is a local page for comparing visual options and signing off UI changes. It shows a running site in desktop and phone frames alongside photographs, and saves each choice, note, and picture as soon as it changes. An assistant can wait for Finish review and read the decisions directly from disk.

It uses Node 22 or newer, plain browser JavaScript, and no runtime dependencies or build step. Licence: MIT (see [LICENSE](LICENSE)).

## Start

```sh
node server.mjs                         # http://127.0.0.1:4600/
node server.mjs --port 4611             # choose another port
node server.mjs --boards ./boards        # choose a boards folder
npm start
```

If installed as a command, use `abcode` with the same flags. `--host` defaults to `127.0.0.1`; opening the page to other hosts lets others change decisions. The included `example` board needs no running site: its live target deliberately does not answer, while its drawings show the options. The server reads boards on every request, so edits to `board.json` need no restart.

## Your first board in five minutes

1. Start the site you want to compare at `http://127.0.0.1:5180` (or change the origin below).
2. Create `boards/my-page/board.json` with this content:

   ```json
   {
     "title": "My page",
     "targets": {
       "local": { "label": "Local site", "origin": "http://127.0.0.1:5180", "hint": "Start the local site." }
     },
     "groups": [
       {
         "id": "header",
         "title": "Header",
         "question": "Which header should we keep?",
         "options": [
           { "id": "before", "label": "Before", "live": { "target": "local", "path": "/", "query": { "ui": "" } } },
           { "id": "after", "label": "After", "live": { "target": "local", "path": "/", "query": { "ui": "new-header" } } }
         ]
       }
     ]
   }
   ```

3. Make your site render the two variants for `?ui=` and `?ui=new-header`, then open the ABCode address printed by the server.
4. Choose an option, write a note, and press **Finish review**. Read `boards/my-page/decisions.json` for the result.

A board id is its folder name and uses lowercase letters, digits, and hyphens. Options may have `live`, `shots`, or both; photographs use `assetRoots` and files under the board folder. Boards may also define viewports, sections, steps, caveats, notes-only decisions (`"pick": "none"`), and local test sessions. The complete format and examples are in [the skill reference](skill/abcode/references/board-json.md). Existing `board.json` and `decisions.json` files need no conversion.

The page saves to `decisions.json`, appends changes to `decisions.history.jsonl`, and stores attachments under `pictures/`. Finishing sets `submitted` in the decisions file. The wait command uses `receipt.json` and `listener.json` beside it; those files are ignored by Git under this repo's `boards/` folder. If your boards live in another project, ignore the same per-reviewer files there.

## Keys

Keys work when you are outside a text field and outside a live frame. Press `?` for help on the page.

| Key | Action |
| --- | --- |
| `1`-`9`, Left/Right | Select an option |
| Up/Down, `K`/`J` | Move between decisions |
| `L`/`P` | Live view / photographs |
| `V`, `S` | Cycle sizes / toggle side by side |
| `C` | Choose or clear; mark a notes-only decision looked at |
| `F` | Finish review |
| `R` | Reload live frames |
| `[`/`]` | Previous / next photograph |
| `Esc` | Close the help or a dialog |

Paste, drop, or add a picture beside a decision note. PNG, JPEG, WebP, and GIF are accepted, up to 10 MB each and 12 per decision.

## Wait for a finish

```sh
node bin/wait.mjs --board my-page [--boards ./boards] [--timeout 300] [--json]
abcode-wait --board my-page
```

The command reads board files directly; it needs no server. It waits for a finish, prints the choices, notes, picture paths, and decisions file path, then records that finish in `receipt.json` so it is reported once. A later finish after changes is a new result. `--json` emits one JSON object; `--timeout` exits with code 2 if no finish arrives, while a missing or unreadable board exits with code 1. Without a timeout it waits indefinitely.

## Assistant skill

`skill/abcode` teaches an AI coding assistant when to offer a visual comparison, how to create a board, and how to read its result. Install it with:

```sh
node bin/install-skill.mjs                 # ~/.claude/skills/abcode
node bin/install-skill.mjs --dest <folder> # another skill folder
node bin/install-skill.mjs --dry-run       # preview without writing
abcode-install-skill
```

The installer copies the skill and writes `tool-path.txt` with this tool's absolute folder so the assistant can locate its commands. Reinstalling updates the skill files. It removes an older installer-managed `review-board` skill in the same skills folder to prevent duplicate triggers, and leaves unrelated skills alone. Start a new assistant session after installation. The previous command names `review-board`, `review-board-wait`, and `review-board-install-skill` remain aliases.

## Limits

- A phone-size frame still receives mouse behavior; it cannot reproduce touch behavior. A site that disallows framing may appear blank; use its open-in-new-tab link or photographs.
- Frames from different origins cannot share a scroll position. A live frame holds keyboard focus after you click inside it; click outside for ABCode keys.
- Account switching uses local test cookies and requires the board and the site to share a host name, normally `127.0.0.1`.
- Reviews use one decisions file per board with last-write-wins behavior; avoid reviewing the same board in two windows at once.
- The page is designed for wide screens; below 1200px the details panel becomes a drawer.

Run `node --test test/*.test.mjs` to check the tool.
