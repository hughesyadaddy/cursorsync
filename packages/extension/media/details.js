// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("view");

  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  const fmtDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "—");

  function folderRow(path) {
    return `<div class="frow"><span class="fpath truncate" title="${esc(path)}">${esc(path)}</span>
      <button class="btn-sm" data-reveal="${esc(path)}">Reveal in Finder</button></div>`;
  }
  function hintChip(dir) {
    return `<button class="chip" data-reveal="${esc(dir)}" title="Reveal ${esc(dir)}">${esc(dir.split("/").slice(-2).join("/"))}</button>`;
  }

  function whereRow(c) {
    if (c.folder) {
      const status = c.folderExists
        ? `<button class="pill ok" data-reveal="${esc(c.folder)}" title="Reveal in Finder">on disk</button>`
        : `<span class="pill gone" title="This folder no longer exists — the conversation lives only in Cursor's global database">folder deleted</span>`;
      return `<div class="src"><span class="srclabel">from</span><code class="spath truncate" title="${esc(c.folder)}">${esc(c.folder)}</code>${status}</div>`;
    }
    if ((c.hints || []).length) {
      return `<div class="src"><span class="srclabel">no folder · referenced</span>${c.hints.map(hintChip).join("")}</div>`;
    }
    return `<div class="src muted">No project folder — stored only in Cursor's global database.</div>`;
  }

  function convRow(c) {
    return `<div class="crow">
      <div class="cmain"><span class="cname truncate" title="${esc(c.name)}">${esc(c.name)}</span>
        <span class="cmeta">${fmtDate(c.created)} · ${Number(c.msgs).toLocaleString()} msgs</span></div>
      ${whereRow(c)}
    </div>`;
  }

  function render(p) {
    const dbNote = `<p class="dbnote">Every conversation is physically stored in Cursor's global database —
      <button class="dblink" data-reveal="${esc(p.dbPath)}" title="Reveal in Finder">${esc(p.dbPath)}</button>.
      The "from" folder below is the project it was created in; it may since have been moved or deleted.</p>`;
    const folders = p.folders.length
      ? `<div class="section"><h2>Local folder copies (${p.folders.length})</h2>${p.folders.map(folderRow).join("")}</div>`
      : "";
    const convs = `<div class="section"><h2>Conversations (${p.conversations.length}${p.truncated ? "+" : ""})</h2>
      ${p.conversations.map(convRow).join("") || '<p class="muted">No conversations.</p>'}
      ${p.truncated ? '<p class="muted">Showing the 400 most recent.</p>' : ""}</div>`;
    app.innerHTML = `<header><h1>${esc(p.label)}</h1><code class="repoid">${esc(p.repoId || "no repo")}</code>${dbNote}</header>${folders}${convs}`;
  }

  app.addEventListener("click", (e) => {
    const el = e.target instanceof Element ? e.target.closest("[data-reveal]") : null;
    if (el) vscode.postMessage({ type: "reveal", path: el.getAttribute("data-reveal") });
  });
  window.addEventListener("message", (e) => {
    if (e.data && e.data.type === "details") render(e.data.payload);
  });
  vscode.postMessage({ type: "ready" });
})();
