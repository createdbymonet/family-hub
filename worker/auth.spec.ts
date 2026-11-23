import { env } from 'cloudflare:workers';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from 'jose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { finishGoogleSignIn, OAUTH_COOKIE, startGoogleSignIn, verifyGoogleIdToken } from './auth';
import { decodeJson, encodeJson, randomToken, sha256 } from './crypto';
import { browserSession, request, seedUsers, USER_A, USER_B } from './test/helpers';
import { SESSION_COOKIE } from './session';

let privateKey: CryptoKey;
let jwk: JWK;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'google-test-key', alg: 'RS256', use: 'sig' };
});

beforeEach(async () => {
  await seedUsers();
});

async function idToken(
  nonce: string,
  overrides: JWTPayload = {},
  key = privateKey,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: 'google-sub-a',
    iss: 'https://accounts.google.com',
    aud: env.GOOGLE_CLIENT_ID,
    iat: now,
    exp: now + 300,
    nonce,
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'google-test-key' })
    .sign(key);
}

function mockGoogle(token: string, inspectExchange?: (body: URLSearchParams) => void): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
        return Response.json(
          { keys: [jwk] },
          { headers: { 'Cache-Control': 'public,max-age=3600' } },
        );
      }
      if (url === 'https://oauth2.googleapis.com/token') {
        inspectExchange?.(new URLSearchParams(String(init?.body)));
        return Response.json({
          id_token: token,
          access_token: 'not-an-app-session',
          token_type: 'Bearer',
        });
      }
      throw new Error('Unexpected outbound URL');
    }),
  );
}

async function start(returnTo = '/thanks-board'): Promise<{
  url: URL;
  cookie: string;
  secrets: { nonce: string; verifier: string; browser: string };
}> {
  const response = await startGoogleSignIn(
    new Request(`${env.APP_ORIGIN}/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`),
    env,
  );
  const cookie = response.headers.get('Set-Cookie')!.split(';')[0]!;
  const secrets = decodeJson(cookie.slice(OAUTH_COOKIE.length + 1)) as {
    nonce: string;
    verifier: string;
    browser: string;
  };
  return { url: new URL(response.headers.get('Location')!), cookie, secrets };
}

function callback(state: string, cookie: string): Request {
  return new Request(
    `${env.APP_ORIGIN}/api/auth/google/callback?state=${encodeURIComponent(state)}&code=one-time-code`,
    { headers: { Cookie: cookie } },
  );
}

