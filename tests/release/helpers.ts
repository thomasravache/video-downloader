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

// ---- Dublê da Chrome Web Store API v2 (fetch injetável) --------------------------------------

export const ACCESS_TOKEN = 'ya29.FAKE-ACCESS-TOKEN';

export const CREDS = {
  clientId: 'fake-client-id.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-fake-client-secret',
  refreshToken: '1//0g-fake-refresh-token/with+chars',
  publisherId: 'fake-publisher-id',
  extensionId: 'abcdefghijklmnopabcdefghijklmnop',
};

export interface Reply {
  status?: number;
  json: unknown;
}
export type CallKind = 'token' | 'upload' | 'status' | 'publish';
export interface Call {
  kind: CallKind;
  url: URL;
  method: string;
  headers: Headers;
  body: Uint8Array;
}

export interface FakeCws {
  fetch: typeof fetch;
  calls: Call[];
  of(kind: CallKind): Call[];
}

type Route = Reply | Reply[];

/**
 * Roteia por URL: oauth2.googleapis.com → token; `/upload/v2/...:upload` → upload;
 * `...:fetchStatus` → status; `...:publish` → publish. Uma rota pode ser uma lista de respostas,
 * consumidas em ordem (a última se repete).
 */
export function fakeCws(routes: {
  token?: Route;
  upload?: Route;
  status?: Route;
  publish?: Route;
}): FakeCws {
  const calls: Call[] = [];
  const replies: Record<CallKind, Reply[]> = {
    token: [].concat(
      (routes.token ?? {
        json: { access_token: ACCESS_TOKEN, expires_in: 3599, token_type: 'Bearer' },
      }) as never,
    ),
    upload: [].concat(
      (routes.upload ?? {
        json: {
          name: `publishers/${CREDS.publisherId}/items/${CREDS.extensionId}`,
          uploadState: 'SUCCEEDED',
          crxVersion: '0.1.0',
          itemId: CREDS.extensionId,
        },
      }) as never,
    ),
    status: [].concat(
      (routes.status ?? {
        json: { itemId: CREDS.extensionId, lastAsyncUploadState: 'SUCCEEDED' },
      }) as never,
    ),
    publish: [].concat(
      (routes.publish ?? {
        json: {
          name: `publishers/${CREDS.publisherId}/items/${CREDS.extensionId}`,
          itemId: CREDS.extensionId,
          state: 'PENDING_REVIEW',
        },
      }) as never,
    ),
  };
  const fakeFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    let kind: CallKind;
    if (url.hostname === 'oauth2.googleapis.com') kind = 'token';
    else if (url.hostname !== 'chromewebstore.googleapis.com')
      throw new Error(`fakeCws: unexpected host ${req.method} ${req.url}`);
    else if (url.pathname.endsWith(':upload')) kind = 'upload';
    else if (url.pathname.endsWith(':fetchStatus')) kind = 'status';
    else if (url.pathname.endsWith(':publish')) kind = 'publish';
    else throw new Error(`fakeCws: unexpected request ${req.method} ${req.url}`);
    const seen = calls.filter((c) => c.kind === kind).length;
    calls.push({
      kind,
      url,
      method: req.method,
      headers: req.headers,
      body: new Uint8Array(await req.arrayBuffer()),
    });
    const list = replies[kind];
    const reply = list[Math.min(seen, list.length - 1)] as Reply;
    return new Response(JSON.stringify(reply.json), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fakeFetch, calls, of: (k) => calls.filter((c) => c.kind === k) };
}

/** Relógio falso: `sleep` avança `now` sem esperar de verdade. */
export function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}
