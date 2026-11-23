import type { SessionDto } from '../shared/contracts';
import { cookie, HttpError, protectedCookie } from './http';
import { randomToken, secretEquals, sha256 } from './crypto';

export const DAY = 86_400_000;
export const IDLE_LIFETIME = 30 * DAY;
export const ABSOLUTE_LIFETIME = 180 * DAY;
export const SESSION_COOKIE = '__Host-family-hub-session';

interface SessionRow {
  token_hash: string;
  user_id: string;
  display_name: string;
  household_id: string;
  household_name: string;
  expires_at: number;
  absolute_expires_at: number;
}

export interface SessionContext {
  readonly token: string;
  readonly tokenHash: string;
  readonly csrfToken: string;
  readonly userId: string;
  readonly displayName: string;
  readonly householdId: string;
  readonly householdName: string;
  expiresAt: number;
  readonly absoluteExpiresAt: number;
  renewed: boolean;
}

export function appOrigin(env: Cloudflare.Env): string {
  let url: URL;
  try {
    url = new URL(env.APP_ORIGIN);
  } catch {
    throw new HttpError(503, 'NOT_CONFIGURED', 'Family Mode is not configured.');
  }
  if (url.protocol !== 'https:' || url.origin !== env.APP_ORIGIN) {
    throw new HttpError(503, 'NOT_CONFIGURED', 'Family Mode is not configured.');
  }
  return url.origin;
}

export async function sessionFromRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<SessionContext> {
  appOrigin(env);
  const token = cookie(request, SESSION_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  }
  const tokenHash = await sha256(token);
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT s.token_hash, s.user_id, u.display_name, m.household_id, h.name AS household_name,
            s.expires_at, s.absolute_expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       JOIN household_members m ON m.user_id = u.id JOIN households h ON h.id = m.household_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL
        AND s.expires_at > ? AND s.absolute_expires_at > ?`,
  )
    .bind(tokenHash, now, now)
    .first<SessionRow>();
  if (!row)
    throw new HttpError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in.');
  return {
    token,
    tokenHash,
    csrfToken: await sha256(`family-hub:csrf:v1:${token}`),
    userId: row.user_id,
    displayName: row.display_name,
    householdId: row.household_id,
    householdName: row.household_name,
    expiresAt: row.expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    renewed: false,
  };
}

export async function verifyCsrf(
  request: Request,
  env: Cloudflare.Env,
  session: SessionContext,
): Promise<void> {
  if (
    request.headers.get('Origin') !== appOrigin(env) ||
    !(await secretEquals(request.headers.get('X-Family-Hub-CSRF') ?? '', session.csrfToken))
  ) {
    throw new HttpError(
      403,
      'CSRF_REJECTED',
      'The request could not be verified. Refresh and try again.',
    );
  }
}

export async function recordActivity(
  request: Request,
  env: Cloudflare.Env,
  session: SessionContext,
): Promise<void> {
  if (request.headers.get('X-Family-Hub-Activity') !== '1') return;
  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== appOrigin(env)) {
    throw new HttpError(403, 'CSRF_REJECTED', 'The request could not be verified.');
  }
  const now = Date.now();
  const expires = Math.min(now + IDLE_LIFETIME, session.absoluteExpiresAt);
  // The conditional update also prevents a concurrently revoked session from being revived.
  const row = await env.DB.prepare(
    `UPDATE sessions SET last_activity_at = max(last_activity_at, ?), expires_at = max(expires_at, ?)
      WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? AND absolute_expires_at > ?
      RETURNING expires_at`,
  )
    .bind(now, expires, session.tokenHash, now, now)
    .first<{ expires_at: number }>();
  if (!row)
    throw new HttpError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in.');
  session.expiresAt = row.expires_at;
  session.renewed = true;
}

export function sessionDto(session: SessionContext): SessionDto {
  return {
    user: { id: session.userId, displayName: session.displayName },
    household: { id: session.householdId, name: session.householdName },
    csrfToken: session.csrfToken,
    expiresAt: new Date(session.expiresAt).toISOString(),
    absoluteExpiresAt: new Date(session.absoluteExpiresAt).toISOString(),
  };
}

export function sessionCookie(session: SessionContext): string {
  return protectedCookie(SESSION_COOKIE, session.token, (session.expiresAt - Date.now()) / 1000);
}

export function clearSessionCookie(): string {
  return protectedCookie(SESSION_COOKIE, '', 0);
}

export async function createSession(env: Cloudflare.Env, userId: string): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO sessions(token_hash,user_id,created_at,last_activity_at,expires_at,absolute_expires_at)
     VALUES(?,?,?,?,?,?)`,
  )
    .bind(await sha256(token), userId, now, now, now + IDLE_LIFETIME, now + ABSOLUTE_LIFETIME)
    .run();
  return protectedCookie(SESSION_COOKIE, token, IDLE_LIFETIME / 1000);
}

export async function revokeSession(env: Cloudflare.Env, session: SessionContext): Promise<void> {
  await env.DB.prepare(
    'UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
  )
    .bind(Date.now(), session.tokenHash)
    .run();
}