describe('Google authorization code + PKCE', () => {
  it('uses state, nonce, S256, fixed redirect URI and short secure browser cookies; stores only hashes', async () => {
    const started = await start('https://evil.test');
    expect(started.url.origin).toBe('https://accounts.google.com');
    expect(started.url.searchParams.get('response_type')).toBe('code');
    expect(started.url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(started.url.searchParams.get('code_challenge')).toBe(
      await sha256(started.secrets.verifier),
    );
    expect(started.url.searchParams.get('nonce')).toBe(started.secrets.nonce);
    expect(started.url.searchParams.get('redirect_uri')).toBe(
      `${env.APP_ORIGIN}/api/auth/google/callback`,
    );
    const row = await env.DB.prepare('SELECT * FROM oauth_transactions').first();
    expect(row?.['return_to']).toBe('/shopping-list');
    expect(row?.['state_hash']).toBe(await sha256(started.url.searchParams.get('state')!));
    expect(JSON.stringify(row)).not.toContain(started.secrets.verifier);
    expect(JSON.stringify(row)).not.toContain(started.secrets.nonce);
    expect(JSON.stringify(row)).not.toContain(started.secrets.browser);
    const response = await request('/api/auth/google/start');
    expect(response.headers.get('Set-Cookie')).toContain(
      'HttpOnly; Secure; SameSite=Lax; Max-Age=600',
    );
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('accepts only pre-registered sub, validates the token, exchanges the original verifier and creates an app session', async () => {
    const started = await start();
    let exchanged = false;
    mockGoogle(await idToken(started.secrets.nonce), (body) => {
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code_verifier')).toBe(started.secrets.verifier);
      expect(body.get('client_id')).toBe(env.GOOGLE_CLIENT_ID);
      expect(body.get('client_secret')).toBe(env.GOOGLE_CLIENT_SECRET);
      expect(body.get('redirect_uri')).toBe(`${env.APP_ORIGIN}/api/auth/google/callback`);
      exchanged = true;
    });
    const response = await finishGoogleSignIn(
      callback(started.url.searchParams.get('state')!, started.cookie),
      env,
    );
    expect(exchanged).toBe(true);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe(`${env.APP_ORIGIN}/thanks-board`);
    const cookies = response.headers.getSetCookie();
    const sessionCookie = cookies.find((value) => value.startsWith(`${SESSION_COOKIE}=`))!;
    expect(sessionCookie).toContain('HttpOnly; Secure; SameSite=Lax');
    expect(
      cookies.some((value) => value.startsWith(`${OAUTH_COOKIE}=`) && value.includes('Max-Age=0')),
    ).toBe(true);
    const row = await env.DB.prepare('SELECT user_id,token_hash FROM sessions').first();
    expect(row?.['user_id']).toBe(USER_A);
    expect(row?.['token_hash']).toBe(
      await sha256(sessionCookie.split(';')[0]!.slice(SESSION_COOKIE.length + 1)),
    );
    expect(JSON.stringify(row)).not.toContain('not-an-app-session');
  });

  it('also permits the second registered Google account', async () => {
    const started = await start();
    mockGoogle(await idToken(started.secrets.nonce, { sub: 'google-sub-b' }));
    const response = await finishGoogleSignIn(
      callback(started.url.searchParams.get('state')!, started.cookie),
      env,
    );
    expect(response.status).toBe(303);
    expect(
      (await env.DB.prepare('SELECT user_id FROM sessions').first<{ user_id: string }>())?.user_id,
    ).toBe(USER_B);
  });

  it('rejects unregistered accounts and never inserts users', async () => {
    const started = await start();
    mockGoogle(
      await idToken(started.secrets.nonce, { sub: 'not-registered', email: 'alex@example.test' }),
    );
    await expect(
      finishGoogleSignIn(callback(started.url.searchParams.get('state')!, started.cookie), env),
    ).rejects.toMatchObject({ status: 403, code: 'ACCOUNT_NOT_ALLOWED' });
    expect(
      (await env.DB.prepare('SELECT count(*) AS total FROM users').first<{ total: number }>())
        ?.total,
    ).toBe(2);
    expect(
      (await env.DB.prepare('SELECT count(*) AS total FROM sessions').first<{ total: number }>())
        ?.total,
    ).toBe(0);
  });

  it('rejects wrong or missing state/browser cookies and tampered PKCE/nonce secrets before exchange', async () => {
    const started = await start();
    const state = started.url.searchParams.get('state')!;
    mockGoogle(await idToken(started.secrets.nonce));
    await expect(
      finishGoogleSignIn(callback(randomToken(), started.cookie), env),
    ).rejects.toMatchObject({ code: 'OAUTH_INVALID' });
    await expect(finishGoogleSignIn(callback(state, ''), env)).rejects.toMatchObject({
      code: 'OAUTH_INVALID',
    });
    for (const field of ['verifier', 'nonce', 'browser']) {
      const altered = `${OAUTH_COOKIE}=${encodeJson({ ...started.secrets, [field]: randomToken() })}`;
      await expect(finishGoogleSignIn(callback(state, altered), env)).rejects.toMatchObject({
        code: 'OAUTH_INVALID',
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects expired transactions and state/code replay, including concurrent callbacks', async () => {
    const expired = await start();
    await env.DB.prepare('UPDATE oauth_transactions SET expires_at = ?').bind(Date.now()).run();
    await expect(
      finishGoogleSignIn(callback(expired.url.searchParams.get('state')!, expired.cookie), env),
    ).rejects.toMatchObject({ code: 'OAUTH_INVALID' });
    const started = await start();
    mockGoogle(await idToken(started.secrets.nonce));
    const responses = await Promise.allSettled([
      finishGoogleSignIn(callback(started.url.searchParams.get('state')!, started.cookie), env),
      finishGoogleSignIn(callback(started.url.searchParams.get('state')!, started.cookie), env),
    ]);
    expect(responses.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    await expect(
      finishGoogleSignIn(callback(started.url.searchParams.get('state')!, started.cookie), env),
    ).rejects.toMatchObject({ code: 'OAUTH_INVALID' });
    expect(
      (await env.DB.prepare('SELECT count(*) AS total FROM sessions').first<{ total: number }>())
        ?.total,
    ).toBe(1);
  });

  it('safely redirects browser failures, erases OAuth cookie, and keeps internal errors out of responses', async () => {
    const response = await request(
      '/api/auth/google/callback?code=secret-authorization-code&state=invalid',
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe(
      `${env.APP_ORIGIN}/login?error=authentication_failed`,
    );
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(await response.text()).not.toContain('secret-authorization-code');
  });

  it('revokes the previous browser session during account switch without affecting another device', async () => {
    const previous = await browserSession();
    const otherDevice = await browserSession();
    const started = await start();
    mockGoogle(await idToken(started.secrets.nonce));
    await finishGoogleSignIn(
      callback(started.url.searchParams.get('state')!, `${started.cookie}; ${previous.cookie}`),
      env,
    );
    expect((await request('/api/auth/session', 'GET', previous)).status).toBe(401);
    expect((await request('/api/auth/session', 'GET', otherDevice)).status).toBe(200);
  });

  it('fails closed when Google configuration is missing', async () => {
    await expect(
      startGoogleSignIn(new Request(`${env.APP_ORIGIN}/api/auth/google/start`), {
        ...env,
        GOOGLE_CLIENT_SECRET: '',
      }),
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe('Google ID token verification', () => {
  it('accepts the documented Google issuer and audience', async () => {
    const nonce = randomToken();
    const token = await idToken(nonce, { iss: 'accounts.google.com' });
    mockGoogle(token);
    await expect(verifyGoogleIdToken(token, nonce, env)).resolves.toBe('google-sub-a');
  });

  it.each([
    ['issuer', { iss: 'https://evil.test' }],
    ['audience', { aud: 'another-client' }],
    ['nonce', { nonce: 'wrong-nonce' }],
    ['expiry', { exp: 1 }],
    ['issued in the future', { iat: 9_999_999_999 }],
    ['missing sub', { sub: undefined }],
    ['missing nonce', { nonce: undefined }],
    ['authorized party', { azp: 'other-client' }],
    ['multiple audiences without authorized party', { aud: ['test-client-id', 'another-client'] }],
  ] satisfies [string, JWTPayload][])('rejects invalid %s', async (_reason, overrides) => {
    const nonce = randomToken();
    const token = await idToken(nonce, overrides);
    mockGoogle(token);
    await expect(verifyGoogleIdToken(token, nonce, env)).rejects.toMatchObject({
      code: 'OAUTH_INVALID_TOKEN',
    });
  });

  it('rejects an invalid signature', async () => {
    const impostor = await generateKeyPair('RS256');
    const nonce = randomToken();
    const token = await idToken(nonce, {}, impostor.privateKey);
    mockGoogle(token);
    await expect(verifyGoogleIdToken(token, nonce, env)).rejects.toMatchObject({
      code: 'OAUTH_INVALID_TOKEN',
    });
  });
});
