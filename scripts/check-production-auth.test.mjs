import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyProductionAuth } from './check-production-auth.mjs';

const expected = { APP_ORIGIN: 'https://example.test', GOOGLE_CLIENT_ID: 'test-client' };
const bindings = [
  { name: 'APP_ORIGIN', type: 'plain_text', text: expected.APP_ORIGIN },
  { name: 'GOOGLE_CLIENT_ID', type: 'plain_text', text: expected.GOOGLE_CLIENT_ID },
  { name: 'GOOGLE_CLIENT_SECRET', type: 'secret_text' },
];
const deployed = [
  { created_on: '2026-11-23T20:20:00Z', versions: [{ version_id: 'live', percentage: 100 }] },
];
const snapshot = (entries = bindings) => new Map([['live', { resources: { bindings: entries } }]]);

test('production metadata check accepts the current active version without reading secret values', () => {
  assert.deepEqual(verifyProductionAuth(deployed, snapshot(), expected), ['live']);
});

test('production metadata check chooses the newest deployment rather than the first API result', () => {
  const older = {
    created_on: '2026-10-01T00:00:00Z',
    versions: [{ version_id: 'old', percentage: 100 }],
  };
  assert.deepEqual(verifyProductionAuth([older, ...deployed], snapshot(), expected), ['live']);
});

test('a secret on an undeployed version cannot satisfy the production metadata check', () => {
  const versions = snapshot(bindings.filter((binding) => binding.name !== 'GOOGLE_CLIENT_SECRET'));
  versions.set('staged', { resources: { bindings } });
  assert.throws(
    () => verifyProductionAuth(deployed, versions, expected),
    /GOOGLE_CLIENT_SECRET is missing/,
  );
});

test('plaintext secrets are rejected and their values never appear in diagnostic errors', () => {
  const versions = snapshot(
    bindings.map((binding) =>
      binding.name === 'GOOGLE_CLIENT_SECRET'
        ? { ...binding, type: 'plain_text', text: 'do-not-print-secret' }
        : binding,
    ),
  );
  assert.throws(
    () => verifyProductionAuth(deployed, versions, expected),
    (error) => {
      assert.doesNotMatch(error.message, /do-not-print-secret/);
      assert.match(error.message, /GOOGLE_CLIENT_SECRET is missing/);
      return true;
    },
  );
});

test('each version receiving production traffic must contain the required bindings', () => {
  const split = [
    {
      created_on: '2026-11-23T20:20:00Z',
      versions: [
        { version_id: 'live', percentage: 90 },
        { version_id: 'older', percentage: 10 },
      ],
    },
  ];
  const versions = snapshot();
  versions.set('older', { resources: { bindings: [] } });
  assert.throws(() => verifyProductionAuth(split, versions, expected), /GOOGLE_CLIENT_SECRET/);
});

test('production origin and client ID must match the reviewed Wrangler configuration', () => {
  for (const name of ['APP_ORIGIN', 'GOOGLE_CLIENT_ID']) {
    assert.throws(
      () => verifyProductionAuth(deployed, snapshot(), { ...expected, [name]: 'different' }),
      new RegExp(name),
    );
  }
});

test('empty, unavailable, and incomplete production deployment metadata fail closed', () => {
  assert.throws(() => verifyProductionAuth([], new Map(), expected), /No production deployment/);
  assert.throws(
    () => verifyProductionAuth(deployed, new Map(), expected),
    /metadata is unavailable/,
  );
  assert.throws(
    () => verifyProductionAuth([{ versions: [] }], new Map(), expected),
    /could not be verified/,
  );
  assert.throws(
    () =>
      verifyProductionAuth(
        [{ versions: [{ version_id: 'live', percentage: 50 }] }],
        snapshot(),
        expected,
      ),
    /could not be verified/,
  );
});
