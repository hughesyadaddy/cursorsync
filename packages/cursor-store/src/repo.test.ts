import { describe, it, expect } from "vitest";
import { normalizeRemote, composerMeta, folderForComposer } from "./repo.js";

describe("normalizeRemote", () => {
  it("normalizes all remote forms of the same repo to one identity", () => {
    const want = "github.com/owner/repo";
    expect(normalizeRemote("git@github.com:Owner/Repo.git")).toBe(want);
    expect(normalizeRemote("https://github.com/Owner/Repo")).toBe(want);
    expect(normalizeRemote("https://github.com/Owner/Repo.git")).toBe(want);
    expect(normalizeRemote("ssh://git@github.com/Owner/Repo.git")).toBe(want);
    expect(normalizeRemote("https://user@github.com/Owner/Repo.git")).toBe(want);
  });

  it("distinguishes different repos", () => {
    expect(normalizeRemote("git@github.com:a/b.git")).not.toBe(
      normalizeRemote("git@github.com:a/c.git"),
    );
  });
});

describe("composerMeta", () => {
  it("extracts workspace path and message count", () => {
    const v = JSON.stringify({
      workspaceIdentifier: { uri: { fsPath: "/Users/x/proj" } },
      fullConversationHeadersOnly: [1, 2, 3],
    });
    const meta = composerMeta(v);
    expect(meta.fsPath).toBe("/Users/x/proj");
    expect(meta.messageCount).toBe(3);
    expect(composerMeta(Buffer.from(v)).fsPath).toBe("/Users/x/proj");
  });

  it("flags empty stubs (0 messages) and handles bad input", () => {
    expect(composerMeta(JSON.stringify({ other: 1 })).messageCount).toBe(0);
    expect(composerMeta("not json")).toEqual({
      fsPath: null,
      trackedRepoPath: null,
      messageCount: 0,
    });
    expect(composerMeta(null).messageCount).toBe(0);
  });

  it("picks the most-recently-interacted tracked git repo as fallback", () => {
    const v = JSON.stringify({
      fullConversationHeadersOnly: [1],
      trackedGitRepos: [
        { repoPath: "/old", branches: [{ lastInteractionAt: 100 }] },
        { repoPath: "/recent", branches: [{ lastInteractionAt: 900 }] },
      ],
    });
    expect(composerMeta(v).trackedRepoPath).toBe("/recent");
  });
});

describe("folderForComposer", () => {
  it("prefers the recorded workspace, else the tracked repo, else null", () => {
    expect(folderForComposer({ fsPath: "/ws", trackedRepoPath: "/git", messageCount: 1 })).toBe(
      "/ws",
    );
    expect(folderForComposer({ fsPath: null, trackedRepoPath: "/git", messageCount: 1 })).toBe(
      "/git",
    );
    expect(folderForComposer({ fsPath: null, trackedRepoPath: null, messageCount: 1 })).toBeNull();
  });
});
