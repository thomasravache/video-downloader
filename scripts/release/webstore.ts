// SPEC-0006 — cliente mínimo da Chrome Web Store API v2 (sem dependências; fetch injetável).
import { readFileSync } from 'node:fs';
import { redact } from './redact.ts';
import { isPrerelease } from './version.ts';

export interface WebstoreCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  publisherId: string;
  extensionId: string;
}
export type PublishType = 'STAGED_PUBLISH' | 'DEFAULT_PUBLISH';
export interface WebstoreDeps {
  fetch: typeof fetch;
  /** Espera entre consultas de `:fetchStatus` (injetável para testes instantâneos). */
  sleep?: (ms: number) => Promise<void>;
  /** Relógio em ms para o timeout do polling. */
  now?: () => number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}
export interface UploadResult {
  uploadState: 'SUCCEEDED';
  crxVersion?: string;
  itemId?: string;
}
export interface PublishResult {
  state: 'PENDING_REVIEW' | 'STAGED' | 'PUBLISHED' | 'PUBLISHED_TO_TESTERS';
  itemId?: string;
}

const API = 'https://chromewebstore.googleapis.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PUBLISH_OK = ['PENDING_REVIEW', 'STAGED', 'PUBLISHED', 'PUBLISHED_TO_TESTERS'];

type Json = Record<string, unknown>;

/** `-rc.N` → `STAGED_PUBLISH`; estável → `DEFAULT_PUBLISH`. */
export function publishTypeFor(version: string): PublishType {
  return isPrerelease(version) ? 'STAGED_PUBLISH' : 'DEFAULT_PUBLISH';
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Mensagem da API, verbatim: `error` (string ou objeto), `error_description`, `message`. */
function apiMessage(body: Json, raw: string): string {
  const err = body['error'];
  const errObj = typeof err === 'object' && err !== null ? (err as Json) : {};
  const parts = [
    str(err),
    str(errObj['status']),
    str(errObj['message']),
    str(body['error_description']),
    str(body['message']),
  ].filter((p): p is string => p !== undefined);
  return parts.length > 0 ? parts.join(': ') : raw.slice(0, 500);
}

class Session {
  readonly creds: WebstoreCreds;
  readonly deps: WebstoreDeps;
  private secrets: string[];
  private token = '';

  constructor(creds: WebstoreCreds, deps: WebstoreDeps) {
    this.creds = creds;
    this.deps = deps;
    this.secrets = [creds.clientSecret, creds.refreshToken];
  }

  fail(message: string): Error {
    return new Error(redact(message, this.secrets));
  }

  private async send(what: string, url: string, init: RequestInit): Promise<Json> {
    const res = await this.deps.fetch(url, init);
    const raw = await res.text();
    let body: Json = {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) body = parsed as Json;
    } catch {
      // corpo não-JSON: usa o texto bruto na mensagem
    }
    if (!res.ok)
      throw this.fail(`${what} failed with HTTP ${String(res.status)}: ${apiMessage(body, raw)}`);
    return body;
  }

  async authenticate(): Promise<void> {
    const { clientId, clientSecret, refreshToken } = this.creds;
    const body = await this.send('OAuth token exchange', TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });
    const token = str(body['access_token']);
    if (!token) throw this.fail('OAuth token exchange failed: no access_token in the response');
    this.token = token;
    this.secrets.push(token);
  }

  get itemPath(): string {
    return `publishers/${encodeURIComponent(this.creds.publisherId)}/items/${encodeURIComponent(this.creds.extensionId)}`;
  }

  call(what: string, method: 'GET' | 'POST', url: string, body?: BodyInit, type?: string) {
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    if (type) headers['content-type'] = type;
    return this.send(
      what,
      url,
      body === undefined ? { method, headers } : { method, headers, body },
    );
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uploadFailure(session: Session, state: string, body: Json): Error {
  const detail = str(body['message']) ?? apiMessage(body, '');
  return session.fail(`Upload ${state}${detail ? `: ${detail}` : ''}`);
}

export async function upload(
  zipPath: string,
  creds: WebstoreCreds,
  deps: WebstoreDeps,
): Promise<UploadResult> {
  const session = new Session(creds, deps);
  await session.authenticate();
  const zip = new Uint8Array(readFileSync(zipPath));
  const first = await session.call(
    'Upload',
    'POST',
    `${API}/upload/v2/${session.itemPath}:upload`,
    zip,
    'application/zip',
  );
  const result = (state: 'SUCCEEDED', body: Json): UploadResult => {
    const out: UploadResult = { uploadState: state };
    const crxVersion = str(body['crxVersion']);
    const itemId = str(body['itemId']);
    if (crxVersion) out.crxVersion = crxVersion;
    if (itemId) out.itemId = itemId;
    return out;
  };

  let state = str(first['uploadState']) ?? 'UPLOAD_STATE_UNSPECIFIED';
  if (state === 'SUCCEEDED') return result(state, first);
  if (state !== 'IN_PROGRESS') throw uploadFailure(session, state, first);

  const sleep = deps.sleep ?? pause;
  const now = deps.now ?? Date.now;
  const interval = deps.pollIntervalMs ?? 5_000;
  const timeout = deps.pollTimeoutMs ?? 300_000;
  const start = now();
  for (;;) {
    await sleep(interval);
    const status = await session.call(
      'fetchStatus',
      'GET',
      `${API}/v2/${session.itemPath}:fetchStatus`,
    );
    state = str(status['lastAsyncUploadState']) ?? 'UPLOAD_STATE_UNSPECIFIED';
    if (state === 'SUCCEEDED') return result(state, { ...first, ...status });
    if (state !== 'IN_PROGRESS') throw uploadFailure(session, state, status);
    if (now() - start >= timeout) {
      throw session.fail(`Upload timed out after ${String(timeout)} ms still IN_PROGRESS`);
    }
  }
}

export async function publish(
  type: PublishType,
  creds: WebstoreCreds,
  deps: WebstoreDeps,
): Promise<PublishResult> {
  const session = new Session(creds, deps);
  await session.authenticate();
  const body = await session.call(
    'Publish',
    'POST',
    `${API}/v2/${session.itemPath}:publish`,
    JSON.stringify({ publishType: type }),
    'application/json',
  );
  const state = str(body['state']) ?? 'ITEM_STATE_UNSPECIFIED';
  if (!PUBLISH_OK.includes(state)) {
    const detail = apiMessage(body, '');
    throw session.fail(`Publish ended in state ${state}${detail ? `: ${detail}` : ''}`);
  }
  const out: PublishResult = { state: state as PublishResult['state'] };
  const itemId = str(body['itemId']);
  if (itemId) out.itemId = itemId;
  return out;
}

/** upload + publish com o tipo derivado da versão; não publica se o upload falhar. */
export async function releaseToStore(
  zipPath: string,
  version: string,
  creds: WebstoreCreds,
  deps: WebstoreDeps,
): Promise<PublishResult> {
  await upload(zipPath, creds, deps);
  return publish(publishTypeFor(version), creds, deps);
}
