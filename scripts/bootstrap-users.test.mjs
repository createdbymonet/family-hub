import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bootstrapSql, inspectGoogleToken } from './bootstrap-users.mjs';

test('offline bootstrap requires exactly two distinct accounts and rejects invalid input', () => {
  const first = { sub: 'google-sub-a', displayName: 'Alex' };
  assert.throws(() => bootstrapSql({ householdName: 'Family', users: [first] }));
  assert.throws(() => bootstrapSql({ householdName: 'Family', users: [first, first] }));
  assert.throws(() =>
    bootstrapSql({
      householdName: '\u0000',
      users: [first, { sub: 'google-sub-b', displayName: 'Sam' }],
    }),
  );
});

test('offline SQL quotes all values and provisions through one atomic INSERT trigger', () => {
  const sql = bootstrapSql({
    householdName: "O'Neil household",
    users: [
      { sub: 'google-sub-a', displayName: "Alex's" },
      { sub: 'google-sub-b', displayName: 'Sam' },
    ],
  });
  assert.match(sql, /O''Neil household/);
  assert.match(sql, /Alex''s/);
  assert.match(sql, /CREATE TRIGGER family_hub_bootstrap_once/);
  assert.match(sql, /Bootstrap requires an empty database/);
  assert.match(sql, /DROP TRIGGER family_hub_bootstrap_once/);
  assert.doesNotMatch(sql, /BEGIN TRANSACTION;|COMMIT;/);
  assert.equal((sql.match(/INSERT INTO users/g) ?? []).length, 2);
});

test('offline token inspection rejects unverified, missing-audience and oversized tokens', async () => {
  await assert.rejects(inspectGoogleToken('', 'test-client-id'));
  await assert.rejects(inspectGoogleToken('anything', ''));
  await assert.rejects(inspectGoogleToken('x'.repeat(16_385), 'test-client-id'));
});
