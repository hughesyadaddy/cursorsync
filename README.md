# cursorsync

Local-first, real-time sync of [Cursor](https://cursor.com) AI chat history across all your
machines — built on [PowerSync](https://powersync.com) + [Supabase](https://supabase.com).

Cursor stores every conversation in a local SQLite database (`state.vscdb`) and has **no
native cross-device sync**. cursorsync bridges each machine's local Cursor database to a shared
Supabase Postgres hub via PowerSync, so you can work locally and offline on every device and
have your chats converge automatically — with no central host to stay connected to and no data
loss under simultaneous use.

> Status: **early build**. Read-only extraction is implemented and validated. Write-back and the
> Cursor extension are in progress. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Why this is hard (and how we solve it)

Cursor's chat lives in one opaque SQLite blob with **no merge semantics**. Naively syncing the
file (Dropbox/Syncthing) corrupts it (last-writer-wins on a binary DB). Cursor exposes no API to
stream chat changes, so no extension can sync it "natively."

cursorsync sidesteps both problems:

- **Row-level union merge, not file merge.** Each chat message is a row with a globally-unique
  key (`bubbleId:{composerId}:{messageId}`). We sync _rows_, upserting by key. Distinct keys
  never collide → lossless union even when two machines write at once.
- **PowerSync owns the distributed-systems problem.** Offline, reconnect, conflict-free
  convergence, and "machines need not be online simultaneously" all come from PowerSync's bucket
  sync. We only write the thin adapter between Cursor's SQLite and PowerSync's SQLite.

```
Cursor state.vscdb  <->  [cursorsync bridge]  <->  PowerSync local SQLite
                                                        |
                                                  PowerSync service
                                                        |
                                                  Supabase Postgres  (hub of truth + backup)
```

## What we sync

**Everything Cursor stores.** Cursor keeps all state as key/value rows in two SQLite tables of its
global `state.vscdb` (`cursorDiskKV` + `ItemTable`) — messages (`bubbleId`), conversations
(`composerData`), agent traces (`agentKv`, often binary), checkpoints, and UI state. cursorsync syncs
every row generically: values that are valid UTF-8 (JSON) are stored as text, everything else is
base64-encoded. Sync can be scoped to **all chats** or **just the current repo** (matched by git
remote, via each conversation's embedded `workspaceIdentifier`).

## Repository layout

A pnpm workspace monorepo with strict separation of concerns:

```
packages/
  cursor-store/   Pure adapter for Cursor's state.vscdb — read/write + delta detection. No app deps.
  sync-engine/    Transform, config, and PowerSync/Supabase transport (orchestration).
  extension/      The Cursor / VS Code extension that hosts the bridge loop.
examples/         Runnable read-only probes/demos against a local Cursor DB.
supabase/         Postgres schema + PowerSync sync rules.
docs/             Architecture and design notes.
```

`cursor-store` is the only package allowed to touch SQLite and stays free of app/transport
dependencies; everything network- or config-related lives in `sync-engine`. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Development

```bash
pnpm install
pnpm build && pnpm lint && pnpm typecheck && pnpm test
pnpm probe          # read-only footprint of your own Cursor DB
```

Requires Node ≥ 20 ([`.nvmrc`](.nvmrc)) and pnpm ≥ 9.

## The extension

The [`cursorsync` extension](packages/extension/README.md) is the product: a sidebar panel with
GitHub sign-in, an all-vs-repo scope toggle, "Sync all chats" / "Pull" buttons, live status, and an
in-product safety backup. It packages to a `.vsix` (esbuild bundle + `better-sqlite3` rebuilt for
Cursor's Electron ABI).

## Roadmap

- [x] Read-only extractor + per-source rowid delta detection (validated on a real 27 GB DB)
- [x] All-namespace generic sync (messages, conversations, agentKv, checkpoints, UI state)
- [x] Repo-scoping (sync all chats or isolate to the current repo, by git remote)
- [x] Live Supabase backend (schema + RLS) and PowerSync instance
- [x] Bridge: up-sync + down-sync with backup-first safe writes
- [x] Extension app (GitHub OAuth, panel UI, auto-sync) + `.vsix` packaging
- [ ] Enable the GitHub auth provider in Supabase (needs the OAuth client secret)
- [ ] Publish to the VS Code / Cursor extension marketplace

## License

MIT — see [LICENSE](LICENSE).
