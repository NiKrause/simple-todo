# Agent guidance — simple-todo

## This repo is a tutorial; branches are chapters

`simple-todo` is a **tutorial**. Its long-lived git branches are **tutorial
chapters**, not a trunk plus feature branches:

- `main` — base chapter (migrated to the shared `@le-space/playwright` testkit
  + relay-mediated remote-replication E2E).
- `collab01` — multi-database collaboration chapter (mnemonic shared lists,
  entry-protocol-v2, active-orbitdb switching, …).
- `collab02` — follow-on collaboration chapter.
- `fix/collab01-*`, `chore/collab01-*`, … — experiment branches for `collab01`.

These chapters are kept **deliberately separate**. Each teaches a different
stage/topic, so their divergence is intentional.

### Rules

- **Do not merge chapters into each other or into `main`.** No `main → collab01`
  merge, no `collab01 → main` PR. Keeping the chapters distinct is the point.
- **Port improvements surgically, per chapter.** To bring a capability from one
  chapter to another (e.g. the shared testkit or the remote-replication E2E from
  `main`), transplant just the relevant files and **adapt them to that chapter's
  own app code and assertions** — never drag in unrelated commits.
- Ordinary feature/fix work still uses short-lived branches off the relevant
  chapter and merges back into that same chapter.
