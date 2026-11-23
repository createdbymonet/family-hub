import { env } from 'cloudflare:workers';
import worker from '../index';
import { createSession, SESSION_COOKIE } from '../session';
import { sha256 } from '../crypto';

export const USER_A = '00000000-0000-4000-8000-000000000001';
export const USER_B = '00000000-0000-4000-8000-000000000002';
export const HOUSEHOLD = '00000000-0000-4000-8000-000000000003';
export const OTHER_HOUSEHOLD = '00000000-0000-4000-8000-000000000004';

export interface BrowserSession {
  cookie: string;
  token: string;
  hash: string;
  csrf: string;
}

export async function seedUsers(): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO households(id,name,created_at) VALUES(?,?,?)').bind(
      HOUSEHOLD,
      'Test family',
      now,
    ),
    env.DB.prepare('INSERT INTO households(id,name,created_at) VALUES(?,?,?)').bind(
      OTHER_HOUSEHOLD,
      'Other family',
      now,
    ),
    env.DB.prepare('INSERT INTO users(id,google_sub,display_name,created_at) VALUES(?,?,?,?)').bind(
      USER_A,
      'google-sub-a',
      'Alex',
      now,
    ),
    env.DB.prepare('INSERT INTO users(id,google_sub,display_name,created_at) VALUES(?,?,?,?)').bind(
      USER_B,
      'google-sub-b',
      'Sam',
      now,
    ),
    env.DB.prepare('INSERT INTO household_members(household_id,user_id,role) VALUES(?,?,?)').bind(
      HOUSEHOLD,
      USER_A,
      'owner',
    ),
    env.DB.prepare('INSERT INTO household_members(household_id,user_id,role) VALUES(?,?,?)').bind(
      HOUSEHOLD,
      USER_B,
      'member',
    ),
  ]);
}

export async function browserSession(userId = USER_A): Promise<BrowserSession> {
  const fullCookie = await createSession(env, userId);
  const value = fullCookie.split(';')[0]!;
  const token = value.slice(SESSION_COOKIE.length + 1);
  return {
    cookie: value,
    token,
    hash: await sha256(token),
    csrf: await sha256(`family-hub:csrf:v1:${token}`),
  };
}

export function request(
  path: string,
  method = 'GET',
  session?: BrowserSession,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<Response> {
  const headers = new Headers(extra);
  if (session) {
    headers.set('Cookie', session.cookie);
    if (method !== 'GET') {
      if (!headers.has('Origin')) headers.set('Origin', env.APP_ORIGIN);
      if (!headers.has('X-Family-Hub-CSRF')) headers.set('X-Family-Hub-CSRF', session.csrf);
    }
  }
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return worker.fetch(
    new Request(`${env.APP_ORIGIN}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}
