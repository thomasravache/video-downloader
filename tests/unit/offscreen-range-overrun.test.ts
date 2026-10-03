/** SPEC-0013 (revisão): servidor hostil que envia mais que a faixa pedida é cortado cedo (FETCH_FAILED). */
import { describe, expect, it } from 'vitest';
import { runOffscreenJob } from '../../entrypoints/offscreen/run-job';
import type { OffscreenEvent } from '../../src/core/hls-download';

describe('fetch com faixa: excesso de corpo', () => {
  it('SPEC-0013:UT-12 206 correto no cabeçalho mas corpo maior que a faixa: aborta cedo, FETCH_FAILED, leitura limitada', async () => {
    const CHUNK = 1024;
    let pulls = 0;
    let cancelled = false;
    const fetcher = (() => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array(CHUNK));
        },
        cancel() {
          cancelled = true;
        },
      });
      return Promise.resolve(
        new Response(body, { status: 206, headers: { 'content-range': 'bytes 0-1023/999999' } }),
      );
    }) as unknown as typeof fetch;
    const events: OffscreenEvent[] = [];

    await runOffscreenJob(
      {
        target: 'offscreen',
        type: 'start',
        jobId: 'j',
        urls: ['https://cdn.example.test/a.mp4'],
        fmp4: false,
        ranges: [{ offset: 0, length: 1024 }],
      },
      {
        fetch: fetcher,
        emit: (e) => events.push(e),
        signal: new AbortController().signal,
        sleep: () => Promise.resolve(),
      },
    );

    expect(events.find((e) => e.type === 'failed')).toEqual({
      type: 'failed',
      error: 'FETCH_FAILED',
    });
    // 4 tentativas (1 + 3 retries) x poucos chunks: bem abaixo do que ler até o fim/limite.
    expect(pulls).toBeLessThanOrEqual(4 * 4);
    expect(cancelled).toBe(true);
  });
});
