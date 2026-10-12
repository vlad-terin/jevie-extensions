# Jevie extensions

Extensions for [Jevie](https://github.com/vlad-terin/jevie-store), shared from Jevie itself.
Each folder is one extension; each release is a tag (`<id>-v1.2.0`).

## Install one

- In Jevie, type `extensions` and find it, if it is listed in the store; or
- say **install extension git:github.com/vlad-terin/jevie-extensions@<tag>#<id>**; or
- add this whole repository as a source: **add extensions from vlad-terin/jevie-extensions**.
  Its extensions then show in `extensions` next to the store's.

## Cards

`cards/` holds single cards shared from Jevie ("share the last card"):
each file is a card's words and what it showed. The store's page draws one
from its link, and "Open in Jevie" types the words.

## Change one

Say **fork the <name> extension** in Jevie, change it, and say **send my
changes to <name>**: Jevie opens a pull request here.

This repository is kept by Jevie: sharing and releasing commit, tag and
update `store.json`. Edit by hand if you like; keep `store.json` as Jevie
writes it.
