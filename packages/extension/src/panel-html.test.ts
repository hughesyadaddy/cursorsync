import { describe, it, expect } from "vitest";
import { buildPanelHtml, type PanelHtmlParams } from "./panel-html.js";

const params: PanelHtmlParams = {
  cspSource: "vscode-resource://example",
  nonce: "abc123nonce",
  styleUri: "vscode-resource://example/media/panel.css",
  scriptUri: "vscode-resource://example/media/panel.js",
  logoUri: "vscode-resource://example/media/logo.svg",
  version: "0.1.12",
};

function cspOf(html: string): string {
  const m = html.match(/Content-Security-Policy" content="([^"]+)"/);
  if (!m) throw new Error("no CSP meta tag");
  return m[1] ?? "";
}

describe("buildPanelHtml", () => {
  it("emits a strict, locked-down CSP", () => {
    const csp = cspOf(buildPanelHtml(params));
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src 'nonce-${params.nonce}'`);
    // scripts must run only via the nonce — never inline or eval
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain(`style-src ${params.cspSource}`);
    expect(csp).toContain(`img-src ${params.cspSource}`);
  });

  it("loads the script with the matching nonce and no inline handlers", () => {
    const html = buildPanelHtml(params);
    expect(html).toContain(`<script nonce="${params.nonce}" src="${params.scriptUri}">`);
    expect(html).not.toMatch(/\son[a-z]+=/i); // no inline event handlers (e.g. " onclick=")
  });

  it("references every webview asset and the version", () => {
    const html = buildPanelHtml(params);
    expect(html).toContain(params.styleUri);
    expect(html).toContain(params.logoUri);
    expect(html).toContain("v0.1.12");
  });

  it("escapes the version to prevent markup injection", () => {
    const html = buildPanelHtml({ ...params, version: '1<script>"&' });
    expect(html).toContain("1&lt;script&gt;&quot;&amp;");
    expect(html).not.toContain("1<script>");
  });
});
