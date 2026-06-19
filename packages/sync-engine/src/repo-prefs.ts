/**
 * Per-repo sync preferences. The user picks which repos sync; the choice is stored in the
 * `repo_prefs` table (owner-scoped) so it is consistent across devices.
 *
 * The prefs map is keyed by repo id, with two reserved keys:
 *   - DEFAULT_PREF_KEY ("*")  — the default applied to any repo without an explicit pref
 *                               (i.e. the "auto-sync newly seen repos" switch).
 *   - NO_REPO_KEY ("")        — the bucket for conversations not tied to a git repo.
 */
export const DEFAULT_PREF_KEY = "*";
export const NO_REPO_KEY = "";

/** Conversations (and their messages) carry a repo; other namespaces (agent traces, snapshots,
 *  UI state) do not and are governed by the namespace policy, not the per-repo allowlist. */
export function isConversationKey(key: string): boolean {
  return key.startsWith("composerData:") || key.startsWith("bubbleId:");
}

/**
 * Whether a repo's chats should sync. Precedence: an explicit pref for the repo, then the "*"
 * default (auto-sync new), then `true` (sync named repos until told otherwise).
 *
 * Exception: "unlinked" chats (no detectable repo — the NO_REPO_KEY bucket) are **opt-in**. They
 * carry no project context, so they default OFF and ignore the auto-sync-new default; the user must
 * explicitly enable them.
 */
export function repoEnabled(repo: string | null, prefs: Map<string, boolean>): boolean {
  const key = repo ?? NO_REPO_KEY;
  const explicit = prefs.get(key);
  if (explicit !== undefined) return explicit;
  if (key === NO_REPO_KEY) return false; // unlinked chats are opt-in only
  const fallback = prefs.get(DEFAULT_PREF_KEY);
  return fallback !== undefined ? fallback : true;
}

/** The "auto-sync newly seen repos" default (the "*" pref); true when never set. */
export function autoSyncNew(prefs: Map<string, boolean>): boolean {
  return prefs.get(DEFAULT_PREF_KEY) ?? true;
}
