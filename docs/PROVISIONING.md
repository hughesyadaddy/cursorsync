# Provisioning (live setup)

cursorsync is wired to a real Supabase project + PowerSync instance. Secrets (URLs, keys, DB
password, access tokens) live only in the gitignored `.env` / `.env.provisioning` — never here.

## Supabase

- Project: **cursorsync** (org "Sea Trials"), region `us-east-1`.
- Schema applied from [`supabase/schema.sql`](../supabase/schema.sql): `cursor_kv`,
  `cursor_workspace_index`, `cursor_blob`, all with RLS (`owner_id = auth.uid()`).
- Logical replication: `wal_level=logical` (default), publication **`powersync`** over the three
  tables (required by PowerSync).
- `SUPABASE_URL` + `SUPABASE_ANON_KEY` are in `.env`.

Apply schema to a fresh project (no psql needed — uses the Management API):

```bash
source .env.provisioning   # SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF
# POST supabase/schema.sql to https://api.supabase.com/v1/projects/<ref>/database/query
```

## PowerSync

- Project **cursorsync**, **Development** instance.
- Source DB connection → Supabase Postgres **direct** connection
  (`db.<ref>.supabase.co:5432`, user `postgres`, SSL `verify-full`). The direct connection (not the
  transaction pooler) is required for logical replication; PowerSync Cloud reaches it over IPv6.
- Sync Streams: [`supabase/powersync-rules.yaml`](../supabase/powersync-rules.yaml) (edition 3).
- Client auth: **Development tokens** enabled for prototyping. For production, switch to
  "Use Supabase Auth" (JWKS) so clients authenticate with their Supabase session JWT.
- `POWERSYNC_URL` is in `.env`.

## Data flow (verified)

```
Cursor state.vscdb ──[cursor-store extractor]──> rows ──[sync-engine transform]──>
  Supabase cursor_kv ──[logical replication]──> PowerSync ──[sync stream]──> client SQLite
  ──[cursor-store applyRows, backup-first]──> Cursor state.vscdb (copy)
```

Up-sync was verified by pushing 175 real chat rows (25 conversations + 150 messages) extracted
from a **read-only backup** of the live Cursor DB into Supabase.

## Safety

A full consistent backup of the live Cursor DB is taken before any write-back
(`~/cursorsync-backups/`, via `VACUUM INTO`). The down-sync writer refuses the live global DB
unless explicitly forced. No local chats are ever at risk.
