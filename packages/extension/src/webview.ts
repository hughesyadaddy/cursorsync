import type * as vscode from "vscode";
import type { AuthUser } from "./auth.js";
import type { SyncScope } from "./config.js";

export interface PanelState {
  user: AuthUser | null;
  scope: SyncScope;
  autoSync: boolean;
  repo: string | null;
  status: "idle" | "syncing" | "error";
  statusText: string;
  stats: { pushed: number; pulled: number; lastSync: string | null };
  log: string[];
}

export interface PanelActions {
  signIn(): void;
  signOut(): void;
  syncNow(): void;
  pullNow(): void;
  setScope(scope: SyncScope): void;
  setAutoSync(value: boolean): void;
}

/** The cursorsync sidebar panel. */
export class PanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private last?: PanelState;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly actions: PanelActions,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: { type: string; value?: unknown }) => {
      switch (msg.type) {
        case "ready":
          if (this.last) this.postState(this.last);
          break;
        case "signIn":
          return this.actions.signIn();
        case "signOut":
          return this.actions.signOut();
        case "syncNow":
          return this.actions.syncNow();
        case "pullNow":
          return this.actions.pullNow();
        case "setScope":
          return this.actions.setScope(msg.value as SyncScope);
        case "setAutoSync":
          return this.actions.setAutoSync(msg.value as boolean);
      }
    });
  }

  postState(state: PanelState): void {
    this.last = state;
    this.view?.webview.postMessage({ type: "state", state });
  }

  private html(webview: vscode.Webview): string {
    const nonce = Array.from({ length: 24 }, () =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(
        Math.floor(Math.random() * 62),
      ),
    ).join("");
    const csp = `default-src 'none'; img-src ${webview.cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return /* html */ `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>
  :root { --accent:#6e5bf7; --accent2:#22b8cf; }
  * { box-sizing:border-box; }
  body { font-family:var(--vscode-font-family); color:var(--vscode-foreground);
    font-size:13px; margin:0; padding:14px; }
  .brand { display:flex; align-items:center; gap:9px; margin-bottom:16px; }
  .brand .logo { width:26px; height:26px; border-radius:7px; display:grid; place-items:center;
    background:linear-gradient(135deg,var(--accent),var(--accent2)); color:#fff; }
  .brand h1 { font-size:14px; font-weight:600; margin:0; letter-spacing:.2px; }
  .brand .tag { font-size:11px; opacity:.6; margin-left:auto; }
  .card { background:var(--vscode-editorWidget-background,rgba(127,127,127,.08));
    border:1px solid var(--vscode-widget-border,rgba(127,127,127,.18));
    border-radius:10px; padding:13px; margin-bottom:11px; }
  button { font-family:inherit; font-size:13px; border:none; border-radius:7px; cursor:pointer;
    padding:9px 12px; width:100%; display:flex; align-items:center; justify-content:center; gap:8px; }
  button:disabled { opacity:.5; cursor:default; }
  .btn-primary { background:linear-gradient(135deg,var(--accent),var(--accent2)); color:#fff; font-weight:600; }
  .btn-primary:hover:not(:disabled) { filter:brightness(1.08); }
  .btn-ghost { background:var(--vscode-button-secondaryBackground,rgba(127,127,127,.14));
    color:var(--vscode-foreground); margin-top:8px; }
  .btn-gh { background:#24292e; color:#fff; font-weight:600; }
  .user { display:flex; align-items:center; gap:10px; }
  .user img { width:34px; height:34px; border-radius:50%; }
  .user .name { font-weight:600; }
  .user .email { font-size:11px; opacity:.6; }
  .signout { margin-left:auto; font-size:11px; opacity:.7; cursor:pointer; text-decoration:underline; }
  .seg { display:flex; background:var(--vscode-input-background,rgba(127,127,127,.12));
    border-radius:8px; padding:3px; gap:3px; }
  .seg button { width:50%; padding:7px; border-radius:6px; background:transparent; opacity:.7; }
  .seg button.active { background:linear-gradient(135deg,var(--accent),var(--accent2)); color:#fff; opacity:1; font-weight:600; }
  .label { font-size:11px; text-transform:uppercase; letter-spacing:.6px; opacity:.55; margin:0 0 8px; }
  .row { display:flex; justify-content:space-between; align-items:center; padding:5px 0; font-size:12px; }
  .row .k { opacity:.6; } .row .v { font-weight:600; }
  .dot { width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:6px; }
  .dot.idle { background:#3fb950; } .dot.syncing { background:#d29922; animation:pulse 1s infinite; }
  .dot.error { background:#f85149; }
  @keyframes pulse { 50% { opacity:.3; } }
  .switch { display:flex; align-items:center; justify-content:space-between; }
  .toggle { width:38px; height:22px; border-radius:11px; background:rgba(127,127,127,.4); position:relative; cursor:pointer; transition:.2s; }
  .toggle.on { background:var(--accent); }
  .toggle .knob { position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%; background:#fff; transition:.2s; }
  .toggle.on .knob { left:18px; }
  .log { font-family:var(--vscode-editor-font-family,monospace); font-size:11px; opacity:.7;
    max-height:110px; overflow:auto; line-height:1.7; }
  .muted { opacity:.6; font-size:12px; }
  .hero { text-align:center; padding:8px 4px 4px; }
  .hero p { opacity:.7; margin:6px 0 14px; line-height:1.5; }
</style></head>
<body>
  <div class="brand">
    <div class="logo">⟳</div><h1>cursorsync</h1><span class="tag" id="ver">v0.1</span>
  </div>
  <div id="app"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const send = (type, value) => vscode.postMessage({ type, value });
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function render(s) {
    const app = document.getElementById('app');
    if (!s.user) {
      app.innerHTML = \`<div class="card hero">
        <p>Sync your Cursor chats across every device.</p>
        <button class="btn-gh" id="signin">Sign in with GitHub</button>
      </div>
      <p class="muted" style="text-align:center">Private to you — protected by row-level security.</p>\`;
      document.getElementById('signin').onclick = () => send('signIn');
      return;
    }
    const repo = s.repo ? esc(s.repo) : 'no repo detected';
    app.innerHTML = \`
      <div class="card"><div class="user">
        \${s.user.avatarUrl ? \`<img src="\${esc(s.user.avatarUrl)}"/>\` : ''}
        <div><div class="name">\${esc(s.user.userName || 'GitHub user')}</div>
        <div class="email">\${esc(s.user.email || '')}</div></div>
        <span class="signout" id="signout">Sign out</span>
      </div></div>

      <div class="card">
        <p class="label">Scope</p>
        <div class="seg">
          <button id="scope-all" class="\${s.scope==='all'?'active':''}">All chats</button>
          <button id="scope-repo" class="\${s.scope==='repo'?'active':''}">This repo</button>
        </div>
        <div class="row" style="margin-top:8px"><span class="k">Current repo</span><span class="v">\${repo}</span></div>
      </div>

      <button class="btn-primary" id="sync">⟳ Sync all chats now</button>
      <button class="btn-ghost" id="pull">↓ Pull from cloud</button>

      <div class="card" style="margin-top:11px">
        <div class="row"><span class="k"><span class="dot \${s.status}"></span>Status</span><span class="v">\${esc(s.statusText)}</span></div>
        <div class="row"><span class="k">Pushed</span><span class="v">\${s.stats.pushed.toLocaleString()}</span></div>
        <div class="row"><span class="k">Pulled</span><span class="v">\${s.stats.pulled.toLocaleString()}</span></div>
        <div class="row"><span class="k">Last sync</span><span class="v">\${s.stats.lastSync ? esc(s.stats.lastSync) : 'never'}</span></div>
        <div class="row switch" style="margin-top:6px"><span class="k">Auto-sync</span>
          <div class="toggle \${s.autoSync?'on':''}" id="auto"><div class="knob"></div></div></div>
      </div>

      <div class="card"><p class="label">Activity</p><div class="log">\${(s.log||[]).map(l=>esc(l)).join('<br>') || '<span class="muted">No activity yet</span>'}</div></div>\`;

    document.getElementById('signout').onclick = () => send('signOut');
    document.getElementById('scope-all').onclick = () => send('setScope','all');
    document.getElementById('scope-repo').onclick = () => send('setScope','repo');
    document.getElementById('sync').onclick = () => send('syncNow');
    document.getElementById('pull').onclick = () => send('pullNow');
    document.getElementById('auto').onclick = () => send('setAutoSync', !s.autoSync);
  }
  window.addEventListener('message', e => { if (e.data.type === 'state') render(e.data.state); });
  send('ready');
</script></body></html>`;
  }
}
