-- cursorsync Supabase (Postgres) schema
-- Hub of truth for Cursor chat rows. PowerSync streams these to/from each device's local SQLite.
--
-- Design notes:
--  * Primary key is the raw Cursor key, so upserts are a conflict-free row-level union merge.
--  * `value` holds JSON namespaces (bubbleId, composerData) as text/jsonb.
--  * Binary, content-addressed agentKv blobs live in a separate table (phase 2) since they are
--    immutable and often non-JSON; stored base64 because PowerSync client columns are text/num.

create table if not exists cursor_kv (
  key         text primary key,            -- e.g. 'bubbleId:{composerId}:{messageId}'
  namespace   text not null,               -- 'bubbleId' | 'composerData'
  composer_id text,                         -- conversation id (grouping key)
  message_id  text,                         -- only for bubbleId rows
  value       jsonb not null,               -- the message / conversation object
  git_remote  text,                         -- repo identity for cross-machine path matching
  device_id   text not null,               -- last writer (tie-break / audit)
  owner_id    uuid not null default auth.uid(),
  updated_at  timestamptz not null default now()
);

create index if not exists cursor_kv_owner_idx     on cursor_kv (owner_id);
create index if not exists cursor_kv_composer_idx  on cursor_kv (owner_id, composer_id);
create index if not exists cursor_kv_namespace_idx on cursor_kv (owner_id, namespace);

-- Per-workspace sidebar index: which conversations belong to which repo/workspace.
create table if not exists cursor_workspace_index (
  workspace_key text primary key,           -- stable hash of git_remote (machine-independent)
  git_remote    text,
  composer_ids  jsonb not null default '[]'::jsonb,
  owner_id      uuid not null default auth.uid(),
  updated_at    timestamptz not null default now()
);

-- Phase 2: content-addressed agent blobs (immutable, base64 of raw bytes).
create table if not exists cursor_blob (
  sha256     text primary key,              -- = agentKv:blob:{sha256}
  is_binary  boolean not null,
  value_b64  text not null,                 -- base64 of raw value bytes
  owner_id   uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

-- Row Level Security: each user only sees their own rows.
alter table cursor_kv              enable row level security;
alter table cursor_workspace_index enable row level security;
alter table cursor_blob            enable row level security;

create policy "own rows" on cursor_kv
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own rows" on cursor_workspace_index
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own rows" on cursor_blob
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
