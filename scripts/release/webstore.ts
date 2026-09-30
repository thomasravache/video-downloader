// SPEC-0006 — contrato (scaffold). Cliente mínimo da Chrome Web Store API v2.
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

/** `-rc.N` → `STAGED_PUBLISH`; estável → `DEFAULT_PUBLISH`. */
export function publishTypeFor(_version: string): PublishType {
  throw new Error('NotImplemented');
}

export function upload(
  _zipPath: string,
  _creds: WebstoreCreds,
  _deps: WebstoreDeps,
): Promise<UploadResult> {
  throw new Error('NotImplemented');
}

export function publish(
  _type: PublishType,
  _creds: WebstoreCreds,
  _deps: WebstoreDeps,
): Promise<PublishResult> {
  throw new Error('NotImplemented');
}

/** upload + publish com o tipo derivado da versão; não publica se o upload falhar. */
export function releaseToStore(
  _zipPath: string,
  _version: string,
  _creds: WebstoreCreds,
  _deps: WebstoreDeps,
): Promise<PublishResult> {
  throw new Error('NotImplemented');
}
