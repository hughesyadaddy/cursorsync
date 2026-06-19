/**
 * Pure builder for the webview's HTML shell — no `vscode` dependency, so it is unit-testable.
 * The caller (PanelProvider) supplies the webview-derived values: a per-load nonce, the
 * `cspSource`, and `asWebviewUri`-resolved asset URLs.
 *
 * Security note: the Content-Security-Policy is intentionally strict — `default-src 'none'`,
 * scripts only via the matching nonce (never `unsafe-inline`), styles/images only from the
 * webview's own resource origin. Keep it that way; the test in panel-html.test.ts guards it.
 */
export interface PanelHtmlParams {
  cspSource: string;
  nonce: string;
  styleUri: string;
  scriptUri: string;
  logoUri: string;
  version: string;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

export function buildPanelHtml(p: PanelHtmlParams): string {
  const csp = [
    `default-src 'none'`,
    `img-src ${p.cspSource} https: data:`,
    `style-src ${p.cspSource}`,
    `script-src 'nonce-${p.nonce}'`,
  ].join("; ");
  const version = escapeHtml(p.version);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${p.styleUri}" />
</head>
<body>
  <header class="brand">
    <img class="logo" src="${p.logoUri}" alt="" />
    <div class="brand-text"><h1>Cursor Sync</h1><span class="ver">v${version}</span></div>
  </header>
  <div id="view"></div>
  <script nonce="${p.nonce}" src="${p.scriptUri}"></script>
</body>
</html>`;
}
