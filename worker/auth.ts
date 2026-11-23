import { createRemoteJWKSet, jwtVerify } from 'jose';
import { decodeJson, encodeJson, randomToken, secretEquals, sha256 } from './crypto';
import { cookie, HttpError, protectedCookie } from './http';
import { appOrigin, createSession, SESSION_COOKIE } from './session';

export const OAUTH_COOKIE = '__Host-family-hub-oauth';
const OAUTH_LIFETIME = 10 * 60_000;
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

interface OAuthCookie {
  nonce: string;
  verifier: string;
  browser: string;
}
interface OAuthTransaction {
  state_hash: string;
  nonce_hash: string;
  verifier_hash: string;
  browser_hash: string;
}

function authConfigured(env: Cloudflare.Env): void {
  appOrigin(env);
  const missingBindings = (['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const).filter(
    (name) => !env[name]?.trim(),
  );
  if (missingBindings.length) {
    // Names only: never log OAuth credentials, callback URLs, or browser secrets.
    console.error(JSON.stringify({ event: 'oauth_not_configured', missingBindings }));
    throw new HttpError(503, 'NOT_CONFIGURED', 'Google sign-in is not configured.');
  }
}

export function clearOAuthCookie(): string {
  return protectedCookie(OAUTH_COOKIE, '', 0);
}

export async function startGoogleSignIn(_request: Request, env: Cloudflare.Env): Promise<Response> {
  authConfigured(env);
  const state = randomToken();
  const secrets: OAuthCookie = {
    nonce: randomToken(),
    verifier: randomToken(),
    browser: randomToken(),
  };
  const now = Date.now();
  // Keep the legacy column compatible with the previous Worker during rollout.
  // It is no longer derived from input or used as a redirect destination.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_transactions WHERE expires_at <= ?').bind(now),
    env.DB.prepare(
      `INSERT INTO oauth_transactions(state_hash,nonce_hash,verifier_hash,browser_hash,return_to,expires_at)
       VALUES(?,?,?,?,'/shopping-list',?)`,
    ).bind(
      await sha256(state),
      await sha256(secrets.nonce),
      await sha256(secrets.verifier),
      await sha256(secrets.browser),
      now + OAUTH_LIFETIME,
    ),
  ]);
  const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${appOrigin(env)}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid profile',
    state,
    nonce: secrets.nonce,
    code_challenge: await sha256(secrets.verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  const response = new Response(null, { status: 303, headers: { Location: google.toString() } });
  response.headers.append(
    'Set-Cookie',
    protectedCookie(OAUTH_COOKIE, encodeJson(secrets), OAUTH_LIFETIME / 1000),
  );
  return response;
}

function parseOAuthCookie(value: string | null): OAuthCookie {
  try {
    const decoded = decodeJson(value ?? '');
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded))
      throw new Error();
    const object = decoded as Record<string, unknown>;
    for (const field of ['nonce', 'verifier', 'browser'] as const) {
      if (typeof object[field] !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(object[field]))
        throw new Error();
    }
    return {
      nonce: String(object['nonce']),
      verifier: String(object['verifier']),
      browser: String(object['browser']),
    };
  } catch {
    throw new HttpError(400, 'OAUTH_INVALID', 'The sign-in attempt could not be verified.');
  }
}

/** Kept separate so the fail-closed verification contract can be tested with signed fixtures. */
export async function verifyGoogleIdToken(
  idToken: string,
  nonce: string,
  env: Cloudflare.Env,
): Promise<string> {
  const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  try {
    const { payload } = await jwtVerify(idToken, keys, {
      algorithms: ['RS256'],
      issuer: GOOGLE_ISSUERS,
      audience: env.GOOGLE_CLIENT_ID,
      requiredClaims: ['sub', 'iss', 'aud', 'iat', 'exp', 'nonce'],
      maxTokenAge: '10 minutes',
      clockTolerance: 5,
    });
    if (
      typeof payload.sub !== 'string' ||
      payload.sub.length < 1 ||
      payload.sub.length > 255 ||
      typeof payload['nonce'] !== 'string' ||
      !(await secretEquals(payload['nonce'], nonce)) ||
      (payload['azp'] !== undefined && payload['azp'] !== env.GOOGLE_CLIENT_ID) ||
      (Array.isArray(payload.aud) &&
        payload.aud.length > 1 &&
        payload['azp'] !== env.GOOGLE_CLIENT_ID)
    ) {
      throw new Error('Invalid claims');
    }
    return payload.sub;
  } catch {
    throw new HttpError(400, 'OAUTH_INVALID_TOKEN', 'The identity token could not be verified.');
  }
}

export async function finishGoogleSignIn(request: Request, env: Cloudflare.Env): Promise<Response> {
  authConfigured(env);
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (
    !state ||
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    !code ||
    code.length > 4096 ||
    url.searchParams.has('error')
  ) {
    throw new HttpError(400, 'OAUTH_INVALID', 'The sign-in attempt could not be verified.');
  }
  const secrets = parseOAuthCookie(cookie(request, OAUTH_COOKIE));
  const now = Date.now();
  // Validate and consume in one statement: a code/state can never be replayed, even concurrently.
  const transaction = await env.DB.prepare(
    `UPDATE oauth_transactions SET consumed_at = ?
      WHERE state_hash = ? AND nonce_hash = ? AND verifier_hash = ? AND browser_hash = ?
        AND expires_at > ? AND consumed_at IS NULL
      RETURNING state_hash,nonce_hash,verifier_hash,browser_hash`,
  )
    .bind(
      now,
      await sha256(state),
      await sha256(secrets.nonce),
      await sha256(secrets.verifier),
      await sha256(secrets.browser),
      now,
    )
    .first<OAuthTransaction>();
  if (!transaction)
    throw new HttpError(
      400,
      'OAUTH_INVALID',
      'The sign-in attempt has expired or was already used.',
    );
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${appOrigin(env)}/api/auth/google/callback`,
      code_verifier: secrets.verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok)
    throw new HttpError(400, 'OAUTH_INVALID', 'Google sign-in could not be completed.');
  const tokens: unknown = await tokenResponse.json();
  if (
    typeof tokens !== 'object' ||
    tokens === null ||
    !('id_token' in tokens) ||
    typeof tokens.id_token !== 'string'
  ) {
    throw new HttpError(400, 'OAUTH_INVALID', 'Google sign-in could not be completed.');
  }
  const googleSub = await verifyGoogleIdToken(tokens.id_token, secrets.nonce, env);
  const user = await env.DB.prepare(
    `SELECT u.id FROM users u JOIN household_members m ON m.user_id = u.id WHERE u.google_sub = ?`,
  )
    .bind(googleSub)
    .first<{ id: string }>();
  if (!user)
    throw new HttpError(
      403,
      'ACCOUNT_NOT_ALLOWED',
      'This account is not registered for Family Mode.',
    );
  // A deliberate account switch invalidates the browser's previous session, not other devices.
  const previous = cookie(request, SESSION_COOKIE);
  if (previous && /^[A-Za-z0-9_-]{43}$/.test(previous)) {
    await env.DB.prepare(
      'UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    )
      .bind(now, await sha256(previous))
      .run();
  }
  const response = new Response(null, {
    status: 303,
    headers: { Location: `${appOrigin(env)}/` },
  });
  response.headers.append('Set-Cookie', await createSession(env, user.id));
  response.headers.append('Set-Cookie', clearOAuthCookie());
  return response;
}
