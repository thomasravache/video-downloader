/** Validadores à mão (sem biblioteca de schema) do contrato de jobs (SPEC-0012:CT-01). */
import type { JobState } from './job';

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

const STATES = ['queued', 'running', 'assembling', 'saving', 'done', 'error', 'canceled'];
const ERRORS = [
  'FETCH_FAILED',
  'TOO_LARGE',
  'UNSUPPORTED_CODEC',
  'ASSEMBLY_FAILED',
  'DOWNLOAD_FAILED',
  'ENCRYPTED',
  'LIVE',
];
const DOWNLOAD_ERRORS = [
  'CANDIDATE_NOT_FOUND',
  'HLS_NOT_RESOLVED',
  'ENCRYPTED',
  'LIVE',
  'JOB_ALREADY_RUNNING',
  'TOO_MANY_JOBS',
  'PROTECTED',
  'UNSUPPORTED',
  'INVALID_MESSAGE',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isText = (value: unknown): boolean => typeof value === 'string' && value !== '';
const isOneOf = (list: readonly string[], value: unknown): boolean =>
  typeof value === 'string' && list.includes(value);

/** `JobState` v1. */
export function validateJobState(input: unknown): Validation<JobState> {
  if (!isRecord(input)) {
    return { ok: false, error: 'JobState deve ser um objeto' };
  }
  if (!isText(input['jobId']) || !isText(input['candidateId'])) {
    return { ok: false, error: 'jobId e candidateId devem ser textos não vazios' };
  }
  if (!isCount(input['variantIndex'])) {
    return { ok: false, error: 'variantIndex deve ser inteiro >= 0' };
  }
  if (!isOneOf(STATES, input['state'])) {
    return { ok: false, error: 'state desconhecido' };
  }
  if (
    !isCount(input['segmentsDone']) ||
    !isCount(input['segmentsTotal']) ||
    !isCount(input['bytesDone'])
  ) {
    return { ok: false, error: 'contadores devem ser inteiros >= 0' };
  }
  const percent = input['percent'];
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    return { ok: false, error: 'percent deve estar entre 0 e 100' };
  }
  if ('error' in input && input['error'] !== undefined && !isOneOf(ERRORS, input['error'])) {
    return { ok: false, error: 'error fora do conjunto' };
  }
  if (input['filename'] !== undefined && typeof input['filename'] !== 'string') {
    return { ok: false, error: 'filename deve ser texto' };
  }
  if (input['downloadId'] !== undefined && !isCount(input['downloadId'])) {
    return { ok: false, error: 'downloadId deve ser inteiro >= 0' };
  }
  return { ok: true, value: input as unknown as JobState };
}

/** Resposta de `{type:'job'}`: `{ok:true, job}` | `{ok:false, error:'JOB_NOT_FOUND'}`. */
export function validateJobResponse(
  input: unknown,
): Validation<{ ok: true; job: JobState } | { ok: false; error: 'JOB_NOT_FOUND' }> {
  if (isRecord(input) && input['ok'] === false && input['error'] === 'JOB_NOT_FOUND') {
    return { ok: true, value: { ok: false, error: 'JOB_NOT_FOUND' } };
  }
  if (isRecord(input) && input['ok'] === true) {
    const job = validateJobState(input['job']);
    return job.ok ? { ok: true, value: { ok: true, job: job.value } } : job;
  }
  return { ok: false, error: 'resposta de job inválida' };
}

/** Resposta de `{type:'cancel'}`: `{ok:true}` | `{ok:false, error:'JOB_NOT_FOUND'}`. */
export function validateCancelResponse(
  input: unknown,
): Validation<{ ok: true } | { ok: false; error: 'JOB_NOT_FOUND' }> {
  if (isRecord(input) && input['ok'] === true) {
    return { ok: true, value: { ok: true } };
  }
  if (isRecord(input) && input['ok'] === false && input['error'] === 'JOB_NOT_FOUND') {
    return { ok: true, value: { ok: false, error: 'JOB_NOT_FOUND' } };
  }
  return { ok: false, error: 'resposta de cancel inválida' };
}

/** Resposta de `{type:'download'}` para candidato HLS: `{ok:true, jobId}` | `{ok:false, error}`. */
export function validateHlsDownloadResponse(
  input: unknown,
): Validation<{ ok: true; jobId: string } | { ok: false; error: string }> {
  if (isRecord(input) && input['ok'] === true && isText(input['jobId'])) {
    return { ok: true, value: { ok: true, jobId: input['jobId'] as string } };
  }
  if (isRecord(input) && input['ok'] === false && isOneOf(DOWNLOAD_ERRORS, input['error'])) {
    return { ok: true, value: { ok: false, error: input['error'] as string } };
  }
  return { ok: false, error: 'resposta de download inválida' };
}
