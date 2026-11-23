import { applyD1Migrations, reset, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(async () => {
  await reset();
  const bindings = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };
  await applyD1Migrations(env.DB, bindings.TEST_MIGRATIONS);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
