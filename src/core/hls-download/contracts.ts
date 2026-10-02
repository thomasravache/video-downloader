/** Validadores à mão (sem biblioteca de schema) do contrato de jobs (SPEC-0012:CT-01). Assinaturas apenas. */
import type { JobState } from './job';

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

/** `JobState` v1. */
export function validateJobState(_input: unknown): Validation<JobState> {
  throw new Error('NotImplemented');
}

/** Resposta de `{type:'job'}`: `{ok:true, job}` | `{ok:false, error:'JOB_NOT_FOUND'}`. */
export function validateJobResponse(
  _input: unknown,
): Validation<{ ok: true; job: JobState } | { ok: false; error: 'JOB_NOT_FOUND' }> {
  throw new Error('NotImplemented');
}

/** Resposta de `{type:'cancel'}`: `{ok:true}` | `{ok:false, error:'JOB_NOT_FOUND'}`. */
export function validateCancelResponse(
  _input: unknown,
): Validation<{ ok: true } | { ok: false; error: 'JOB_NOT_FOUND' }> {
  throw new Error('NotImplemented');
}

/** Resposta de `{type:'download'}` para candidato HLS: `{ok:true, jobId}` | `{ok:false, error}`. */
export function validateHlsDownloadResponse(
  _input: unknown,
): Validation<{ ok: true; jobId: string } | { ok: false; error: string }> {
  throw new Error('NotImplemented');
}
