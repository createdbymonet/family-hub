import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  SessionDto,
  ShoppingItemDto,
  ThanksPostDto,
  ThanksPostsPageDto,
} from '../shared/contracts';
import worker from './index';
import { ABSOLUTE_LIFETIME, DAY, IDLE_LIFETIME } from './session';
import {
  browserSession,
  HOUSEHOLD,
  OTHER_HOUSEHOLD,
  request,
  seedUsers,
  USER_A,
  USER_B,
  type BrowserSession,
} from './test/helpers';

let a: BrowserSession;
let b: BrowserSession;
beforeEach(async () => {
  await seedUsers();
  a = await browserSession();
  b = await browserSession(USER_B);
});

describe('API authentication and sessions', () => {
  it('rejects all private reads/writes without a session and gives JSON for unknown API paths', async () => {
    for (const [path, method] of [
      ['/api/shopping-items', 'GET'],
      ['/api/thanks-posts', 'GET'],
      ['/api/shopping-items', 'POST'],
      ['/api/auth/session', 'GET'],
    ]) {
      const response = await request(path!, method!);
      expect(response.status).toBe(401);
      expect(response.headers.get('Content-Type')).toContain('application/json');
      expect(response.headers.get('Cache-Control')).toContain('no-store');
    }
    expect((await request('/api/unknown')).status).toBe(404);
    expect((await request('/api/demo/shopping-items', 'POST')).status).toBe(404);
  });

  it('returns a scoped session and a non-secret session identity header', async () => {
    const response = await request('/api/auth/session', 'GET', a);
    const session = await response.json<SessionDto>();
    expect(session.user).toEqual({ id: USER_A, displayName: 'Alex' });
    expect(session.household.id).toBe(HOUSEHOLD);
    expect(session.csrfToken).toBe(a.csrf);
    expect(response.headers.get('X-Family-Hub-Session')).toBe(a.csrf);
    expect(JSON.stringify(session)).not.toContain(a.token);
    expect(response.headers.get('Set-Cookie')).toBeNull();
    const stored = await env.DB.prepare('SELECT * FROM sessions WHERE token_hash = ?')
      .bind(a.hash)
      .first();
    expect(stored?.['token_hash']).toBe(a.hash);
    expect(JSON.stringify(stored)).not.toContain(a.token);
  });

  it('enforces Origin and CSRF even when the cookie is valid, including errors session identity', async () => {
    const attempts: Record<string, string>[] = [
      { Origin: 'https://evil.test' },
      { 'X-Family-Hub-CSRF': 'wrong' },
      { Origin: 'null' },
    ];
    for (const headers of attempts) {
      const response = await request(
        '/api/shopping-items',
        'POST',
        a,
        { id: crypto.randomUUID(), name: 'Milk' },
        headers,
      );
      expect(response.status).toBe(403);
      expect(response.headers.get('X-Family-Hub-Session')).toBe(a.csrf);
    }
    const noOrigin = await worker.fetch(
      new Request(`${env.APP_ORIGIN}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: a.cookie, 'X-Family-Hub-CSRF': a.csrf },
      }),
      env,
    );
    expect(noOrigin.status).toBe(403);
    expect((await request('/api/shopping-items', 'GET', a)).status).toBe(200);
  });

  it('does not renew sessions for background reads and renews to 30 days only with explicit user activity', async () => {
    const now = Date.now();
    const oldExpiry = now + 2 * DAY;
    await env.DB.prepare(
      'UPDATE sessions SET last_activity_at = ?, expires_at = ? WHERE token_hash = ?',
    )
      .bind(now - 28 * DAY, oldExpiry, a.hash)
      .run();
    await request('/api/shopping-items', 'GET', a);
    expect(
      (
        await env.DB.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?')
          .bind(a.hash)
          .first<{ expires_at: number }>()
      )?.expires_at,
    ).toBe(oldExpiry);
    const active = await request('/api/auth/session', 'GET', a, undefined, {
      'X-Family-Hub-Activity': '1',
    });
    const session = await active.json<SessionDto>();
    expect(Date.parse(session.expiresAt)).toBeGreaterThanOrEqual(now + IDLE_LIFETIME);
    expect(active.headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
    expect(active.headers.get('Set-Cookie')).toContain('Max-Age=');
    expect(
      (
        await request('/api/auth/session', 'GET', a, undefined, {
          Origin: 'https://evil.test',
          'X-Family-Hub-Activity': '1',
        })
      ).status,
    ).toBe(403);
  });

  it('caps sliding renewal at 180 days and rejects either deadline at equality', async () => {
    const now = Date.now();
    await env.DB.prepare(
      'UPDATE sessions SET created_at = ?,expires_at = ?,absolute_expires_at = ? WHERE token_hash = ?',
    )
      .bind(now - 179 * DAY, now + DAY, now + DAY, a.hash)
      .run();
    const session = await (
      await request('/api/auth/session', 'GET', a, undefined, { 'X-Family-Hub-Activity': '1' })
    ).json<SessionDto>();
    expect(Date.parse(session.expiresAt)).toBe(now + DAY);
    expect(Date.parse(session.absoluteExpiresAt) - (now - 179 * DAY)).toBe(ABSOLUTE_LIFETIME);
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .bind(Date.now(), a.hash)
      .run();
    expect((await request('/api/auth/session', 'GET', a)).status).toBe(401);
    await env.DB.prepare(
      'UPDATE sessions SET expires_at = ?,absolute_expires_at = ? WHERE token_hash = ?',
    )
      .bind(Date.now(), Date.now(), b.hash)
      .run();
    expect((await request('/api/auth/session', 'GET', b)).status).toBe(401);
  });

  it('revokes only the current device on logout and removes its cookie', async () => {
    const secondDevice = await browserSession();
    const response = await request('/api/auth/logout', 'POST', a);
    expect(response.status).toBe(204);
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect((await request('/api/auth/session', 'GET', a)).status).toBe(401);
    expect((await request('/api/auth/session', 'GET', secondDevice)).status).toBe(200);
    expect((await request('/api/auth/session', 'GET', b)).status).toBe(200);
  });

  it('rejects duplicate session cookies and membership removed after login', async () => {
    const response = await worker.fetch(
      new Request(`${env.APP_ORIGIN}/api/auth/session`, {
        headers: { Cookie: `${a.cookie}; ${a.cookie}` },
      }),
      env,
    );
    expect(response.status).toBe(401);
    await env.DB.prepare('DELETE FROM household_members WHERE user_id = ?').bind(USER_A).run();
    expect((await request('/api/auth/session', 'GET', a)).status).toBe(401);
  });

  it('fails closed if origin configuration is absent or insecure', async () => {
    for (const APP_ORIGIN of ['', 'http://localhost:8787']) {
      const response = await worker.fetch(
        new Request('https://family-hub.test/api/shopping-items'),
        { ...env, APP_ORIGIN },
      );
      expect(response.status).toBe(503);
      expect(response.headers.get('Content-Type')).toContain('application/json');
    }
  });
});

describe('shopping D1 persistence and concurrency', () => {
  it('creates, re-reads from another session, edits, completes, uncompletes and deletes', async () => {
    const id = crypto.randomUUID();
    const response = await request('/api/shopping-items', 'POST', a, { id, name: '  Milk  ' });
    expect(response.status).toBe(201);
    const created = await response.json<ShoppingItemDto>();
    expect(created).toMatchObject({ id, name: 'Milk', completed: false, version: 1 });
    expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);
    expect(await (await request('/api/shopping-items', 'GET', b)).json()).toEqual([created]);
    const edited = await (
      await request(`/api/shopping-items/${id}`, 'PATCH', b, {
        version: 1,
        name: 'Oat milk',
        completed: true,
      })
    ).json<ShoppingItemDto>();
    expect(edited).toMatchObject({ name: 'Oat milk', completed: true, version: 2 });
    expect(
      (await request(`/api/shopping-items/${id}`, 'PATCH', a, { version: 2, completed: false }))
        .status,
    ).toBe(200);
    expect((await request(`/api/shopping-items/${id}?version=3`, 'DELETE', b)).status).toBe(204);
    expect(await (await request('/api/shopping-items', 'GET', a)).json()).toEqual([]);
  });

  it('makes POST retries idempotent and rejects conflicting replay content', async () => {
    const body = { id: crypto.randomUUID(), name: 'Eggs' };
    expect((await request('/api/shopping-items', 'POST', a, body)).status).toBe(201);
    expect((await request('/api/shopping-items', 'POST', b, body)).status).toBe(200);
    expect(
      (await request('/api/shopping-items', 'POST', a, { ...body, name: 'Other' })).status,
    ).toBe(409);
    expect(
      (await (await request('/api/shopping-items', 'GET', a)).json<ShoppingItemDto[]>()).length,
    ).toBe(1);
  });

  it('detects stale concurrent update/delete versions and preserves the winning value', async () => {
    const id = crypto.randomUUID();
    await request('/api/shopping-items', 'POST', a, { id, name: 'First' });
    const responses = await Promise.all([
      request(`/api/shopping-items/${id}`, 'PATCH', a, { version: 1, name: 'Alex' }),
      request(`/api/shopping-items/${id}`, 'PATCH', b, { version: 1, name: 'Sam' }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await request(`/api/shopping-items/${id}?version=1`, 'DELETE', a)).status).toBe(409);
    const list = await (await request('/api/shopping-items', 'GET', b)).json<ShoppingItemDto[]>();
    expect(list[0]?.version).toBe(2);
  });

  it('scopes reads and all item mutations to the authenticated household', async () => {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO shopping_items(id,household_id,name,created_at,updated_at) VALUES(?,?,?,?,?)',
    )
      .bind(id, OTHER_HOUSEHOLD, 'Private', Date.now(), Date.now())
      .run();
    expect(await (await request('/api/shopping-items', 'GET', a)).json()).toEqual([]);
    expect(
      (await request(`/api/shopping-items/${id}`, 'PATCH', a, { version: 1, completed: true }))
        .status,
    ).toBe(404);
    expect((await request(`/api/shopping-items/${id}?version=1`, 'DELETE', a)).status).toBe(404);
    expect(
      (
        await request('/api/shopping-items', 'POST', a, {
          id: crypto.randomUUID(),
          name: 'x',
          householdId: OTHER_HOUSEHOLD,
        })
      ).status,
    ).toBe(400);
  });

  it.each([
    { id: 'not-a-uuid', name: 'Milk' },
    { id: '00000000-0000-4000-8000-000000000010', name: ' ' },
    { id: '00000000-0000-4000-8000-000000000010', name: 'x'.repeat(201) },
    { id: '00000000-0000-4000-8000-000000000010', name: 42 },
    { id: '00000000-0000-4000-8000-000000000010', name: '\0Milk' },
  ])('rejects malformed shopping input %j', async (body) => {
    expect((await request('/api/shopping-items', 'POST', a, body)).status).toBe(400);
  });

  it('rejects invalid JSON/type/size and never executes input as SQL', async () => {
    const id = crypto.randomUUID();
    const name = "'); DROP TABLE users; --";
    expect((await request('/api/shopping-items', 'POST', a, { id, name })).status).toBe(201);
    expect(
      (await env.DB.prepare('SELECT count(*) AS total FROM users').first<{ total: number }>())
        ?.total,
    ).toBe(2);
    expect(
      (await request(`/api/shopping-items/${id}`, 'PATCH', a, { version: 1, completed: 'true' }))
        .status,
    ).toBe(400);
    expect((await request(`/api/shopping-items/${id}?version=1.5`, 'DELETE', a)).status).toBe(400);
    expect(
      (
        await request('/api/shopping-items', 'POST', a, {
          id: crypto.randomUUID(),
          name: 'x'.repeat(20_000),
        })
      ).status,
    ).toBe(413);
    const invalid = await worker.fetch(
      new Request(`${env.APP_ORIGIN}/api/shopping-items`, {
        method: 'POST',
        headers: {
          Cookie: a.cookie,
          Origin: env.APP_ORIGIN,
          'X-Family-Hub-CSRF': a.csrf,
          'Content-Type': 'application/json',
        },
        body: '{',
      }),
      env,
    );
    expect(invalid.status).toBe(400);
  });
});

describe('Thanks D1 author permissions, pagination and reactions', () => {
  it('shares persistent posts, supports author edits/deletes and preserves valid ISO dates', async () => {
    const id = crypto.randomUUID();
    const created = await (
      await request('/api/thanks-posts', 'POST', a, { id, message: '  I cooked dinner.  ' })
    ).json<ThanksPostDto>();
    expect(created).toMatchObject({
      id,
      message: 'I cooked dinner.',
      authorId: USER_A,
      version: 1,
      reactions: [],
    });
    expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);
    const page = await (await request('/api/thanks-posts', 'GET', b)).json<ThanksPostsPageDto>();
    expect(page.posts).toEqual([created]);
    expect(
      (await request(`/api/thanks-posts/${id}`, 'PATCH', b, { version: 1, message: 'Hacked' }))
        .status,
    ).toBe(403);
    expect((await request(`/api/thanks-posts/${id}?version=1`, 'DELETE', b)).status).toBe(403);
    const updated = await (
      await request(`/api/thanks-posts/${id}`, 'PATCH', a, {
        version: 1,
        message: 'I also washed up.',
      })
    ).json<ThanksPostDto>();
    expect(updated).toMatchObject({ version: 2, authorId: USER_A, message: 'I also washed up.' });
    expect((await request(`/api/thanks-posts/${id}?version=2`, 'DELETE', a)).status).toBe(204);
    expect(
      (await (await request('/api/thanks-posts', 'GET', b)).json<ThanksPostsPageDto>()).posts,
    ).toEqual([]);
  });

  it('makes create retries idempotent only for the same author and message', async () => {
    const body = { id: crypto.randomUUID(), message: 'Tidied up' };
    expect((await request('/api/thanks-posts', 'POST', a, body)).status).toBe(201);
    expect((await request('/api/thanks-posts', 'POST', a, body)).status).toBe(200);
    expect((await request('/api/thanks-posts', 'POST', b, body)).status).toBe(409);
    expect(
      (await request('/api/thanks-posts', 'POST', a, { ...body, message: 'Different' })).status,
    ).toBe(409);
  });

  it('detects stale post versions', async () => {
    const id = crypto.randomUUID();
    await request('/api/thanks-posts', 'POST', a, { id, message: 'Original' });
    expect(
      (await request(`/api/thanks-posts/${id}`, 'PATCH', a, { version: 1, message: 'Winner' }))
        .status,
    ).toBe(200);
    expect(
      (await request(`/api/thanks-posts/${id}`, 'PATCH', a, { version: 1, message: 'Stale' }))
        .status,
    ).toBe(409);
    expect((await request(`/api/thanks-posts/${id}?version=1`, 'DELETE', a)).status).toBe(409);
  });

  it('allows own-post and multi-code reactions, guarantees uniqueness, and removes only the caller reaction', async () => {
    const id = crypto.randomUUID();
    await request('/api/thanks-posts', 'POST', a, { id, message: 'Done' });
    await request(`/api/thanks-posts/${id}/reactions/thanks`, 'PUT', a);
    await request(`/api/thanks-posts/${id}/reactions/thanks`, 'PUT', a);
    await request(`/api/thanks-posts/${id}/reactions/thanks`, 'PUT', b);
    const reacted = await (
      await request(`/api/thanks-posts/${id}/reactions/heart`, 'PUT', a)
    ).json<ThanksPostDto>();
    expect(reacted.reactions).toHaveLength(3);
    const removed = await (
      await request(`/api/thanks-posts/${id}/reactions/thanks`, 'DELETE', a)
    ).json<ThanksPostDto>();
    expect(removed.reactions).toEqual(
      expect.arrayContaining([
        { userId: USER_B, code: 'thanks' },
        { userId: USER_A, code: 'heart' },
      ]),
    );
    expect(removed.reactions).not.toContainEqual({ userId: USER_A, code: 'thanks' });
    expect((await request(`/api/thanks-posts/${id}/reactions/evil`, 'PUT', a)).status).toBe(400);
    await request(`/api/thanks-posts/${id}?version=1`, 'DELETE', a);
    expect(
      (
        await env.DB.prepare('SELECT count(*) AS total FROM thanks_reactions').first<{
          total: number;
        }>()
      )?.total,
    ).toBe(0);
  });

  it('cannot read or mutate posts/reactions after household membership changes', async () => {
    const id = crypto.randomUUID();
    await request('/api/thanks-posts', 'POST', a, { id, message: 'Private' });
    await env.DB.prepare('UPDATE household_members SET household_id = ? WHERE user_id = ?')
      .bind(OTHER_HOUSEHOLD, USER_B)
      .run();
    expect(
      (await (await request('/api/thanks-posts', 'GET', b)).json<ThanksPostsPageDto>()).posts,
    ).toEqual([]);
    for (const [method, suffix, body] of [
      ['PATCH', '', { version: 1, message: 'Bad' }],
      ['DELETE', '?version=1', undefined],
      ['PUT', '/reactions/thanks', undefined],
      ['DELETE', '/reactions/thanks', undefined],
    ] as const) {
      expect((await request(`/api/thanks-posts/${id}${suffix}`, method, b, body)).status).toBe(404);
    }
  });

  it('paginates newest 50 in ascending display order without duplicate or missing rows', async () => {
    const now = Date.now();
    await env.DB.batch(
      Array.from({ length: 55 }, (_, index) =>
        env.DB.prepare(
          'INSERT INTO thanks_posts(id,household_id,author_id,message,created_at,updated_at) VALUES(?,?,?,?,?,?)',
        ).bind(crypto.randomUUID(), HOUSEHOLD, USER_A, `Post ${index}`, now + index, now + index),
      ),
    );
    const first = await (await request('/api/thanks-posts', 'GET', a)).json<ThanksPostsPageDto>();
    expect(first.posts).toHaveLength(50);
    expect(first.posts[0]?.message).toBe('Post 5');
    expect(first.posts.at(-1)?.message).toBe('Post 54');
    expect(first.nextCursor).not.toBeNull();
    const second = await (
      await request(`/api/thanks-posts?before=${first.nextCursor}`, 'GET', b)
    ).json<ThanksPostsPageDto>();
    expect(second.posts).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.posts, ...second.posts].map((post) => post.id)).size).toBe(55);
    expect((await request('/api/thanks-posts?before=invalid', 'GET', a)).status).toBe(400);
  });

  it('validates message length, author spoofing, and schema constraints', async () => {
    for (const message of ['', ' ', 'x'.repeat(2001), 123]) {
      expect(
        (await request('/api/thanks-posts', 'POST', a, { id: crypto.randomUUID(), message }))
          .status,
      ).toBe(400);
    }
    expect(
      (
        await request('/api/thanks-posts', 'POST', a, {
          id: crypto.randomUUID(),
          message: 'x',
          authorId: USER_B,
        })
      ).status,
    ).toBe(400);
    await expect(
      env.DB.prepare('INSERT INTO users(id,google_sub,display_name,created_at) VALUES(?,?,?,?)')
        .bind(crypto.randomUUID(), 'third-google-sub', 'Third', Date.now())
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        'INSERT INTO shopping_items(id,household_id,name,created_at,updated_at) VALUES(?,?,?,?,?)',
      )
        .bind(crypto.randomUUID(), crypto.randomUUID(), 'No household', Date.now(), Date.now())
        .run(),
    ).rejects.toThrow();
  });
});
