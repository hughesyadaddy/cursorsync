import type * as vscode from "vscode";
import {
  openReadonly,
  defaultGlobalDbPath,
  detectChanges,
  buildComposerRepoMap,
  repoForKey,
  applyRows,
  emptyState,
  type DetectorState,
  type WriteRow,
} from "@cursorsync/cursor-store";
import { toKvRecord, fromKvRecord, type KvRecord } from "@cursorsync/sync-engine";
import type { Transport } from "./transport.js";
import type { SyncScope } from "./config.js";

const WATERMARK_KEY = "cursorsync.watermark";

export interface UpResult {
  pushed: number;
  scanned: number;
}

/**
 * Orchestrates sync between Cursor's local state.vscdb and the Supabase hub.
 *
 * Up: detect changed rows (per-source rowid watermark) → tag with repo → push. In "repo" scope,
 * only the current repo's conversation rows are pushed.
 * Down: decode records → upsert into the live state.vscdb (atomic transaction; REPLACE semantics).
 * Cursor surfaces newly-written chats after a restart.
 */
export class SyncBridge {
  constructor(
    private ctx: vscode.ExtensionContext,
    private transport: Transport,
    private deviceId: string,
  ) {}

  private getWatermark(): DetectorState {
    return this.ctx.globalState.get<DetectorState>(WATERMARK_KEY) ?? emptyState();
  }
  private async setWatermark(s: DetectorState): Promise<void> {
    await this.ctx.globalState.update(WATERMARK_KEY, s);
  }

  /** Push changed local rows to the cloud. */
  async upSync(ownerId: string, scope: SyncScope, currentRepo: string | null): Promise<UpResult> {
    const db = openReadonly();
    try {
      const { changed, next } = detectChanges(db, this.getWatermark());
      const composerRepo = scope === "repo" ? buildComposerRepoMap(db) : new Map<string, string>();

      const records: KvRecord[] = [];
      for (const row of changed) {
        const repo = repoForKey(row.key, composerRepo);
        if (scope === "repo" && repo !== currentRepo) continue; // isolate to this repo
        records.push(toKvRecord(row, ownerId, this.deviceId, repo));
      }

      const pushed = await this.transport.push(records);
      await this.setWatermark(next); // only advance after a successful push
      return { pushed, scanned: changed.length };
    } finally {
      db.close();
    }
  }

  /** Reset the watermark so the next upSync re-scans and pushes everything. */
  async resetWatermark(): Promise<void> {
    await this.setWatermark(emptyState());
  }

  /** Write decoded records into the live Cursor DB (one atomic transaction). */
  applyRecords(records: Array<Pick<KvRecord, "source" | "ckey" | "is_binary" | "value">>): number {
    const rows: WriteRow[] = records.map(fromKvRecord);
    const { written } = applyRows(defaultGlobalDbPath(), rows, {
      backup: false, // a full 27GB copy per write is ruinous; rely on the one-time safety backup
      allowLiveGlobalDb: true,
    });
    return written;
  }

  /** Pull all of the user's rows (optionally one repo) and apply them locally. */
  async pullAndApply(scope: SyncScope, currentRepo: string | null): Promise<number> {
    const records = await this.transport.pullAll(scope === "repo" ? currentRepo : undefined);
    if (records.length === 0) return 0;
    return this.applyRecords(records);
  }
}
