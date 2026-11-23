import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);

/** Validate metadata only. Secret values are neither requested nor included in errors. */
export function verifyProductionAuth(deployments, versions, expected) {
  if (!Array.isArray(deployments) || deployments.length === 0) {
    throw new Error('No production deployment was found. Administrator setup is required.');
  }
  const current = [...deployments].sort(
    (a, b) => Date.parse(b.created_on) - Date.parse(a.created_on),
  )[0];
  const active = current.versions?.filter((version) => version.percentage > 0);
  if (!active?.length || active.reduce((sum, version) => sum + version.percentage, 0) !== 100) {
    throw new Error('The active production deployment could not be verified.');
  }
  for (const activeVersion of active) {
    const version = versions.get(activeVersion.version_id);
    const bindings = version?.resources?.bindings;
    if (!Array.isArray(bindings)) throw new Error('Production version metadata is unavailable.');
    const binding = (name) => bindings.find((entry) => entry.name === name);
    if (binding('GOOGLE_CLIENT_SECRET')?.type !== 'secret_text') {
      throw new Error(
        'Production GOOGLE_CLIENT_SECRET is missing. Stop and follow docs/AUTH-OPERATIONS.md.',
      );
    }
    for (const name of ['APP_ORIGIN', 'GOOGLE_CLIENT_ID']) {
      if (
        !expected[name] ||
        binding(name)?.type !== 'plain_text' ||
        binding(name)?.text !== expected[name]
      ) {
        throw new Error(
          `Production ${name} does not match wrangler.jsonc. Administrator review is required.`,
        );
      }
    }
  }
  return active.map((version) => version.version_id);
}

export async function checkProductionAuth() {
  const { unstable_readConfig } = require('wrangler');
  const configPath = resolve('wrangler.jsonc');
  const config = unstable_readConfig({ config: configPath });
  if (
    config.name !== 'family-hub' ||
    config.vars.APP_ORIGIN !== 'https://family-hub.sumihana.workers.dev'
  ) {
    throw new Error('Unexpected production target. Check wrangler.jsonc before continuing.');
  }
  const cli = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
  const readMetadata = async (args) => {
    try {
      const { stdout } = await execute(
        process.execPath,
        [cli, ...args, '--config', configPath, '--json'],
        {
          maxBuffer: 2 * 1024 * 1024,
          timeout: 30_000,
          windowsHide: true,
        },
      );
      return JSON.parse(stdout);
    } catch {
      // Never forward subprocess stdout/stderr, request headers, or credentials into CI logs.
      throw new Error(
        'Could not read production metadata. Check Cloudflare authentication and Worker read permissions.',
      );
    }
  };
  const deployments = await readMetadata(['deployments', 'list']);
  if (!Array.isArray(deployments) || deployments.length === 0) {
    return verifyProductionAuth(deployments, new Map(), config.vars);
  }
  const current = [...deployments].sort(
    (a, b) => Date.parse(b.created_on) - Date.parse(a.created_on),
  )[0];
  const active = current.versions?.filter((version) => version.percentage > 0) ?? [];
  const versions = new Map();
  for (const version of active) {
    // Version IDs come from the Cloudflare metadata API and are separate argv entries.
    if (!/^[0-9a-f-]{36}$/i.test(version.version_id))
      throw new Error('Invalid production version metadata.');
    versions.set(version.version_id, await readMetadata(['versions', 'view', version.version_id]));
  }
  return verifyProductionAuth(deployments, versions, config.vars);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkProductionAuth().then(
    (versions) =>
      console.log(
        `Production OAuth bindings verified for ${versions.length} active version(s). No secret values were read.`,
      ),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
