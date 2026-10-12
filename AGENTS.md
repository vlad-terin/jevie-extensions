# For coding agents

This repository holds Jevie extensions, one per folder, released by tags.
Jevie maintains it; work with it the way Jevie does.

- **Layout.** `<id>/jevie-extension.json`, `<id>/index.mjs`, `<id>/README.md`,
  `<id>/CHANGELOG.md`. `store.json` lists each extension at its release tag
  and is written by Jevie: do not edit it by hand.
- **Changing an extension.** Change the files in `<id>/`, raise `version` in
  its manifest, and add a `## <version> - <date>` entry to its CHANGELOG. Do
  not tag and do not push: the person releases it by saying
  "release extension <id>" in Jevie, which tags `<id>-v<version>`, rewrites
  `store.json` and pushes.
- **A new extension.** Write it in `~/.jevie/extensions/<id>/` (not here),
  following the store's guide and API:
  https://github.com/vlad-terin/jevie-store/blob/main/AGENTS.md. The person shares it by
  saying "share extension <id>".
- **Never** put keys, tokens, a person's home path or a workplace's host in
  code. Keys are `password` preferences (kept in the Keychain); hosts that
  differ per person are `text` preferences.
- Checking: `node <jevie>/jevie/kernel/extensions/store.mjs check <id>` when
  Jevie's source is at hand; otherwise Jevie checks it when it is shared.
