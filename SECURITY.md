# Security model

Cursor Sync stores your chat history in a Supabase project: structured rows in the Postgres
table `cursor_kv`, and large/binary values in the private Storage bucket `cursor-blobs`. The
guarantee is simple: **only you can read or write your own data.** This document explains how
that is enforced and how to re-verify it.

## Identity

- Sign-in is GitHub OAuth via Supabase Auth. Sessions are JWTs signed with **ES256** (asymmetric
  signing keys), validated by the database on every request.
- The extension ships only the **anon public key**. That key is, by design, safe to publish — it
  grants no data access on its own (see below). The `service_role` key is never in the client,
  the bundle, or the repo.

## Local database safety

- Cursor's live `state.vscdb` is only ever opened **read-only** for syncing.
- Writes (pulling chats from another device) go through an atomic transaction and append to a
  capped **undo journal**, so a pull can always be reversed and local chats are never lost.

## Enforcement (every layer is default-deny)

### Table `cursor_kv`

- Row Level Security is **enabled and FORCED** (`force row level security`), so the policy applies
  even to the table owner — there is no role that silently bypasses it.
- The single policy is scoped to the `authenticated` role and requires `owner_id = auth.uid()` for
  **both** reads (`using`) and writes (`with check`). You cannot read another user's rows, cannot
  insert rows owned by someone else, and cannot change a row's `owner_id`.
- The `anon` role has had **all privileges revoked**, so an unauthenticated request is rejected at
  the grant layer (HTTP 401, `42501`) before RLS is even evaluated.

### Bucket `cursor-blobs`

- The bucket is **private** (no public CDN URLs).
- Objects live at `{owner_id}/{sha256}`. Storage policies (authenticated only) allow `select` and
  `insert` **only** where the first path segment equals `auth.uid()`. You cannot read, list, or
  upload into another user's folder.
- There are no `update`/`delete` policies, so content-addressed blobs are effectively immutable via
  the API — one user can never overwrite or delete another's blobs.

## Adversarial verification

These guarantees are not just asserted — they are tested by spinning up a second, real
authenticated user ("Mallory") and confirming she cannot breach the first user's data from any
angle, plus a positive control proving the API still works for legitimate access:

| Attack (as a second signed-in user)            | Result                          |
| ---------------------------------------------- | ------------------------------- |
| Read all of another user's rows                | empty                           |
| Filter rows by the victim's `owner_id`         | empty                           |
| Fetch the victim's exact row by primary key    | empty                           |
| Insert a row owned by the victim               | rejected (RLS `with check`)     |
| Download / list the victim's blobs             | denied                          |
| Read/write her **own** rows (positive control) | allowed                         |
| Anything with the anon key only                | denied at the grant layer (401) |

All checks pass. To re-run the audit, inspect `pg_policies` and `pg_class.relforcerowsecurity` for
`cursor_kv` / `storage.objects`, then exercise the REST and Storage endpoints with a throwaway
second account as above. The authoritative policy definitions live in
[`supabase/schema.sql`](supabase/schema.sql).

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private
[Security Advisories](https://github.com/lokeylabs/cursorsync/security/advisories/new) instead.
We aim to acknowledge within 72 hours. Include the affected version/commit, reproduction steps,
and impact assessment.
