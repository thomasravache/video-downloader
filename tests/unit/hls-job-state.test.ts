/**
 * Contrato usado (SPEC-0012:UT-04) — src/core/hls-download/job.ts:
 *   newJob({ jobId, candidateId, variantIndex }) -> JobState { state:'queued', segmentsDone:0, segmentsTotal:0, bytesDone:0, percent:0 }
 *   reduceJob(job, event) -> JobState (função pura; evento inválido para o estado devolve o próprio job):
 *     start{segmentsTotal}         queued -> running
 *     progress{segmentsDone,bytesDone}  running (monotônico; percent = segmentos/total, 0–100);
 *                                  bytesDone > MAX_BUFFERED_BYTES (1,5 GiB) -> error 'TOO_LARGE'
 *     assemble                     running -> assembling
 *     save{filename,downloadId}    assembling -> saving
 *     complete                     saving -> done (percent 100)
 *     fail{error}                  queued|running|assembling|saving -> error
 *     cancel                       queued|running|assembling|saving -> canceled
 *   done, error e canceled são terminais: todo evento é ignorado.
 */
import { describe, expect, it } from 'vitest';
import { MAX_BUFFERED_BYTES, newJob, reduceJob } from '../../src/core/hls-download';
import type { JobEvent, JobState } from '../../src/core/hls-download';

const fresh = (): JobState => newJob({ jobId: 'job-1', candidateId: 'cand-1', variantIndex: 1 });

function run(...events: JobEvent[]): JobState {
  return events.reduce(reduceJob, fresh());
}

const START: JobEvent = { type: 'start', segmentsTotal: 10 };

