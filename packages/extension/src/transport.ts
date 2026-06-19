import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import type { KvRecord } from "@cursorsync/sync-engine";

const BLOB_BUCKET = "cursor-blobs";
const SELECT_COLS = "id,owner_id,source,ckey,is_binary,value,blob_sha,repo,device_id";

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Transient = worth retrying (network blips, throttling, 5xx, gateway). Auth/RLS/validation are not. */
function isTransient(err: unknown): boolean {
  const m = errMessage(err).toLowerCase();
  return /fetch failed|network|econnreset|econnrefused|etimedout|eai_again|socket|timeout|throttl|429|rate limit|too many|5\d\d|bad gateway|gateway time|service unavailable|temporarily unavailable|unavailable/.test(
    m,
  );
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Blob uploads hit Storage hardest during a big first sync, so give them more attempts.
async function withRetry<T>(op: () => Promise<T>, label: string, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || i === attempts - 1) break;
      await delay(250 * 2 ** i);
    }
  }
  throw new Error(`${label} failed: ${errMessage(lastErr)}`);
}

/**
 * Sync transport over the shared Supabase hub. Row metadata + small/inline values go to the
 * `cursor_kv` Postgres table (upsert by deterministic `id` = conflict-free union merge). Large or
 * binary values are content-addressed in the `cursor-blobs` Storage bucket, keyed `{owner}/{sha}`.
 * Every network call retries transient failures with backoff; RLS confines everything to the user.
 */
export class Transport {
  constructor(private client: SupabaseClient) {}

  /** Upsert records in batches. Returns the number written. */
  async push(records: KvRecord[], batchSize = 500): Promise<number> {
    let written = 0;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      await withRetry(async () => {
        const { error } = await this.client
          .from("cursor_kv")
          .upsert(batch, { onConflict: "id", ignoreDuplicates: false });
        if (error) throw new Error(error.message);
      }, "push");
      written += batch.length;
    }
    return written;
  }

  /** Upload a value's bytes to the blob bucket (content-addressed; idempotent — deduped by sha). */
  async uploadBlob(ownerId: string, sha: string, bytes: Buffer): Promise<void> {
    await withRetry(async () => {
      const { error } = await this.client.storage
        .from(BLOB_BUCKET)
        .upload(`${ownerId}/${sha}`, bytes, {
          upsert: false,
          contentType: "application/octet-stream",
        });
      if (error && !/exists|duplicate/i.test(error.message)) throw new Error(error.message);
    }, "uploadBlob");
  }

  /** Download an offloaded value's bytes from the blob bucket. */
  async downloadBlob(ownerId: string, sha: string): Promise<Buffer> {
    return withRetry(async () => {
      const { data, error } = await this.client.storage
        .from(BLOB_BUCKET)
        .download(`${ownerId}/${sha}`);
      if (error || !data) throw new Error(error?.message ?? "blob not found");
      return Buffer.from(await data.arrayBuffer());
    }, "downloadBlob");
  }

  /** Yield the user's rows one keyset page at a time — memory stays bounded. */
  async *pullPages(pageSize = 1000): AsyncGenerator<KvRecord[]> {
    let lastId: string | null = null;
    for (;;) {
      const page = await withRetry(async () => {
        let q = this.client
          .from("cursor_kv")
          .select(SELECT_COLS)
          .order("id", { ascending: true })
          .limit(pageSize);
        if (lastId !== null) q = q.gt("id", lastId);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return (data ?? []) as KvRecord[];
      }, "pull");
      const last = page[page.length - 1];
      if (last === undefined) return;
      yield page;
      lastId = last.id;
      if (page.length < pageSize) return;
    }
  }

  /** Distinct repos with chat-row counts for this user (RLS-scoped). Null repo = no-repo bucket. */
  async repoCounts(): Promise<Array<{ repo: string | null; n: number }>> {
    return withRetry(async () => {
      const { data, error } = await this.client.rpc("repo_counts");
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ repo: string | null; n: number }>;
    }, "repoCounts");
  }

  /** The user's per-repo sync preferences (synced across devices). */
  async getRepoPrefs(): Promise<Array<{ repo: string; enabled: boolean }>> {
    return withRetry(async () => {
      const { data, error } = await this.client.from("repo_prefs").select("repo,enabled");
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ repo: string; enabled: boolean }>;
    }, "getRepoPrefs");
  }

  /** Set one repo's sync preference. */
  async setRepoPref(ownerId: string, repo: string, enabled: boolean): Promise<void> {
    await withRetry(async () => {
      const { error } = await this.client
        .from("repo_prefs")
        .upsert(
          { owner_id: ownerId, repo, enabled, updated_at: new Date().toISOString() },
          { onConflict: "owner_id,repo" },
        );
      if (error) throw new Error(error.message);
    }, "setRepoPref");
  }

  /** Subscribe to live row changes for this user. Returns the channel (call `.unsubscribe()`). */
  subscribe(ownerId: string, onRecord: (rec: KvRecord) => void): RealtimeChannel {
    return this.client
      .channel("cursor_kv_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cursor_kv", filter: `owner_id=eq.${ownerId}` },
        (payload) => {
          const rec = payload.new as KvRecord;
          if (rec && rec.id) onRecord(rec);
        },
      )
      .subscribe();
  }
}
