/**
 * Contrato usado (SPEC-0012:CT-01) — validadores à mão (sem biblioteca de schema), consumidos pelo popup:
 *   src/core/hls-download/contracts.ts
 *     validateJobState(x)           -> { ok:true, value } | { ok:false, error:string }
 *     validateJobResponse(x)        -> aceita { ok:true, job: JobState } | { ok:false, error:'JOB_NOT_FOUND' }
 *     validateCancelResponse(x)     -> aceita { ok:true } | { ok:false, error:'JOB_NOT_FOUND' }
 *     validateHlsDownloadResponse(x)-> aceita { ok:true, jobId } | { ok:false, error } com error em
 *        CANDIDATE_NOT_FOUND | HLS_NOT_RESOLVED | ENCRYPTED | LIVE | JOB_ALREADY_RUNNING | TOO_MANY_JOBS
 *        | PROTECTED | UNSUPPORTED | INVALID_MESSAGE
 *   src/core/messages.ts validateMessage(message, sender, extensionId):
 *     {type:'download', candidateId, variantIndex?}  variantIndex inteiro >= 0 (opcional)
 *     {type:'job', jobId} e {type:'cancel', jobId}   jobId string não vazia
 *   JobState = { jobId, candidateId, variantIndex, state, segmentsDone, segmentsTotal, bytesDone, percent,
 *     filename?, downloadId?, error? } com state em queued|running|assembling|saving|done|error|canceled e
 *     error em FETCH_FAILED|TOO_LARGE|UNSUPPORTED_CODEC|ASSEMBLY_FAILED|DOWNLOAD_FAILED|ENCRYPTED|LIVE.
 */
import { describe, expect, it } from 'vitest';
import {
  validateCancelResponse,
  validateHlsDownloadResponse,
  validateJobResponse,
  validateJobState,
} from '../../src/core/hls-download';
import type { JobState } from '../../src/core/hls-download';
import { validateMessage } from '../../src/core/messages';

const EXT = 'ext-id-123';

function job(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobId: 'job-1',
    candidateId: 'cand-1',
    variantIndex: 0,
    state: 'running',
    segmentsDone: 3,
    segmentsTotal: 10,
    bytesDone: 3000,
    percent: 30,
    ...overrides,
  };
}

const STATES: JobState['state'][] = [
  'queued',
  'running',
  'assembling',
  'saving',
  'done',
  'error',
  'canceled',
];
const ERRORS = [
  'FETCH_FAILED',
  'TOO_LARGE',
  'UNSUPPORTED_CODEC',
  'ASSEMBLY_FAILED',
  'DOWNLOAD_FAILED',
  'ENCRYPTED',
  'LIVE',
];

describe('contrato JobState', () => {
  it('SPEC-0012:CT-01 aceita um JobState válido em cada estado', () => {
    for (const state of STATES) {
      expect(validateJobState(job({ state })).ok, state).toBe(true);
    }
  });

  it('SPEC-0012:CT-01 aceita cada código de erro do conjunto, filename e downloadId', () => {
    for (const error of ERRORS) {
      expect(validateJobState(job({ state: 'error', error })).ok, error).toBe(true);
    }
    expect(
      validateJobState(
        job({ state: 'done', percent: 100, filename: 'a - 720p.mp4', downloadId: 4 }),
      ).ok,
    ).toBe(true);
  });

  it('SPEC-0012:CT-01 devolve o próprio valor quando válido', () => {
    const valid = job();
    const result = validateJobState(valid);

    expect(result).toEqual({ ok: true, value: valid });
  });

  it('SPEC-0012:CT-01 rejeita percent fora de 0–100 (e não numérico)', () => {
    for (const percent of [-1, -0.1, 100.5, 101, 1000, Number.NaN, Infinity, '50']) {
      expect(validateJobState(job({ percent })).ok, String(percent)).toBe(false);
    }
    expect(validateJobState(job({ percent: 0 })).ok).toBe(true);
    expect(validateJobState(job({ percent: 100 })).ok).toBe(true);
  });

  it('SPEC-0012:CT-01 rejeita state desconhecido ou ausente', () => {
    for (const state of ['paused', 'DONE', '', 1, null, undefined]) {
      expect(validateJobState(job({ state })).ok, String(state)).toBe(false);
    }
  });

  it('SPEC-0012:CT-01 rejeita error fora do conjunto', () => {
    for (const error of ['UNKNOWN', 'fetch_failed', 'HLS_FETCH_FAILED', 'CANCELED', 7, null]) {
      expect(validateJobState(job({ state: 'error', error })).ok, String(error)).toBe(false);
    }
  });

  it('SPEC-0012:CT-01 rejeita contadores inválidos, ids vazios e variantIndex negativo ou fracionário', () => {
    expect(validateJobState(job({ segmentsDone: -1 })).ok).toBe(false);
    expect(validateJobState(job({ segmentsTotal: 1.5 })).ok).toBe(false);
    expect(validateJobState(job({ bytesDone: -5 })).ok).toBe(false);
    expect(validateJobState(job({ variantIndex: -1 })).ok).toBe(false);
    expect(validateJobState(job({ variantIndex: 0.5 })).ok).toBe(false);
    expect(validateJobState(job({ jobId: '' })).ok).toBe(false);
    expect(validateJobState(job({ candidateId: 42 })).ok).toBe(false);
  });

  it('SPEC-0012:CT-01 rejeita o que não é objeto', () => {
    for (const input of [null, undefined, 'job', 42, [], [job()]]) {
      expect(validateJobState(input).ok, Array.isArray(input) ? 'array' : typeof input).toBe(false);
    }
  });
});

