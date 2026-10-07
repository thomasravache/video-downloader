import { describe, expect, it } from 'vitest';
import { runOffscreenJob } from '../../entrypoints/offscreen/run-job';
import type { OffscreenEvent, OffscreenStart } from '../../src/core/hls-download';
import { fmp4Init, fmp4Segments, tsSegments } from '../unit/support/hls-clip';

describe('runOffscreenJob com vídeo fMP4 e áudio TS/ADTS', () => {
  it('SPEC-0019:IT-03 executor runOffscreenJob com vídeo fMP4 e áudio TS/ADTS sem initUrl conclui montagem e emite evento ready', async () => {
    const videoInitBytes = fmp4Init();
    const videoSegmentBytes = fmp4Segments()[0] as Uint8Array;
    const audioSegmentBytes = tsSegments('v180')[0] as Uint8Array;

    const events: OffscreenEvent[] = [];
    const request: OffscreenStart = {
      target: 'offscreen',
      type: 'start',
      jobId: 'job-ts-audio',
      urls: ['https://cdn.example.test/video-0.m4s'],
      initUrl: 'https://cdn.example.test/init.mp4',
      fmp4: true,
      audio: {
        urls: ['https://cdn.example.test/audio-0.ts'],
        // initUrl é undefined para áudio TS/ADTS
      },
    };

    const mockFetch = ((input: string) => {
      if (input === 'https://cdn.example.test/init.mp4') {
        return Promise.resolve(new Response(Buffer.from(videoInitBytes), { status: 200 }));
      }
      if (input === 'https://cdn.example.test/video-0.m4s') {
        return Promise.resolve(new Response(Buffer.from(videoSegmentBytes), { status: 200 }));
      }
      if (input === 'https://cdn.example.test/audio-0.ts') {
        return Promise.resolve(new Response(Buffer.from(audioSegmentBytes), { status: 200 }));
      }
      return Promise.reject(new Error(`URL não encontrada: ${input}`));
    }) as unknown as typeof fetch;

    await runOffscreenJob(request, {
      fetch: mockFetch,
      emit: (event) => events.push(event),
      signal: new AbortController().signal,
      sleep: () => Promise.resolve(),
    });

    // No código existente, run-job lança AssemblyError('ASSEMBLY_FAILED', 'junção exige fMP4 nas duas trilhas')
    // e emite failed em vez de ready.
    const readyEvent = events.find((e) => e.type === 'ready');
    expect(readyEvent).toBeDefined();
    expect(events.some((e) => e.type === 'failed')).toBe(false);
  });
});
