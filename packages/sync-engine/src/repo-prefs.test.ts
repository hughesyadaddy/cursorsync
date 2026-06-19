import { describe, it, expect } from "vitest";
import {
  repoEnabled,
  autoSyncNew,
  isConversationKey,
  DEFAULT_PREF_KEY,
  NO_REPO_KEY,
} from "./repo-prefs.js";

describe("repoEnabled", () => {
  it("syncs named repos by default; unlinked chats are off by default", () => {
    const prefs = new Map<string, boolean>();
    expect(repoEnabled("github.com/me/app", prefs)).toBe(true);
    expect(repoEnabled(null, prefs)).toBe(false); // unlinked = opt-in
  });

  it("honors an explicit per-repo pref over the default", () => {
    const prefs = new Map([
      [DEFAULT_PREF_KEY, false],
      ["github.com/me/app", true],
    ]);
    expect(repoEnabled("github.com/me/app", prefs)).toBe(true); // explicitly on
    expect(repoEnabled("github.com/me/secret", prefs)).toBe(false); // falls to default off
  });

  it("treats unlinked chats as opt-in, ignoring the auto-sync-new default", () => {
    expect(repoEnabled(null, new Map())).toBe(false); // off by default
    expect(repoEnabled(null, new Map([[DEFAULT_PREF_KEY, true]]))).toBe(false); // not auto-synced
    expect(repoEnabled(null, new Map([[NO_REPO_KEY, true]]))).toBe(true); // explicit opt-in
  });
});

describe("autoSyncNew", () => {
  it("defaults to true and reflects the '*' pref", () => {
    expect(autoSyncNew(new Map())).toBe(true);
    expect(autoSyncNew(new Map([[DEFAULT_PREF_KEY, false]]))).toBe(false);
  });
});

describe("isConversationKey", () => {
  it("matches composer and bubble keys only", () => {
    expect(isConversationKey("composerData:abc")).toBe(true);
    expect(isConversationKey("bubbleId:abc:1")).toBe(true);
    expect(isConversationKey("agentKv:blob:deadbeef")).toBe(false);
    expect(isConversationKey("checkpointId:x")).toBe(false);
  });
});
