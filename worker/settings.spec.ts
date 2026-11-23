import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_USER_SETTINGS, THEMES, type UserSettingsDto } from '../shared/contracts';
import { browserSession, request, seedUsers, USER_B, type BrowserSession } from './test/helpers';

let a: BrowserSession;
let b: BrowserSession;
beforeEach(async () => {
  await seedUsers();
  a = await browserSession();
  b = await browserSession(USER_B);
});

describe('personal user settings', () => {
  it('returns defaults for both users without writing during GET', async () => {
    expect(await (await request('/api/user-settings', 'GET', a)).json()).toEqual(
      DEFAULT_USER_SETTINGS,
    );
    expect(await (await request('/api/user-settings', 'GET', b)).json()).toEqual(
      DEFAULT_USER_SETTINGS,
    );
    expect(
      (
        await env.DB.prepare('SELECT count(*) AS total FROM user_settings').first<{
          total: number;
        }>()
      )?.total,
    ).toBe(0);
  });

  it.each(THEMES)(
    'persists $id independently across requests and re-login while the spouse stays unchanged',
    async (theme) => {
      const response = await request('/api/user-settings', 'PATCH', a, {
        version: 1,
        theme: theme.id,
        showCompletedShoppingItems: true,
        showAchievedWishes: true,
        showResolvedNotes: true,
      });
      expect(response.status).toBe(200);
      const saved = await response.json<UserSettingsDto>();
      expect(saved).toEqual({
        theme: theme.id,
        showCompletedShoppingItems: true,
        showAchievedWishes: true,
        showResolvedNotes: true,
        version: 2,
      });
      expect(await (await request('/api/user-settings', 'GET', a)).json()).toEqual(saved);
      expect(
        await (await request('/api/user-settings', 'GET', await browserSession())).json(),
      ).toEqual(saved);
      expect(await (await request('/api/user-settings', 'GET', b)).json()).toEqual(
        DEFAULT_USER_SETTINGS,
      );
    },
  );

  it('changes display preferences separately without resetting the theme or other flags', async () => {
    await request('/api/user-settings', 'PATCH', a, { version: 1, theme: 'EDOGAWA' });
    await request('/api/user-settings', 'PATCH', a, {
      version: 2,
      showCompletedShoppingItems: true,
    });
    await request('/api/user-settings', 'PATCH', a, { version: 3, showAchievedWishes: true });
    await request('/api/user-settings', 'PATCH', a, { version: 4, showResolvedNotes: true });
    const response = await request('/api/user-settings', 'PATCH', a, {
      version: 5,
      showCompletedShoppingItems: false,
    });
    expect(await response.json()).toEqual({
      theme: 'EDOGAWA',
      showCompletedShoppingItems: false,
      showAchievedWishes: true,
      showResolvedNotes: true,
      version: 6,
    });
  });

  it('prevents lost updates including concurrent first saves', async () => {
    const responses = await Promise.all([
      request('/api/user-settings', 'PATCH', a, { version: 1, theme: 'CHARLOTTE' }),
      request('/api/user-settings', 'PATCH', a, { version: 1, theme: 'EDOGAWA' }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      (await request('/api/user-settings', 'PATCH', a, { version: 1, showResolvedNotes: true }))
        .status,
    ).toBe(409);
    const saved = await (await request('/api/user-settings', 'GET', a)).json<UserSettingsDto>();
    expect(saved.version).toBe(2);
    expect(saved.showResolvedNotes).toBe(false);
  });

  it('derives identity only from the session and rejects client user IDs or unknown fields', async () => {
    for (const body of [
      { version: 1, userId: USER_B, theme: 'EDOGAWA' },
      { version: 1, user_id: USER_B, theme: 'EDOGAWA' },
      { version: 1, householdId: 'anything', showResolvedNotes: true },
    ])
      expect((await request('/api/user-settings', 'PATCH', a, body)).status).toBe(400);
    expect((await request(`/api/user-settings/${USER_B}`, 'GET', a)).status).toBe(404);
    await request('/api/user-settings', 'PATCH', b, { version: 1, theme: 'EDOGAWA' });
    expect(await (await request('/api/user-settings', 'GET', a)).json()).toEqual(
      DEFAULT_USER_SETTINGS,
    );
  });

  it.each([
    { version: 1 },
    { version: 0, theme: 'KAWASAKI' },
    { version: '1', theme: 'KAWASAKI' },
    { version: 1, theme: 'unknown' },
    { version: 1, theme: null },
    { version: 1, showCompletedShoppingItems: 'true' },
    { version: 1, showAchievedWishes: 1 },
    { version: 1, showResolvedNotes: null },
  ])('validates setting fields %j before any persistence', async (body) => {
    expect((await request('/api/user-settings', 'PATCH', a, body)).status).toBe(400);
    expect(
      (
        await env.DB.prepare('SELECT count(*) AS total FROM user_settings').first<{
          total: number;
        }>()
      )?.total,
    ).toBe(0);
  });

  it('requires authentication and CSRF and has no public demo or arbitrary-user endpoint', async () => {
    expect((await request('/api/user-settings')).status).toBe(401);
    expect(
      (await request('/api/user-settings', 'PATCH', undefined, { version: 1, theme: 'EDOGAWA' }))
        .status,
    ).toBe(401);
    expect(
      (
        await request(
          '/api/user-settings',
          'PATCH',
          a,
          { version: 1, theme: 'EDOGAWA' },
          { 'X-Family-Hub-CSRF': 'wrong' },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          '/api/user-settings',
          'PATCH',
          a,
          { version: 1, theme: 'EDOGAWA' },
          { Origin: 'https://evil.test' },
        )
      ).status,
    ).toBe(403);
    expect((await request('/api/demo/user-settings')).status).toBe(404);
    expect((await request('/api/user-settings', 'POST', a, { version: 1 })).status).toBe(405);
  });
});
