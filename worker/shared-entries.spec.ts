import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { WishlistItemDto } from '../shared/contracts';
import {
  browserSession,
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

const features = [
  {
    path: '/api/wishes',
    text: 'memo',
    content: 'A quiet weekend together',
    initial: 'pending',
    finished: 'achieved',
    timestamp: 'achievedAt',
    table: 'wishlist_items',
    dbTimestamp: 'achieved_at',
  },
  {
    path: '/api/notes',
    text: 'body',
    content: 'First line\nSecond line',
    initial: 'open',
    finished: 'resolved',
    timestamp: 'resolvedAt',
    table: 'notes',
    dbTimestamp: 'resolved_at',
  },
] as const;

describe.each(features)('$path shared household entries', (feature) => {
  type Entry = Omit<WishlistItemDto, 'status' | 'achievedAt' | 'memo'> & {
    status: string;
    achievedAt?: string | null;
    resolvedAt?: string | null;
    memo?: string;
    body?: string;
  };
  const createBody = (id = crypto.randomUUID()) => ({
    id,
    title: '  A little plan  ',
    [feature.text]: `  ${feature.content}  `,
  });

  it('creates trimmed content and shares author metadata, details and persistent edits with the spouse', async () => {
    const body = createBody();
    const response = await request(feature.path, 'POST', a, body);
    expect(response.status).toBe(201);
    const created = await response.json<Entry>();
    expect(created).toMatchObject({
      id: body.id,
      title: 'A little plan',
      [feature.text]: feature.content,
      status: feature.initial,
      authorId: USER_A,
      authorName: 'Alex',
      version: 1,
      [feature.timestamp]: null,
    });
    expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);
    expect(await (await request(feature.path, 'GET', b)).json()).toEqual([created]);
    expect(await (await request(`${feature.path}/${body.id}`, 'GET', b)).json()).toEqual(created);
    const updated = await (
      await request(`${feature.path}/${body.id}`, 'PATCH', b, {
        version: 1,
        title: 'Our updated plan',
        [feature.text]: 'New text\nwith a newline',
      })
    ).json<Entry>();
    expect(updated).toMatchObject({
      version: 2,
      title: 'Our updated plan',
      [feature.text]: 'New text\nwith a newline',
      authorId: USER_A,
      authorName: 'Alex',
    });
    expect((await request(`${feature.path}/${body.id}?version=2`, 'DELETE', b)).status).toBe(204);
    expect(await (await request(feature.path, 'GET', a)).json()).toEqual([]);
  });

  it('preserves finished timestamps when editing and removes them on undo, without deleting history', async () => {
    const body = createBody();
    await request(feature.path, 'POST', a, body);
    const finished = await (
      await request(`${feature.path}/${body.id}`, 'PATCH', b, {
        version: 1,
        status: feature.finished,
      })
    ).json<Entry>();
    expect(finished.status).toBe(feature.finished);
    const time = finished[feature.timestamp];
    expect(typeof time).toBe('string');
    expect(new Date(time!).toISOString()).toBe(time);
    const edited = await (
      await request(`${feature.path}/${body.id}`, 'PATCH', a, {
        version: 2,
        title: 'Still finished',
        status: feature.finished,
      })
    ).json<Entry>();
    expect(edited[feature.timestamp]).toBe(time);
    expect((await (await request(feature.path, 'GET', b)).json<Entry[]>()).length).toBe(1);
    const undone = await (
      await request(`${feature.path}/${body.id}`, 'PATCH', b, {
        version: 3,
        status: feature.initial,
      })
    ).json<Entry>();
    expect(undone).toMatchObject({
      version: 4,
      status: feature.initial,
      [feature.timestamp]: null,
      authorId: USER_A,
    });
  });

  it('lists unfinished entries first even when a finished entry was edited more recently', async () => {
    const first = createBody();
    const second = createBody();
    await request(feature.path, 'POST', a, first);
    await request(feature.path, 'POST', a, second);
    await request(`${feature.path}/${first.id}`, 'PATCH', b, {
      version: 1,
      status: feature.finished,
    });
    const list = await (await request(feature.path, 'GET', b)).json<Entry[]>();
    expect(list.map((entry) => entry.id)).toEqual([second.id, first.id]);
  });

  it('accepts identical create retries only for the original author and content', async () => {
    const body = createBody();
    expect((await request(feature.path, 'POST', a, body)).status).toBe(201);
    expect((await request(feature.path, 'POST', a, body)).status).toBe(200);
    expect((await request(feature.path, 'POST', b, body)).status).toBe(409);
    expect((await request(feature.path, 'POST', a, { ...body, title: 'Different' })).status).toBe(
      409,
    );
    expect(
      (await request(feature.path, 'POST', a, { ...body, [feature.text]: 'Different' })).status,
    ).toBe(409);
    expect((await (await request(feature.path, 'GET', a)).json<Entry[]>()).length).toBe(1);
  });

  it('allows only one winner for concurrent edits and rejects stale deletes', async () => {
    const body = createBody();
    await request(feature.path, 'POST', a, body);
    const results = await Promise.all([
      request(`${feature.path}/${body.id}`, 'PATCH', a, { version: 1, title: 'Alex update' }),
      request(`${feature.path}/${body.id}`, 'PATCH', b, { version: 1, title: 'Sam update' }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect((await request(`${feature.path}/${body.id}?version=1`, 'DELETE', a)).status).toBe(409);
    expect(
      (await (await request(`${feature.path}/${body.id}`, 'GET', b)).json<Entry>()).version,
    ).toBe(2);
  });

  it('hides other households on list, detail, create replay, edit and delete', async () => {
    await env.DB.prepare('UPDATE household_members SET household_id = ? WHERE user_id = ?')
      .bind(OTHER_HOUSEHOLD, USER_B)
      .run();
    const body = createBody();
    expect((await request(feature.path, 'POST', b, body)).status).toBe(201);
    expect(await (await request(feature.path, 'GET', a)).json()).toEqual([]);
    expect((await request(`${feature.path}/${body.id}`, 'GET', a)).status).toBe(404);
    expect((await request(feature.path, 'POST', a, body)).status).toBe(404);
    expect(
      (
        await request(`${feature.path}/${body.id}`, 'PATCH', a, {
          version: 1,
          status: feature.finished,
        })
      ).status,
    ).toBe(404);
    expect((await request(`${feature.path}/${body.id}?version=1`, 'DELETE', a)).status).toBe(404);
    const remaining = await (await request(`${feature.path}/${body.id}`, 'GET', b)).json<Entry>();
    expect(remaining.version).toBe(1);
  });

  it('requires sessions on every route and enforces CSRF on every mutation', async () => {
    const body = createBody();
    for (const [path, method, input] of [
      [feature.path, 'GET', undefined],
      [feature.path, 'POST', body],
      [`${feature.path}/${body.id}`, 'GET', undefined],
      [`${feature.path}/${body.id}`, 'PATCH', { version: 1, title: 'x' }],
      [`${feature.path}/${body.id}?version=1`, 'DELETE', undefined],
    ] as const) {
      const response = await request(path, method, undefined, input);
      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toContain('no-store');
    }
    await request(feature.path, 'POST', a, body);
    for (const [path, method, input] of [
      [feature.path, 'POST', createBody()],
      [`${feature.path}/${body.id}`, 'PATCH', { version: 1, title: 'x' }],
      [`${feature.path}/${body.id}?version=1`, 'DELETE', undefined],
    ] as const) {
      expect((await request(path, method, a, input, { 'X-Family-Hub-CSRF': 'wrong' })).status).toBe(
        403,
      );
      expect((await request(path, method, a, input, { Origin: 'https://evil.test' })).status).toBe(
        403,
      );
    }
  });

  it('rejects malformed title, content, identity injection, status and versions', async () => {
    const body = createBody();
    for (const invalid of [
      { ...body, id: 'wrong' },
      { ...body, title: '' },
      { ...body, title: 'x'.repeat(201) },
      { ...body, title: 5 },
      { ...body, title: '\0title' },
      { ...body, [feature.text]: 5 },
      { ...body, [feature.text]: '\0text' },
      { ...body, [feature.text]: 'x'.repeat(feature.text === 'body' ? 4001 : 1001) },
      { ...body, authorId: USER_B },
      { ...body, householdId: OTHER_HOUSEHOLD },
      { ...body, status: feature.finished },
    ])
      expect((await request(feature.path, 'POST', a, invalid)).status).toBe(400);
    await request(feature.path, 'POST', a, body);
    for (const patch of [
      { version: 1 },
      { version: 0, title: 'x' },
      { version: 1.5, title: 'x' },
      { version: '1', title: 'x' },
      { version: 1, status: null },
      { version: 1, status: 'invalid' },
      { version: 1, title: ' ' },
      { version: 1, authorId: USER_B },
      { version: 1, [feature.text]: '\0' },
    ])
      expect((await request(`${feature.path}/${body.id}`, 'PATCH', a, patch)).status).toBe(400);
    for (const version of ['', '1.5', '-1', 'x', '9007199254740992'])
      expect(
        (await request(`${feature.path}/${body.id}?version=${version}`, 'DELETE', a)).status,
      ).toBe(400);
    expect((await request(`${feature.path}/not-an-id`, 'GET', a)).status).toBe(400);
    expect((await request(`${feature.path}/${crypto.randomUUID()}`, 'GET', a)).status).toBe(404);
    expect((await request(feature.path, 'PUT', a, body)).status).toBe(405);
    expect((await request(`${feature.path}/${body.id}`, 'POST', a, body)).status).toBe(405);
  });

  it('binds SQL-like content and keeps existing shopping, Thanks and session data intact', async () => {
    const shoppingId = crypto.randomUUID();
    const postId = crypto.randomUUID();
    await request('/api/shopping-items', 'POST', a, { id: shoppingId, name: 'Existing milk' });
    await request('/api/thanks-posts', 'POST', a, { id: postId, message: 'Existing thanks' });
    const body = { ...createBody(), title: "'); DROP TABLE users; --" };
    expect((await request(feature.path, 'POST', a, body)).status).toBe(201);
    expect(
      (await env.DB.prepare('SELECT count(*) AS total FROM users').first<{ total: number }>())
        ?.total,
    ).toBe(2);
    expect((await request('/api/auth/session', 'GET', a)).status).toBe(200);
    expect(
      (await (await request('/api/shopping-items', 'GET', b)).json<{ id: string }[]>())[0]?.id,
    ).toBe(shoppingId);
    expect(
      (await (await request('/api/thanks-posts', 'GET', b)).json<{ posts: { id: string }[] }>())
        .posts[0]?.id,
    ).toBe(postId);
  });
});

it('allows an omitted or empty wish memo and requires a nonblank note body', async () => {
  const wish = await request('/api/wishes', 'POST', a, {
    id: crypto.randomUUID(),
    title: 'Go somewhere',
  });
  expect(wish.status).toBe(201);
  expect((await wish.json<WishlistItemDto>()).memo).toBe('');
  for (const body of [undefined, '', '  ']) {
    expect(
      (
        await request('/api/notes', 'POST', a, {
          id: crypto.randomUUID(),
          title: 'Information',
          body,
        })
      ).status,
    ).toBe(400);
  }
});

it('accepts maximum-size Unicode notes and rejects envelopes over the bounded limit', async () => {
  const body = { id: crypto.randomUUID(), title: '日'.repeat(200), body: '日'.repeat(4000) };
  expect((await request('/api/notes', 'POST', a, body)).status).toBe(201);
  expect(
    (
      await request('/api/notes', 'POST', a, {
        ...body,
        id: crypto.randomUUID(),
        body: 'x'.repeat(33_000),
      })
    ).status,
  ).toBe(413);
});
