// SPEC-0006 — uso: node scripts/release/cli.ts <verify-version|flavor-guard|webstore> ...
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkFlavorGuard } from './flavor-guard.ts';
import { formatError } from './redact.ts';
import { verifyVersion, versionFromTag } from './version.ts';
import { releaseToStore, type WebstoreCreds } from './webstore.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const SECRET_ENV = [
  'CWS_CLIENT_ID',
  'CWS_CLIENT_SECRET',
  'CWS_REFRESH_TOKEN',
  'CWS_PUBLISHER_ID',
  'CWS_EXTENSION_ID',
];

/** Lista única de segredos para todo caminho de erro (o access token é mascarado dentro de webstore.ts). */
function secretValues(): string[] {
  return SECRET_ENV.map((name) => process.env[name] ?? '');
}

function usage(): never {
  throw new Error(
    'uso: cli.ts verify-version <tag> | flavor-guard <distDir> | webstore <zip> <tag>',
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`variável de ambiente ${name} ausente`);
  return value;
}

async function main(argv: string[]): Promise<void> {
  const [command, a, b] = argv;
  switch (command) {
    case 'verify-version': {
      if (!a) usage();
      const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
        version: string;
      };
      const info = verifyVersion(a, pkg.version);
      console.log(`versão ${info.version} ok (${info.prerelease ? 'prerelease' : 'estável'})`);
      return;
    }
    case 'flavor-guard': {
      if (!a) usage();
      const dirs = [resolve(ROOT, 'src/providers')].filter((d) => existsSync(d));
      const extra = process.env['PROVIDERS_EXTRA_DIR'];
      if (extra) dirs.push(resolve(extra));
      if (dirs.length === 0) {
        throw new Error(
          'NO_PROVIDERS_FOUND: src/providers ausente e PROVIDERS_EXTRA_DIR não definido',
        );
      }
      checkFlavorGuard({ distDir: resolve(a), providersDir: dirs });
      console.log(`flavor-guard ok: ${a}`);
      return;
    }
    case 'webstore': {
      if (!a || !b) usage();
      const version = versionFromTag(b);
      const creds: WebstoreCreds = {
        clientId: requireEnv('CWS_CLIENT_ID'),
        clientSecret: requireEnv('CWS_CLIENT_SECRET'),
        refreshToken: requireEnv('CWS_REFRESH_TOKEN'),
        publisherId: requireEnv('CWS_PUBLISHER_ID'),
        extensionId: requireEnv('CWS_EXTENSION_ID'),
      };
      const result = await releaseToStore(resolve(a), version, creds, { fetch });
      console.log(`Chrome Web Store: ${version} enviada, estado ${result.state}`);
      return;
    }
    default:
      usage();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(formatError(error, secretValues()));
  process.exit(1);
});
