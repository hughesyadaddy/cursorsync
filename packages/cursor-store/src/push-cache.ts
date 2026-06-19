import Database from "better-sqlite3";

/**
 * Local record of what we've already uploaded, keyed by row id → content hash.
 *
 * Cursor bumps a row's rowid on every write — even when the content is identical — so a plain rowid
 * watermark re-pushes unchanged rows. This cache lets up-sync skip a row whose content hash matches
 * what we last sent, which kills the redundant churn and makes a full re-scan / backfill cheap (only
 * genuinely-missing rows upload). It is an optimization, never a source of truth: a miss just means
 * we re-upload (idempotent), so losing this file is harmless.
 */
export class PushCache {
  private readonly db: Database.Database;
  private readonly getStmt: Database.Statement;
  private readonly setStmt: Database.Statement;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec("CREATE TABLE IF NOT EXISTS pushed (id TEXT PRIMARY KEY, h TEXT NOT NULL)");
    this.getStmt = this.db.prepare("SELECT h FROM pushed WHERE id = ?");
    this.setStmt = this.db.prepare(
      "INSERT INTO pushed (id, h) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET h = excluded.h",
    );
  }

  /** True when this id's content hash matches what we last uploaded (so the row can be skipped). */
  unchanged(id: string, hash: string): boolean {
    const row = this.getStmt.get(id) as { h: string } | undefined;
    return row?.h === hash;
  }

  /** Record ids as uploaded at the given content hashes, in one transaction. */
  mark(entries: ReadonlyArray<{ id: string; hash: string }>): void {
    const tx = this.db.transaction((es: ReadonlyArray<{ id: string; hash: string }>) => {
      for (const e of es) this.setStmt.run(e.id, e.hash);
    });
    tx(entries);
  }

  close(): void {
    this.db.close();
  }
}
