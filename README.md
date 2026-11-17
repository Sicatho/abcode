# ABCode

ABCode is a local page for comparing visual options and signing off UI changes. It shows a running site in desktop and phone frames alongside photographs, and saves each choice, note, and picture as soon as it changes. An assistant can wait for Finish review and read the decisions directly from disk.

ABCode is primarily designed for people who design through an AI assistant. You say what you want, the assistant builds two or three versions, and you choose by looking at the real thing instead of reading descriptions or scrolling through screenshots in a chat. You can write a board by hand, but the board format, the wait command and the bundled skill are all shaped around an assistant doing that part. See [Using it with an AI assistant](#using-it-with-an-ai-assistant) for Claude Code, Codex, GitHub Copilot and others.

It uses Node 22 or newer, plain browser JavaScript, and no runtime dependencies or build step. Licence: MIT (see [LICENSE](LICENSE)).

**Status:** this project is not being actively updated at the moment. I plan to use it again in the future and will fix issues as I run into them.

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
| `D` | Read a decision's whole description, or fold it again |
| `[`/`]` | Previous / next photograph |
| `Esc` | Close the help, an opened description or a dialog |

Paste, drop, or add a picture beside a decision note. PNG, JPEG, WebP, and GIF are accepted, up to 10 MB each and 12 per decision.

## Wait for a finish

```sh
node bin/wait.mjs --board my-page [--boards ./boards] [--timeout 300] [--json]
abcode-wait --board my-page
```

The command reads board files directly; it needs no server. It waits for a finish, prints the choices, notes, picture paths, and decisions file path, then records that finish in `receipt.json` so it is reported once. A later finish after changes is a new result. `--json` emits one JSON object; `--timeout` exits with code 2 if no finish arrives, while a missing or unreadable board exits with code 1. Without a timeout it waits indefinitely.

## Using it with an AI assistant

ABCode is meant to be driven by an AI coding assistant working on your own machine. The assistant builds the options, writes the board, starts the server, waits for your Finish review, and then acts on what you chose. `skill/abcode` holds the instructions that teach it this: when to offer a visual comparison, how to create a board, and how to read its result. It is a plain `SKILL.md` in the Agent Skills format with two reference files, so any assistant that loads skills can use it, and any assistant that can read a Markdown file can be pointed at it.

Install the skill with:

```sh
node bin/install-skill.mjs                 # ~/.claude/skills/abcode
node bin/install-skill.mjs --dest <folder> # another skill folder
node bin/install-skill.mjs --dry-run       # preview without writing
abcode-install-skill
```

The installer copies the skill and writes `tool-path.txt` with this tool's absolute folder so the assistant can locate its commands. Reinstalling updates the skill files. It removes an older installer-managed `review-board` skill in the same skills folder to prevent duplicate triggers, and leaves unrelated skills alone. Start a new assistant session after installation. The previous command names `review-board`, `review-board-wait`, and `review-board-install-skill` remain aliases.

ABCode was built and is used with Claude Code. The set-ups for the other assistants follow each one's own documentation as of November 2026 and have had less use. If one of them is out of date, the recipe under "Any other assistant" works anywhere.

### Claude Code

```sh
node bin/install-skill.mjs
```

This is the default: a personal skill in `~/.claude/skills/abcode`, available in every project. Claude Code picks it up by itself when a choice needs looking at ("which looks better?", "show me the options", "before and after"), or you can ask for it: "put these on ABCode". It runs the server and the wait command in the background and is woken when you press **Finish review**, so you do not have to go back to the chat to say you are done.

### Codex

```sh
node bin/install-skill.mjs --dest "$HOME/.agents/skills/abcode"
```

Codex (the CLI and the IDE extension) reads personal skills from `~/.agents/skills`. Restart Codex, then run `/skills` or type `$` to pick the skill, or let Codex choose it from its description. Codex runs commands in a sandbox; if the server does not stay up there, start it yourself (see the recommendations below).

### GitHub Copilot

```sh
node bin/install-skill.mjs --dest "$HOME/.copilot/skills/abcode"
```

Copilot CLI reads personal skills from `~/.copilot/skills` and from `~/.agents/skills`, so the Codex install above serves both. `/skills list` shows the skill (`/skills reload` in a session that was already running), and "use the /abcode skill" in a prompt calls it by name. Agent mode in VS Code, Visual Studio, and the JetBrains IDEs also loads skills, depending on the version. If yours does not see personal skills, install into the project with `--dest .github/skills/abcode` and keep that folder out of version control, because its `tool-path.txt` holds a path on your machine. Use an agent that runs on your computer: the cloud agent works on GitHub's servers and cannot show you a page there.

### Any other assistant

Cursor, Gemini CLI, Windsurf, and the rest: if the assistant loads Agent Skills, install into its skills folder with `--dest`. If it does not, add two lines to the file it reads its instructions from (`AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`, a Cursor rule), using the folder you cloned ABCode into:

```md
When I have to choose between designs or sign off visual changes, use ABCode instead of screenshots in chat.
Read /path/to/abcode/skill/abcode/SKILL.md and follow it. The tool is in /path/to/abcode.
```

### Recommendations, whichever you use

- **Ask for real options.** "Build both versions behind a URL flag and put them on ABCode" gets you the running site in each version. Two or three options per decision is plenty. Photographs are for states a frame cannot show.
- **Keep boards in your project** (for example `review-boards/`), not in this tool's folder, and pass the same `--boards` folder to the server and the wait command. The skill tells the assistant to do this and which files to keep out of Git.
- **If the assistant cannot keep a server running** (a sandbox, or no background commands), start it yourself and leave the terminal open: `node server.mjs --boards <your boards folder>`. The assistant then only writes board files and reads decisions, which needs no more than file access.
- **If the assistant is not woken when you finish**, press Finish review and then tell it "done". The finish is stored, and the wait command reports it at once.
- **Use local test accounts only** for one-click accounts, never a real person's session, and keep the page on `127.0.0.1`.
- **Tidy up after choosing.** Ask the assistant to remove the variants you turned down and the temporary flag.

## Limits

- A phone-size frame still receives mouse behavior; it cannot reproduce touch behavior. A site that disallows framing may appear blank; use its open-in-new-tab link or photographs.
- Frames from different origins cannot share a scroll position. A live frame holds keyboard focus after you click inside it; click outside for ABCode keys.
- Account switching uses local test cookies and requires the board and the site to share a host name, normally `127.0.0.1`.
- Reviews use one decisions file per board with last-write-wins behavior; avoid reviewing the same board in two windows at once.
- The page is designed for wide screens; below 1200px the details panel becomes a drawer.

Run `node --test test/*.test.mjs` to check the tool.
