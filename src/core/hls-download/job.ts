/** Estado e máquina de estados dos jobs de download HLS (SPEC-0012:UT-04, CT-01). Assinaturas apenas. */
import type { JobError } from './errors';
import { percentOf } from './progress';

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

/**
 * Limite da soma vídeo + áudio num job com junção (SPEC-0014, ADR-0014): 512 MiB. A junção mantém cópias das
 * trilhas (Blobs), da saída da biblioteca e do Blob final: o pico medido é ~4x a entrada, e a regra da spec é
 * pico <= 2 GiB.
 */
export const MAX_MERGE_BUFFERED_BYTES = 512 * 1024 * 1024;

export type JobEvent =
  | { type: 'start'; segmentsTotal: number }
  | { type: 'progress'; segmentsDone: number; bytesDone: number }
  | { type: 'assemble' }
  | { type: 'save'; filename: string; downloadId: number }
  | { type: 'complete' }
  | { type: 'fail'; error: JobError }
  | { type: 'cancel' };

export function newJob(init: {
  jobId: string;
  candidateId: string;
  variantIndex: number;
}): JobState {
  return {
    jobId: init.jobId,
    candidateId: init.candidateId,
    variantIndex: init.variantIndex,
    state: 'queued',
    segmentsDone: 0,
    segmentsTotal: 0,
    bytesDone: 0,
    percent: 0,
  };
}

const ACTIVE: readonly JobStatus[] = ['queued', 'running', 'assembling', 'saving'];

/** Transição pura; evento inválido para o estado atual devolve o próprio `job` (sem mudança). */
export function reduceJob(job: JobState, event: JobEvent): JobState {
  switch (event.type) {
    case 'start':
      return job.state === 'queued'
        ? { ...job, state: 'running', segmentsTotal: event.segmentsTotal }
        : job;
    case 'progress': {
      if (job.state !== 'running') {
        return job;
      }
      const bytesDone = Math.max(job.bytesDone, event.bytesDone);
      if (bytesDone > MAX_BUFFERED_BYTES) {
        return { ...job, bytesDone, state: 'error', error: 'TOO_LARGE' };
      }
      const segmentsDone = Math.max(job.segmentsDone, event.segmentsDone);
      return {
        ...job,
        segmentsDone,
        bytesDone,
        percent: Math.max(job.percent, percentOf(segmentsDone, job.segmentsTotal)),
      };
    }
    case 'assemble':
      return job.state === 'running' ? { ...job, state: 'assembling' } : job;
    case 'save':
      return job.state === 'assembling'
        ? { ...job, state: 'saving', filename: event.filename, downloadId: event.downloadId }
        : job;
    case 'complete':
      return job.state === 'saving' ? { ...job, state: 'done', percent: 100 } : job;
    case 'fail':
      return ACTIVE.includes(job.state) ? { ...job, state: 'error', error: event.error } : job;
    case 'cancel':
      return ACTIVE.includes(job.state) ? { ...job, state: 'canceled' } : job;
  }
}
