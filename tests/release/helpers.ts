import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function tmp(prefix = 'spec0006-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Escreve arquivos (caminho relativo → conteúdo) em `dir`, criando subdiretórios. */
export function writeTree(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
}

export function run(
  cmd: string,
  args: string[],
  env: Record<string, string> = {},
  timeout = 120_000,
) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, ...env },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

export function runNode(args: string[], env: Record<string, string> = {}, timeout = 60_000) {
  const r = spawnSync('node', args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, ...env },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

// ---- Dublê da Chrome Web Store API (fetch injetável) -----------------------------------------

export const ACCESS_TOKEN = 'ya29.FAKE-ACCESS-TOKEN';

export const CREDS = {
  clientId: 'fake-client-id.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-fake-client-secret',
  refreshToken: '1//0g-fake-refresh-token/with+chars',
  extensionId: 'abcdefghijklmnopabcdefghijklmnop',
};

export interface Reply {
  status?: number;
  json: unknown;
}
export interface Call {
  kind: 'token' | 'upload' | 'publish';
  url: URL;
  method: string;
  headers: Headers;
  body: Uint8Array;
}

export interface FakeCws {
  fetch: typeof fetch;
  calls: Call[];
  of(kind: Call['kind']): Call[];
}

/** Roteia por URL: oauth2.googleapis.com → token; `/upload/chromewebstore/` → upload; `/publish` → publish. */
export function fakeCws(routes: { token?: Reply; upload?: Reply; publish?: Reply }): FakeCws {
  const calls: Call[] = [];
  const replies: Record<Call['kind'], Reply> = {
    token: routes.token ?? {
      json: { access_token: ACCESS_TOKEN, expires_in: 3599, token_type: 'Bearer' },
    },
    upload: routes.upload ?? {
      json: { kind: 'chromewebstore#item', id: CREDS.extensionId, uploadState: 'SUCCESS' },
    },
    publish: routes.publish ?? {
      json: { kind: 'chromewebstore#item', item_id: CREDS.extensionId, status: ['OK'] },
    },
  };
  const fakeFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    let kind: Call['kind'];
    if (url.hostname === 'oauth2.googleapis.com') kind = 'token';
    else if (url.pathname.includes('/upload/chromewebstore/')) kind = 'upload';
    else if (url.pathname.endsWith('/publish')) kind = 'publish';
    else throw new Error(`fakeCws: unexpected request ${req.method} ${req.url}`);
    calls.push({
      kind,
      url,
      method: req.method,
      headers: req.headers,
      body: new Uint8Array(await req.arrayBuffer()),
    });
    const reply = replies[kind];
    return new Response(JSON.stringify(reply.json), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fakeFetch, calls, of: (k) => calls.filter((c) => c.kind === k) };
}
