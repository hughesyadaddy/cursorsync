import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import type { KvRecord } from "@cursorsync/sync-engine";

/**
 * Sync transport over the shared Supabase hub. Push is a PostgREST upsert keyed on `id` (the
 * deterministic `${owner}:${source}:${key}`), giving conflict-free union merge. Pull is an initial
 * paginated select plus a Realtime subscription for live changes. RLS confines everything to the
 * signed-in user. (PowerSync replicates the same table for offline-first / native clients.)
 */
export class Transport {
  constructor(private client: SupabaseClient) {}

  /** Upsert records in batches. Returns the number written. */
  async push(records: KvRecord[], batchSize = 500): Promise<number> {
    let written = 0;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await this.client
        .from("cursor_kv")
        .upsert(batch, { onConflict: "id", ignoreDuplicates: false });
      if (error) throw new Error(`push failed: ${error.message}`);
      written += batch.length;
    }
    return written;
  }

  /** Fetch all rows for the user, optionally filtered to one repo, paginated. */
  async pullAll(repo?: string | null): Promise<KvRecord[]> {
    const out: KvRecord[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      let q = this.client
        .from("cursor_kv")
        .select("id,owner_id,source,ckey,is_binary,value,repo,device_id")
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (repo) q = q.eq("repo", repo);
      const { data, error } = await q;
      if (error) throw new Error(`pull failed: ${error.message}`);
      if (!data || data.length === 0) break;
      out.push(...(data as KvRecord[]));
      if (data.length < pageSize) break;
    }
    return out;
  }

  /** Subscribe to live row changes for this user. Returns the channel (call .unsubscribe()). */
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
