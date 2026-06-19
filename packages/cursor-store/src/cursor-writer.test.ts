import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRows } from "./cursor-writer.js";

// Mirrors Cursor's real schema exactly: `key TEXT UNIQUE ON CONFLICT REPLACE`.
const DDL = "CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cursorsync-test-"));
  dbPath = join(dir, "state.vscdb");
  const db = new Database(dbPath);
  db.exec(DDL);
  db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
    "composerData:c1",
    Buffer.from(JSON.stringify({ title: "old" }), "utf8"),
  );
  db.close();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function read(key: string): string {
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?").get(key) as
    | { value: Buffer }
    | undefined;
  db.close();
  return row ? row.value.toString("utf8") : "";
}

describe("applyRows", () => {
  it("inserts new rows and replaces existing keys in place", () => {
    const res = applyRows(dbPath, [
      { key: "composerData:c1", value: JSON.stringify({ title: "new" }) },
      { key: "bubbleId:c1:m1", value: JSON.stringify({ text: "hi" }) },
    ]);

    expect(res.written).toBe(2);
    expect(JSON.parse(read("composerData:c1"))).toEqual({ title: "new" }); // replaced
    expect(JSON.parse(read("bubbleId:c1:m1"))).toEqual({ text: "hi" }); // inserted

    const db = new Database(dbPath, { readonly: true });
    const count = db.prepare("SELECT count(*) AS n FROM cursorDiskKV").get() as { n: number };
    db.close();
    expect(count.n).toBe(2); // replace did not duplicate
  });

  it("creates a backup before writing by default", () => {
    const res = applyRows(dbPath, [{ key: "bubbleId:c1:m2", value: "{}" }]);
    expect(res.backupPath).toBeDefined();
    expect(existsSync(res.backupPath!)).toBe(true);
  });

  it("can skip the backup when asked", () => {
    const res = applyRows(dbPath, [{ key: "bubbleId:c1:m3", value: "{}" }], { backup: false });
    expect(res.backupPath).toBeUndefined();
  });
});
