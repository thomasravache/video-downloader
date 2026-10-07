import { describe, expect, it, vi } from 'vitest';
import * as mergeModule from '../../entrypoints/offscreen/merge';
import { runOffscreenJob } from '../../entrypoints/offscreen/run-job';
import type { OffscreenEvent, OffscreenStart } from '../../src/core/hls-download';
import { tsSegments } from './support/hls-clip';

describe('run-job merge com vídeo MPEG-TS sem initUrl', () => {
  it('SPEC-0020:UT-03 run-job.ts monta e executa merge com vídeo sem initUrl entregando buffer de vídeo fMP4 contínuo ao assembleMerged', async () => {
    const v0 = tsSegments('v360')[0] as Uint8Array;
    const v1 = tsSegments('v360')[1] as Uint8Array;
    const a0 = tsSegments('v180')[0] as Uint8Array;
    const a1 = tsSegments('v180')[1] as Uint8Array;

    const assembleSpy = vi.spyOn(mergeModule, 'assembleMerged');

    const events: OffscreenEvent[] = [];
    const request: OffscreenStart = {
      target: 'offscreen',
      type: 'start',
      jobId: 'job-ts-merge-no-init',
      urls: ['https://cdn.example.test/v0.ts', 'https://cdn.example.test/v1.ts'],
      fmp4: false,
      audio: {
        urls: ['https://cdn.example.test/a0.ts', 'https://cdn.example.test/a1.ts'],
      },
    };

    const mockFetch = ((input: string) => {
      if (input === 'https://cdn.example.test/v0.ts') {
        return Promise.resolve(new Response(Buffer.from(v0), { status: 200 }));
      }
      if (input === 'https://cdn.example.test/v1.ts') {
        return Promise.resolve(new Response(Buffer.from(v1), { status: 200 }));
      }
      if (input === 'https://cdn.example.test/a0.ts') {
        return Promise.resolve(new Response(Buffer.from(a0), { status: 200 }));
      }
      if (input === 'https://cdn.example.test/a1.ts') {
        return Promise.resolve(new Response(Buffer.from(a1), { status: 200 }));
      }
      return Promise.reject(new Error(`URL não encontrada: ${input}`));
    }) as unknown as typeof fetch;

    await runOffscreenJob(request, {
      fetch: mockFetch,
      emit: (event) => events.push(event),
      signal: new AbortController().signal,
      sleep: () => Promise.resolve(),
    });

    expect(assembleSpy).toHaveBeenCalled();
    const [videoArg] = assembleSpy.mock.calls[0] ?? [];
    if (!videoArg || !('blob' in videoArg)) {
      throw new Error('esperado argumento de vídeo com blob entregue ao assembleMerged');
    }

    const videoBytes = new Uint8Array(await videoArg.blob.arrayBuffer());
    // O vídeo TS entregue ao merge deve ter sido transmuxado para fMP4 contínuo (começando com ftyp/moof/moov), e não entregue como TS cru
    const boxType = String.fromCharCode(...videoBytes.subarray(4, 8));
    expect(['ftyp', 'moov', 'moof']).toContain(boxType);
  });
});
