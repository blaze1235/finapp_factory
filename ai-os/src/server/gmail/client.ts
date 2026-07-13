import { sql } from "@/server/db";

/**
 * Gmail OAuth2 + a minimal REST client. Scope requested: gmail.readonly + gmail.compose.
 * IMPORTANT: gmail.compose technically also permits sending via the API — Google doesn't offer
 * a narrower "drafts only, no send" scope. This app deliberately never calls drafts.send or
 * messages.send anywhere; the restriction is enforced by what we implement, not by the grant.
 */

const REDIRECT_PATH = "/api/gmail/callback";
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"];

function redirectUri(): string {
  return `${process.env.APP_BASE_URL}${REDIRECT_PATH}`;
}

export function oauthConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_BASE_URL);
}

export function authUrl(): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<void> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  if (!data.refresh_token) throw new Error(`No refresh_token in Google response: ${JSON.stringify(data).slice(0, 200)}`);
  await sql`INSERT INTO settings (key, value) VALUES ('gmail_refresh_token', ${data.refresh_token})
            ON CONFLICT (key) DO UPDATE SET value = ${data.refresh_token}`;
}

export async function isGmailConnected(): Promise<boolean> {
  const [row] = await sql`SELECT value FROM settings WHERE key = 'gmail_refresh_token'`;
  return !!row?.value;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  const [row] = await sql`SELECT value FROM settings WHERE key = 'gmail_refresh_token'`;
  if (!row?.value) throw new Error("Gmail not connected");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: row.value,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Gmail token refresh failed: ${JSON.stringify(data).slice(0, 200)}`);
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.token;
}

async function gmailFetch(path: string, init?: RequestInit) {
  const token = await getAccessToken();
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function header(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export interface EmailSummary {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

/** Read-only search — never marks anything read, never modifies. */
export async function searchEmails(query: string, maxResults = 8): Promise<EmailSummary[]> {
  const list = await gmailFetch(`/messages?q=${encodeURIComponent(query)}&maxResults=${Math.min(maxResults, 20)}`);
  const ids: { id: string }[] = list.messages ?? [];
  const results = await Promise.all(
    ids.map(async (m) => {
      const msg = await gmailFetch(`/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
      return {
        id: m.id,
        from: header(msg.payload?.headers ?? [], "From"),
        subject: header(msg.payload?.headers ?? [], "Subject"),
        date: header(msg.payload?.headers ?? [], "Date"),
        snippet: msg.snippet ?? "",
      };
    }),
  );
  return results;
}

function base64url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Creates a Gmail DRAFT only. Never sends — no send function exists in this file or anywhere else in the app. */
export async function createDraftEmail(to: string, subject: string, body: string): Promise<{ id: string }> {
  const raw = base64url(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`);
  const res = await gmailFetch("/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw } }),
  });
  return { id: res.id };
}
