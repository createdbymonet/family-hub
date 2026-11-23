import { applyD1Migrations, reset, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { sha256 } from './crypto';
import { browserSession, request, seedUsers, USER_B } from './test/helpers';

it('applies the additive migration to populated original schema without altering any existing table data', async () => {
  await reset();
  const migrations = (env as typeof env & { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS;
  expect(migrations[0]?.name).toBe('0001_initial.sql');
  await applyD1Migrations(env.DB, migrations.slice(0, 1));
  await seedUsers();
  const a = await browserSession();
  const b = await browserSession(USER_B);
  const itemId = crypto.randomUUID();
  const postId = crypto.randomUUID();
  await request('/api/shopping-items', 'POST', a, { id: itemId, name: 'Keep this shopping item' });
  await request('/api/thanks-posts', 'POST', a, { id: postId, message: 'Keep this Thanks post' });
  await request(`/api/thanks-posts/${postId}/reactions/heart`, 'PUT', b);
  await env.DB.prepare(
    'INSERT INTO oauth_transactions(state_hash,nonce_hash,verifier_hash,browser_hash,return_to,expires_at) VALUES(?,?,?,?,?,?)',
  )
    .bind(
      await sha256('state'),
      await sha256('nonce'),
      await sha256('verifier'),
      await sha256('browser'),
      '/thanks-board',
      Date.now() + 60_000,
    )
    .run();
  const tables = [
    'households',
    'users',
    'household_members',
    'sessions',
    'shopping_items',
    'thanks_posts',
    'thanks_reactions',
    'oauth_transactions',
  ] as const;
  const snapshot = async () =>
    Promise.all(
      tables.map(
        async (table) =>
          (await env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results,
      ),
    );
  const before = await snapshot();
  await applyD1Migrations(env.DB, migrations);
  expect(await snapshot()).toEqual(before);
  expect((await request('/api/auth/session', 'GET', a)).status).toBe(200);
  expect((await request('/api/wishes', 'GET', b)).status).toBe(200);
  expect((await request('/api/notes', 'GET', b)).status).toBe(200);
  expect((await request('/api/user-settings', 'GET', a)).status).toBe(200);
});
