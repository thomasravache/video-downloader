// SPEC-0006 — contrato (scaffold). Cliente mínimo da Chrome Web Store API (v1.1).
export interface WebstoreCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  extensionId: string;
}
export type PublishTarget = 'trustedTesters' | 'default';
export interface WebstoreDeps {
  fetch: typeof fetch;
}
export interface UploadResult {
  uploadState: 'SUCCESS' | 'FAILURE';
  itemError?: { error_code: string; error_detail: string }[];
}
export interface PublishResult {
  status: string[];
}

/** `-rc.N` → `trustedTesters`; estável → `default`. */
export function publishTargetFor(_version: string): PublishTarget {
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
  _target: PublishTarget,
  _creds: WebstoreCreds,
  _deps: WebstoreDeps,
): Promise<PublishResult> {
  throw new Error('NotImplemented');
}

/** upload + publish com o target derivado da versão; não publica se o upload falhar. */
export function releaseToStore(
  _zipPath: string,
  _version: string,
  _creds: WebstoreCreds,
  _deps: WebstoreDeps,
): Promise<PublishResult> {
  throw new Error('NotImplemented');
}
