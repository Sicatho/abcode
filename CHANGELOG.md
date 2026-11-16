# Changelog

## Unreleased

- A target can name what its frames may use (`allow`, for example `"translator; language-detector"`): it becomes the frames' `allow` attribute, so a site on another port can use browser features that are kept from other origins by default.
- In the photographs view an option that has no photograph of the chosen state shows its first photograph and says so, instead of an empty box.
- Renamed the tool and skill to ABCode, with the previous CLI commands retained as aliases.
- Added cleanup of older installer-managed skills and ignored reviewer pictures under `boards/`.
- The README says who the tool is for (people who design through an AI assistant) and how to set it up with Claude Code, Codex, GitHub Copilot, and other assistants.

## 2026-11-11

- Added picture attachments to decisions and the wait command's digest (`a74066a`, merged in `4675736`).
- Corrected page scrolling when a board has many decisions (`ddeec0a`).
- Introduced the local visual review page and file-based decisions (`92610d7`).