describe('máquina de estados do job de download HLS', () => {
  it('SPEC-0012:UT-04 um job novo nasce queued, zerado e com os identificadores', () => {
    expect(fresh()).toMatchObject({
      jobId: 'job-1',
      candidateId: 'cand-1',
      variantIndex: 1,
      state: 'queued',
      segmentsDone: 0,
      bytesDone: 0,
      percent: 0,
    });
  });

  it('SPEC-0012:UT-04 caminho feliz: queued -> running -> assembling -> saving -> done com 100%', () => {
    const job = run(
      START,
      { type: 'progress', segmentsDone: 10, bytesDone: 5000 },
      { type: 'assemble' },
      { type: 'save', filename: 'Aula - 720p.mp4', downloadId: 7 },
      { type: 'complete' },
    );

    expect(job).toMatchObject({
      state: 'done',
      segmentsDone: 10,
      segmentsTotal: 10,
      bytesDone: 5000,
      percent: 100,
      filename: 'Aula - 720p.mp4',
      downloadId: 7,
    });
    expect(job.error).toBeUndefined();
  });

  it('SPEC-0012:UT-04 progresso: percent segue segmentos/total e nunca diminui', () => {
    let job = run(START);
    const percents: number[] = [];
    for (const [segmentsDone, bytesDone] of [
      [2, 200],
      [5, 500],
      [4, 400], // atrasado/fora de ordem: não regride
      [10, 1000],
    ] as const) {
      job = reduceJob(job, { type: 'progress', segmentsDone, bytesDone });
      percents.push(job.percent);
    }

    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(percents[0]).toBeGreaterThanOrEqual(19);
    expect(percents[0]).toBeLessThanOrEqual(21);
    expect(job.segmentsDone).toBe(10);
    expect(job.percent).toBe(100);
  });

  it('SPEC-0012:UT-04 cancelamento no meio do download termina em canceled, congelando o progresso', () => {
    const canceled = run(
      START,
      { type: 'progress', segmentsDone: 3, bytesDone: 300 },
      { type: 'cancel' },
    );

    expect(canceled.state).toBe('canceled');
    expect(canceled.segmentsDone).toBe(3);
    expect(canceled.error).toBeUndefined();
    expect(reduceJob(canceled, { type: 'progress', segmentsDone: 9, bytesDone: 900 })).toEqual(
      canceled,
    );
  });

  it('SPEC-0012:UT-04 cancelar na fila, na montagem ou ao salvar também termina em canceled', () => {
    expect(run({ type: 'cancel' }).state).toBe('canceled');
    expect(run(START, { type: 'assemble' }, { type: 'cancel' }).state).toBe('canceled');
    expect(
      run(
        START,
        { type: 'assemble' },
        { type: 'save', filename: 'a.mp4', downloadId: 1 },
        { type: 'cancel' },
      ).state,
    ).toBe('canceled');
  });

  it('SPEC-0012:UT-04 erro definitivo de segmento termina em error FETCH_FAILED', () => {
    const job = run(
      START,
      { type: 'progress', segmentsDone: 2, bytesDone: 200 },
      {
        type: 'fail',
        error: 'FETCH_FAILED',
      },
    );

    expect(job).toMatchObject({ state: 'error', error: 'FETCH_FAILED', segmentsDone: 2 });
  });

  it('SPEC-0012:UT-04 cada motivo de falha é preservado no estado final', () => {
    for (const error of [
      'UNSUPPORTED_CODEC',
      'ASSEMBLY_FAILED',
      'DOWNLOAD_FAILED',
      'ENCRYPTED',
      'LIVE',
      'TOO_LARGE',
    ] as const) {
      expect(run(START, { type: 'assemble' }, { type: 'fail', error })).toMatchObject({
        state: 'error',
        error,
      });
    }
  });

  it('SPEC-0012:UT-04 bytes acima de 1,5 GiB terminam em error TOO_LARGE; no limite exato continua running', () => {
    const atLimit = run(START, {
      type: 'progress',
      segmentsDone: 1,
      bytesDone: MAX_BUFFERED_BYTES,
    });
    const over = run(START, {
      type: 'progress',
      segmentsDone: 1,
      bytesDone: MAX_BUFFERED_BYTES + 1,
    });

    expect(MAX_BUFFERED_BYTES).toBe(1.5 * 1024 ** 3);
    expect(atLimit.state).toBe('running');
    expect(over).toMatchObject({ state: 'error', error: 'TOO_LARGE' });
  });

  it('SPEC-0012:UT-04 estados terminais ignoram qualquer evento (done, error e canceled)', () => {
    const done = run(
      START,
      { type: 'progress', segmentsDone: 10, bytesDone: 1 },
      { type: 'assemble' },
      { type: 'save', filename: 'a.mp4', downloadId: 1 },
      { type: 'complete' },
    );
    const failed = run(START, { type: 'fail', error: 'FETCH_FAILED' });
    const canceled = run(START, { type: 'cancel' });
    const events: JobEvent[] = [
      START,
      { type: 'progress', segmentsDone: 1, bytesDone: 1 },
      { type: 'assemble' },
      { type: 'save', filename: 'b.mp4', downloadId: 2 },
      { type: 'complete' },
      { type: 'fail', error: 'LIVE' },
      { type: 'cancel' },
    ];

    for (const terminal of [done, failed, canceled]) {
      for (const event of events) {
        expect(reduceJob(terminal, event), `${terminal.state} + ${event.type}`).toEqual(terminal);
      }
    }
  });

  it('SPEC-0012:UT-04 transições inválidas são ignoradas (sem pular etapas)', () => {
    const queued = fresh();
    const running = run(START);
    const assembling = run(START, { type: 'assemble' });

    expect(reduceJob(queued, { type: 'assemble' })).toEqual(queued);
    expect(reduceJob(queued, { type: 'complete' })).toEqual(queued);
    expect(reduceJob(running, { type: 'complete' })).toEqual(running);
    expect(reduceJob(running, { type: 'save', filename: 'a.mp4', downloadId: 1 })).toEqual(running);
    expect(reduceJob(running, START)).toEqual(running);
    expect(reduceJob(assembling, { type: 'progress', segmentsDone: 1, bytesDone: 1 })).toEqual(
      assembling,
    );
  });

  it('SPEC-0012:UT-04 reduceJob é puro: não altera o job recebido', () => {
    const job = run(START);
    const snapshot = structuredClone(job);

    reduceJob(job, { type: 'progress', segmentsDone: 4, bytesDone: 40 });
    reduceJob(job, { type: 'cancel' });

    expect(job).toEqual(snapshot);
  });
});
