/** SPEC-0013: `sendMessage` serializa `undefined` em array como `null`; o offscreen trata ambos como "sem faixa". */
import { describe, expect, it } from 'vitest';
import { isCommand } from '../../entrypoints/offscreen/commands';
import { runOffscreenJob } from '../../entrypoints/offscreen/run-job';
import type { OffscreenEvent } from '../../src/core/hls-download';

const URLS = ['https://cdn.example.test/a.m4s', 'https://cdn.example.test/b.m4s'];

describe('ranges com null', () => {
  it('SPEC-0013:UT-07 isCommand aceita null como "sem faixa" e continua rejeitando itens inválidos', () => {
    const base = { target: 'offscreen', type: 'start', jobId: 'j', urls: URLS, fmp4: false };

    expect(isCommand({ ...base, ranges: [null, { offset: 0, length: 10 }] })).toBe(true);
    expect(isCommand({ ...base, ranges: [null, 'x'] })).toBe(false);
  });

  it('SPEC-0013:UT-08 item null busca o URL inteiro, sem Range', async () => {
    const seen: (string | null)[] = [];
    const events: OffscreenEvent[] = [];
    const fetcher = ((_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('range'));
      return Promise.resolve(new Response(new Uint8Array(4), { status: 200 }));
    }) as unknown as typeof fetch;

    await runOffscreenJob(
      {
        target: 'offscreen',
        type: 'start',
        jobId: 'j',
        urls: URLS,
        fmp4: false,
        ranges: [null, null],
      },
      {
        fetch: fetcher,
        emit: (e) => events.push(e),
        signal: new AbortController().signal,
        sleep: () => Promise.resolve(),
      },
    );

    expect(seen).toEqual([null, null]);
  });
});
