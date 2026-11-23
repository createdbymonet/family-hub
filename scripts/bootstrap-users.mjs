#!/usr/bin/env node
// Offline provisioning: emits SQL for an administrator to review and apply manually.
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export async function inspectGoogleToken(token, clientId) {
  if (typeof token !== 'string' || token.length > 16_384 || !clientId)
    throw new Error('Invalid identity token input.');
  const { payload } = await jwtVerify(
    token.trim(),
    createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')),
    {
      algorithms: ['RS256'],
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: clientId,
      requiredClaims: ['iss', 'aud', 'sub', 'iat', 'exp'],
      maxTokenAge: '10 minutes',
    },
  );
  if (
    typeof payload.sub !== 'string' ||
    payload.sub.length < 1 ||
    payload.sub.length > 255 ||
    (payload.azp !== undefined && payload.azp !== clientId) ||
    (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)
  )
    throw new Error('Invalid identity token claims.');
  return { sub: payload.sub };
}

export function bootstrapSql({ householdName, users }, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid timestamp.');
  const text = (value, max) => {
    if (
      typeof value !== 'string' ||
      value.trim().length < 1 ||
      value.trim().length > max ||
      /[\u0000-\u001f]/u.test(value)
    ) {
      throw new Error('Invalid bootstrap input.');
    }
    return value.trim();
  };
  if (!Array.isArray(users) || users.length !== 2)
    throw new Error('Exactly two users are required.');
  const normalized = users.map((user) => ({
    sub: text(user.sub, 255),
    displayName: text(user.displayName, 100),
  }));
  if (normalized[0].sub === normalized[1].sub)
    throw new Error('The Google subjects must be different.');
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  const householdId = randomUUID();
  const statements = [
    '-- Private provisioning data: review locally. Never commit or publish this output.',
    '-- Apply only to an empty, migrated database. A repeat application fails safely.',
    '-- One INSERT plus trigger is atomic; D1 does not accept SQL BEGIN/COMMIT.',
    '-- If interrupted, inspect and remove family_hub_bootstrap_once before retrying.',
    'CREATE TRIGGER family_hub_bootstrap_once AFTER INSERT ON households BEGIN',
    "SELECT CASE WHEN (SELECT count(*) FROM households) != 1 OR (SELECT count(*) FROM users) != 0 OR (SELECT count(*) FROM household_members) != 0 THEN RAISE(ABORT, 'Bootstrap requires an empty database') END;",
  ];
  for (const [index, user] of normalized.entries()) {
    const id = randomUUID();
    statements.push(
      `INSERT INTO users(id,google_sub,display_name,created_at) VALUES(${quote(id)},${quote(user.sub)},${quote(user.displayName)},${now});`,
    );
    statements.push(
      `INSERT INTO household_members(household_id,user_id,role) VALUES(NEW.id,${quote(id)},${quote(index === 0 ? 'owner' : 'member')});`,
    );
  }
  statements.push('END;');
  statements.push(
    `INSERT INTO households(id,name,created_at) VALUES(${quote(householdId)},${quote(text(householdName, 100))},${now});`,
  );
  statements.push('DROP TRIGGER family_hub_bootstrap_once;');
  return statements.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--inspect-google-token') {
    try {
      let token = '';
      for await (const chunk of process.stdin) {
        token += chunk.toString();
        if (token.length > 16_384) throw new Error('Too much input');
      }
      console.log(JSON.stringify(await inspectGoogleToken(token, process.argv[3])));
    } catch {
      console.error('The Google identity token could not be verified. No database was changed.');
      process.exitCode = 1;
    }
  } else if (!process.stdin.isTTY || process.argv.length !== 2) {
    console.error('Run interactively. Do not pass private Google subjects in shell arguments.');
    process.exitCode = 1;
  } else {
    const prompt = createInterface({ input: process.stdin, output: process.stderr });
    try {
      console.error(
        'Offline provisioning only. SQL stdout contains personal identifiers; keep it outside the repository.',
      );
      const householdName = await prompt.question('Household name: ');
      const users = [];
      for (let i = 1; i <= 2; i++) {
        users.push({
          sub: await prompt.question(`User ${i} verified Google sub: `),
          displayName: await prompt.question(`User ${i} display name: `),
        });
      }
      console.log(bootstrapSql({ householdName, users }));
    } catch {
      console.error('Provisioning input was rejected. No database was changed.');
      process.exitCode = 1;
    } finally {
      prompt.close();
    }
  }
}
