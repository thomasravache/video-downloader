/** Estado e máquina de estados dos jobs de download HLS (SPEC-0012:UT-04, CT-01). Assinaturas apenas. */
import type { JobError } from './errors';

export type JobStatus =
  'queued' | 'running' | 'assembling' | 'saving' | 'done' | 'error' | 'canceled';

export interface JobState {
  jobId: string;
  candidateId: string;
  variantIndex: number;
  state: JobStatus;
  segmentsDone: number;
  segmentsTotal: number;
  bytesDone: number;
  /** 0–100; segmentos concluídos / total (monotônico). */
  percent: number;
  filename?: string;
  downloadId?: number;
  error?: JobError;
}

/** Limite de memória: 1,5 GiB bufferizados (ADR-0013). */
export const MAX_BUFFERED_BYTES = 1.5 * 1024 * 1024 * 1024;

export type JobEvent =
  | { type: 'start'; segmentsTotal: number }
  | { type: 'progress'; segmentsDone: number; bytesDone: number }
  | { type: 'assemble' }
  | { type: 'save'; filename: string; downloadId: number }
  | { type: 'complete' }
  | { type: 'fail'; error: JobError }
  | { type: 'cancel' };

export function newJob(_init: {
  jobId: string;
  candidateId: string;
  variantIndex: number;
}): JobState {
  throw new Error('NotImplemented');
}

/** Transição pura; evento inválido para o estado atual devolve o próprio `job` (sem mudança). */
export function reduceJob(_job: JobState, _event: JobEvent): JobState {
  throw new Error('NotImplemented');
}
