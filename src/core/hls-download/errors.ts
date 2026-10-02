/** Erros do download HLS (SPEC-0012). Só tipos/classes de dados; sem lógica. */

/** Falhas que encerram um job (JobState.error). */
export type JobError =
  | 'FETCH_FAILED'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_CODEC'
  | 'ASSEMBLY_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'ENCRYPTED'
  | 'LIVE';

/** Um segmento falhou definitivamente (depois das retentativas). */
export class SegmentFetchError extends Error {
  readonly code = 'FETCH_FAILED';
  constructor(
    readonly index: number,
    message = 'FETCH_FAILED',
  ) {
    super(message);
    this.name = 'SegmentFetchError';
  }
}

/** Falha de montagem; `code` vira `JobState.error`. */
export class AssemblyError extends Error {
  constructor(
    readonly code: 'UNSUPPORTED_CODEC' | 'TOO_LARGE' | 'ENCRYPTED' | 'ASSEMBLY_FAILED',
    message: string = code,
  ) {
    super(message);
    this.name = 'AssemblyError';
  }
}
