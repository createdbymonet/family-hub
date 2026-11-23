import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  // Dynamic import also supports the existing package.json CommonJS config context.
  const { cloudflareTest, readD1Migrations } = await import('@cloudflare/vitest-plugin');
  return {
    plugins: [
      cloudflareTest(async () => ({
        wrangler: { configPath: './wrangler.test.jsonc' },
        miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations('./migrations') } },
      })),
    ],
    test: {
      include: ['worker/**/*.spec.ts'],
      setupFiles: ['./worker/test/setup.ts'],
      fileParallelism: false,
      testTimeout: 15_000,
    },
  };
});