describe('contrato das respostas job / cancel / download (HLS)', () => {
  it('SPEC-0012:CT-01 a resposta de job aceita {ok:true, job} e JOB_NOT_FOUND e rejeita o resto', () => {
    expect(validateJobResponse({ ok: true, job: job() }).ok).toBe(true);
    expect(validateJobResponse({ ok: false, error: 'JOB_NOT_FOUND' }).ok).toBe(true);
    expect(validateJobResponse({ ok: true, job: job({ percent: 101 }) }).ok).toBe(false);
    expect(validateJobResponse({ ok: true }).ok).toBe(false);
    expect(validateJobResponse({ ok: false, error: 'OUTRO' }).ok).toBe(false);
    expect(validateJobResponse(undefined).ok).toBe(false);
  });

  it('SPEC-0012:CT-01 a resposta de cancel aceita {ok:true} e JOB_NOT_FOUND e rejeita o resto', () => {
    expect(validateCancelResponse({ ok: true }).ok).toBe(true);
    expect(validateCancelResponse({ ok: false, error: 'JOB_NOT_FOUND' }).ok).toBe(true);
    expect(validateCancelResponse({ ok: false, error: 'OUTRO' }).ok).toBe(false);
    expect(validateCancelResponse({ ok: 'sim' }).ok).toBe(false);
    expect(validateCancelResponse(null).ok).toBe(false);
  });

  it('SPEC-0012:CT-01 a resposta de download HLS aceita {ok:true, jobId} e cada erro do contrato', () => {
    expect(validateHlsDownloadResponse({ ok: true, jobId: 'job-1' }).ok).toBe(true);
    for (const error of [
      'CANDIDATE_NOT_FOUND',
      'HLS_NOT_RESOLVED',
      'ENCRYPTED',
      'LIVE',
      'JOB_ALREADY_RUNNING',
      'TOO_MANY_JOBS',
      'PROTECTED',
      'UNSUPPORTED',
      'INVALID_MESSAGE',
    ]) {
      expect(validateHlsDownloadResponse({ ok: false, error }).ok, error).toBe(true);
    }
  });

  it('SPEC-0012:CT-01 a resposta de download HLS rejeita jobId vazio/ausente e erro fora do conjunto', () => {
    expect(validateHlsDownloadResponse({ ok: true }).ok).toBe(false);
    expect(validateHlsDownloadResponse({ ok: true, jobId: '' }).ok).toBe(false);
    expect(validateHlsDownloadResponse({ ok: true, jobId: 5 }).ok).toBe(false);
    expect(validateHlsDownloadResponse({ ok: false, error: 'FETCH_FAILED' }).ok).toBe(false);
    expect(validateHlsDownloadResponse({ ok: false }).ok).toBe(false);
    expect(validateHlsDownloadResponse('x').ok).toBe(false);
  });
});

describe('contrato das mensagens download / job / cancel', () => {
  const from = { id: EXT };

  it('SPEC-0012:CT-01 download aceita variantIndex inteiro >= 0 (e continua aceitando sem ele)', () => {
    expect(
      validateMessage({ type: 'download', candidateId: 'c1', variantIndex: 2 }, from, EXT),
    ).toEqual({
      ok: true,
      message: { type: 'download', candidateId: 'c1', variantIndex: 2 },
    });
    expect(
      validateMessage({ type: 'download', candidateId: 'c1', variantIndex: 0 }, from, EXT).ok,
    ).toBe(true);
    expect(validateMessage({ type: 'download', candidateId: 'c1' }, from, EXT)).toEqual({
      ok: true,
      message: { type: 'download', candidateId: 'c1' },
    });
  });

  it('SPEC-0012:CT-01 download rejeita variantIndex negativo, fracionário ou não numérico', () => {
    for (const variantIndex of [-1, 1.5, '1', null, Number.NaN, Infinity]) {
      expect(
        validateMessage({ type: 'download', candidateId: 'c1', variantIndex }, from, EXT),
        String(variantIndex),
      ).toEqual({ ok: false, error: 'INVALID_MESSAGE' });
    }
  });

  it('SPEC-0012:CT-01 job e cancel exigem jobId string não vazia', () => {
    for (const type of ['job', 'cancel'] as const) {
      expect(validateMessage({ type, jobId: 'job-1' }, from, EXT)).toEqual({
        ok: true,
        message: { type, jobId: 'job-1' },
      });
      for (const jobId of ['', 1, null, undefined]) {
        expect(validateMessage({ type, jobId }, from, EXT), `${type} ${String(jobId)}`).toEqual({
          ok: false,
          error: 'INVALID_MESSAGE',
        });
      }
    }
  });

  it('SPEC-0012:CT-01 (guarda: passa antes da mudança) job e cancel só valem vindos da própria extensão', () => {
    for (const type of ['job', 'cancel'] as const) {
      expect(validateMessage({ type, jobId: 'job-1' }, { id: 'outra' }, EXT)).toEqual({
        ok: false,
        error: 'INVALID_MESSAGE',
      });
      expect(validateMessage({ type, jobId: 'job-1' }, {}, EXT)).toEqual({
        ok: false,
        error: 'INVALID_MESSAGE',
      });
    }
  });

  it('SPEC-0012:CT-01 (guarda: passa antes da mudança) detect, resolveHls e diagnostics continuam válidos e tipos desconhecidos continuam rejeitados', () => {
    expect(validateMessage({ type: 'detect', tabId: 1 }, from, EXT).ok).toBe(true);
    expect(validateMessage({ type: 'resolveHls', candidateId: 'c1' }, from, EXT).ok).toBe(true);
    expect(validateMessage({ type: 'diagnostics' }, from, EXT).ok).toBe(true);
    expect(validateMessage({ type: 'pause', jobId: 'j' }, from, EXT).ok).toBe(false);
  });
});
