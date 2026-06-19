import * as vscode from "vscode";
import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import { getConfig } from "./config.js";

/**
 * GitHub sign-in via Supabase Auth, using the editor's URI handler as the OAuth redirect target
 * (PKCE flow). The session is persisted in VS Code SecretStorage — never on disk in plaintext.
 *
 * Requires (cloud side): GitHub provider enabled in Supabase Auth, and the redirect URL
 * `${uriScheme}://lokeylabs.cursorsync/auth-callback` added to Supabase's allow-list.
 */

const CALLBACK_PATH = "/auth-callback";

/** SecretStorage-backed adapter so supabase-js can persist the session + PKCE verifier. */
class SecretStorageAdapter {
  constructor(private secrets: vscode.SecretStorage) {}
  async getItem(key: string): Promise<string | null> {
    return (await this.secrets.get(key)) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    await this.secrets.store(key, value);
  }
  async removeItem(key: string): Promise<void> {
    await this.secrets.delete(key);
  }
}

export interface AuthUser {
  id: string;
  email?: string;
  userName?: string;
  avatarUrl?: string;
}

export class AuthManager {
  readonly client: SupabaseClient;
  private readonly _onChange = new vscode.EventEmitter<AuthUser | null>();
  readonly onChange = this._onChange.event;

  constructor(private ctx: vscode.ExtensionContext) {
    const { supabaseUrl, supabaseAnonKey } = getConfig();
    this.client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: new SecretStorageAdapter(ctx.secrets),
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
      },
    });
    this.client.auth.onAuthStateChange((_event, session) => {
      this._onChange.fire(toUser(session));
    });
  }

  private redirectTo(): string {
    return `${vscode.env.uriScheme}://lokeylabs.cursorsync${CALLBACK_PATH}`;
  }

  /** Start GitHub OAuth: open the consent page in the browser. Completes via handleUri(). */
  async signIn(): Promise<void> {
    const { data, error } = await this.client.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: this.redirectTo(), skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (data?.url) await vscode.env.openExternal(vscode.Uri.parse(data.url));
  }

  /** Handle the editor:// callback — exchange the auth code for a session. */
  async handleUri(uri: vscode.Uri): Promise<void> {
    if (uri.path !== CALLBACK_PATH) return;
    const code = new URLSearchParams(uri.query).get("code");
    if (!code) return;
    const { error } = await this.client.auth.exchangeCodeForSession(code);
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  async currentUser(): Promise<AuthUser | null> {
    const { data } = await this.client.auth.getSession();
    return toUser(data.session);
  }
}

function toUser(session: Session | null): AuthUser | null {
  if (!session?.user) return null;
  const m = session.user.user_metadata ?? {};
  return {
    id: session.user.id,
    email: session.user.email,
    userName: (m.user_name as string) ?? (m.preferred_username as string) ?? (m.name as string),
    avatarUrl: m.avatar_url as string,
  };
}
