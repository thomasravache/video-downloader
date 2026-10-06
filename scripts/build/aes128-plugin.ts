/**
 * Plugin de build para módulos virtuais AES-128 (SPEC-0017).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Flavor } from '../../src/core/contracts';

export const POLICY_VIRTUAL_ID = 'virtual:aes128-policy';
const RESOLVED_POLICY_ID = `\0${POLICY_VIRTUAL_ID}`;

export const DECRYPT_VIRTUAL_ID = 'virtual:aes128-decrypt';
const RESOLVED_DECRYPT_ID = `\0${DECRYPT_VIRTUAL_ID}`;

export function getPublicPolicyStub(): string {
  return 'export const keyPolicy = undefined;\n';
}

export function getPublicDecryptStub(): string {
  return 'export const aes128Handler = undefined;\n';
}

export function getLocalPolicySource(root: string): string {
  const file = join(root, 'src/aes128/classify.ts');
  return `export { keyPolicy } from ${JSON.stringify(file)};\n`;
}

export function getLocalDecryptSource(root: string): string {
  const file = join(root, 'src/aes128/index.ts');
  return `export * from ${JSON.stringify(file)};\n`;
}

export function aes128Plugin(options: { flavor: Flavor; root: string }) {
  return {
    name: 'video-downloader:aes128',
    resolveId(id: string): string | undefined {
      if (id === POLICY_VIRTUAL_ID) return RESOLVED_POLICY_ID;
      if (id === DECRYPT_VIRTUAL_ID) return RESOLVED_DECRYPT_ID;
      return undefined;
    },
    load(id: string): string | undefined {
      if (id === RESOLVED_POLICY_ID) {
        return options.flavor === 'local'
          ? getLocalPolicySource(options.root)
          : getPublicPolicyStub();
      }
      if (id === RESOLVED_DECRYPT_ID) {
        return options.flavor === 'local'
          ? getLocalDecryptSource(options.root)
          : getPublicDecryptStub();
      }
      return undefined;
    },
  };
}

export function writeAes128PolicyModule(options: { root: string; flavor: Flavor }): string {
  const dir = join(options.root, 'node_modules/.cache/video-downloader');
  const file = join(dir, `aes128-policy.${options.flavor}.js`);
  const source =
    options.flavor === 'local' ? getLocalPolicySource(options.root) : getPublicPolicyStub();
  mkdirSync(dir, { recursive: true });
  if (!existsSync(file) || readFileSync(file, 'utf8') !== source) {
    writeFileSync(file, source);
  }
  return file;
}

export function writeAes128DecryptModule(options: { root: string; flavor: Flavor }): string {
  const dir = join(options.root, 'node_modules/.cache/video-downloader');
  const file = join(dir, `aes128-decrypt.${options.flavor}.js`);
  const source =
    options.flavor === 'local' ? getLocalDecryptSource(options.root) : getPublicDecryptStub();
  mkdirSync(dir, { recursive: true });
  if (!existsSync(file) || readFileSync(file, 'utf8') !== source) {
    writeFileSync(file, source);
  }
  return file;
}
