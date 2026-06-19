import { execFileSync } from "node:child_process";
import type Database from "better-sqlite3";

/**
 * Repo-scoping: which conversation belongs to which repository.
 *
 * Every `composerData` value embeds `workspaceIdentifier.uri.fsPath` — the local folder the
 * conversation belongs to. We resolve that folder to a STABLE repo id (its git remote URL,
 * normalized) so the same repo's chats line up across machines even when local paths differ.
 * Conversations with no resolvable repo (no folder / no git remote) get a path-based fallback id.
 */

function asJson(value: Buffer | string | null): Record<string, unknown> | null {
  if (value === null) return null;
  try {
    return JSON.parse(typeof value === "string" ? value : value.toString("utf8"));
  } catch {
    return null;
  }
}

/** Pull the workspace folder path out of a composerData value, if present. */
export function workspacePathOf(composerValue: Buffer | string | null): string | null {
  const obj = asJson(composerValue);
  const wi = obj?.["workspaceIdentifier"] as { uri?: { fsPath?: string } } | undefined;
  return wi?.uri?.fsPath ?? null;
}

/**
 * Normalize a git remote URL into a stable, host/owner/name identity:
 *   git@github.com:Owner/Repo.git  ->  github.com/owner/repo
 *   https://github.com/Owner/Repo  ->  github.com/owner/repo
 */
export function normalizeRemote(url: string): string {
  let s = url.trim().replace(/\.git$/i, "");
  s = s.replace(/^git@([^:]+):/i, "$1/"); // scp-style ssh
  s = s.replace(/^[a-z]+:\/\//i, ""); // strip scheme
  s = s.replace(/^[^@/]+@/, ""); // strip user@
  return s.toLowerCase();
}

const remoteCache = new Map<string, string | null>();

/** Resolve a folder path to a stable repo id (normalized git remote, else `path:<folder>`). */
export function repoIdForPath(folderPath: string): string {
  if (!remoteCache.has(folderPath)) {
    let remote: string | null = null;
    try {
      remote = execFileSync("git", ["-C", folderPath, "remote", "get-url", "origin"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 3000,
      }).trim();
    } catch {
      remote = null;
    }
    remoteCache.set(folderPath, remote ? normalizeRemote(remote) : null);
  }
  const remote = remoteCache.get(folderPath) ?? null;
  return remote ?? `path:${folderPath}`;
}

/** Build composerId -> repo id by scanning every composerData row in the DB. */
export function buildComposerRepoMap(db: Database.Database): Map<string, string> {
  const map = new Map<string, string>();
  const stmt = db.prepare(
    "SELECT key, value FROM cursorDiskKV WHERE key >= 'composerData:' AND key < 'composerData:~' AND value IS NOT NULL",
  );
  for (const r of stmt.iterate() as IterableIterator<{ key: string; value: Buffer | string }>) {
    const composerId = r.key.split(":")[1];
    if (!composerId) continue;
    const path = workspacePathOf(r.value);
    if (path) map.set(composerId, repoIdForPath(path));
  }
  return map;
}

/** The repo id for a raw Cursor key, using a composerId->repo map. null for non-conversation rows. */
export function repoForKey(key: string, composerRepo: Map<string, string>): string | null {
  if (key.startsWith("bubbleId:") || key.startsWith("composerData:")) {
    return composerRepo.get(key.split(":")[1] ?? "") ?? null;
  }
  return null; // agentKv blobs, checkpoints, UI state — not conversation-scoped
}
