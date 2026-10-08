import { describe, expect, it } from 'vitest';
import { runOffscreenJob } from '../../entrypoints/offscreen/run-job';
import type { OffscreenEvent, OffscreenStart } from '../../src/core/hls-download';
import { fmp4Init, fmp4Segments, tsSegments } from '../unit/support/hls-clip';
import { inspectMp4 } from '../unit/support/mp4';
import { makePackedAacSegment } from '../unit/support/packed-aac';
import { bytesOfBlobUrl } from './support/hls-job';

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

  it('SPEC-0020:IT-02 Pipeline offscreen com vídeo TS e áudio TS multi-segmento emite evento ready contendo Blob MP4 com ambas as faixas e duração total correspondente', async () => {
    // Segmentos independentes com timestamps iniciando de 0 (característica do YouTube HLS)
    const v0 = tsSegments('v360')[0] as Uint8Array;
    const v1 = tsSegments('v360')[0] as Uint8Array;
    const a0 = tsSegments('v180')[0] as Uint8Array;
    const a1 = tsSegments('v180')[0] as Uint8Array;

    const events: OffscreenEvent[] = [];
    const request: OffscreenStart = {
      target: 'offscreen',
      type: 'start',
      jobId: 'job-ts-video-audio-multisegment',
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

    const readyEvent = events.find(
      (e): e is Extract<OffscreenEvent, { type: 'ready' }> => e.type === 'ready',
    );
    expect(readyEvent).toBeDefined();
    expect(events.some((e) => e.type === 'failed')).toBe(false);
    if (!readyEvent) {
      throw new Error('readyEvent ausente');
    }

    const bytes = await bytesOfBlobUrl(readyEvent.blobUrl);
    const info = inspectMp4(bytes);

    expect(info.tracks.map((t) => t.handler).sort()).toEqual(['soun', 'vide']);
    const videoTrack = info.tracks.find((t) => t.handler === 'vide');
    const audioTrack = info.tracks.find((t) => t.handler === 'soun');
    expect(videoTrack).toBeDefined();
    expect(audioTrack).toBeDefined();
    // A duração total do MP4 gerado deve cobrir a soma dos múltiplos segmentos (~4s), não parando no primeiro (~2s)
    expect(info.durationSec).toBeGreaterThan(3.5);
  });

  it('SPEC-0021:CH-01 (guarda: passa antes da mudança) Transmux de vídeo MPEG-TS e áudio da SPEC-0020 continua gerando MP4 válido e passando', async () => {
    const v0 = tsSegments('v360')[0] as Uint8Array;
    const v1 = tsSegments('v360')[1] as Uint8Array;
    const a0 = tsSegments('v180')[0] as Uint8Array;
    const a1 = tsSegments('v180')[1] as Uint8Array;

    const events: OffscreenEvent[] = [];
    const request: OffscreenStart = {
      target: 'offscreen',
      type: 'start',
      jobId: 'job-ts-video-audio-ch01',
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

    const readyEvent = events.find(
      (e): e is Extract<OffscreenEvent, { type: 'ready' }> => e.type === 'ready',
    );
    expect(readyEvent).toBeDefined();
    expect(events.some((e) => e.type === 'failed')).toBe(false);
    if (!readyEvent) {
      throw new Error('readyEvent ausente');
    }

    const bytes = await bytesOfBlobUrl(readyEvent.blobUrl);
    const info = inspectMp4(bytes);

    expect(info.tracks.map((t) => t.handler).sort()).toEqual(['soun', 'vide']);
    expect(info.durationSec).toBeGreaterThan(3.5);
  });

  it('SPEC-0021:IT-01 Pipeline offscreen completo com vídeo TS e múltiplos segmentos de áudio packed AAC ID3 (simulando YouTube itag 234) entrega arquivo MP4 contendo trilha de áudio completa com a soma das durações de todos os segmentos', async () => {
    const v0 = tsSegments('v360')[0] as Uint8Array;
    const v1 = tsSegments('v360')[1] as Uint8Array;
    // 2 segmentos de áudio packed AAC com ID3 e ADTS (~2.0s cada = ~4.0s no total)
    const a0 = makePackedAacSegment(0, 86);
    const a1 = makePackedAacSegment(90000 * 2, 86);

    const events: OffscreenEvent[] = [];
    const request: OffscreenStart = {
      target: 'offscreen',
      type: 'start',
      jobId: 'job-youtube-itag234-packed-aac',
      urls: ['https://cdn.example.test/v0.ts', 'https://cdn.example.test/v1.ts'],
      fmp4: false,
      audio: {
        urls: ['https://cdn.example.test/a0.aac', 'https://cdn.example.test/a1.aac'],
      },
    };

    const mockFetch = ((input: string) => {
      if (input === 'https://cdn.example.test/v0.ts') {
        return Promise.resolve(new Response(Buffer.from(v0), { status: 200 }));
      }
      if (input === 'https://cdn.example.test/v1.ts') {
        return Promise.resolve(new Response(Buffer.from(v1), { status: 200 }));
      }
      if (input === 'https://cdn.example.test/a0.aac') {
        return Promise.resolve(new Response(Buffer.from(a0), { status: 200 }));
      }
      if (input === 'https://cdn.example.test/a1.aac') {
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

    const readyEvent = events.find(
      (e): e is Extract<OffscreenEvent, { type: 'ready' }> => e.type === 'ready',
    );
    expect(readyEvent).toBeDefined();
    expect(events.some((e) => e.type === 'failed')).toBe(false);
    if (!readyEvent) {
      throw new Error('readyEvent ausente');
    }

    const bytes = await bytesOfBlobUrl(readyEvent.blobUrl);
    const info = inspectMp4(bytes);

    expect(info.tracks.map((t) => t.handler).sort()).toEqual(['soun', 'vide']);
    const audioTrack = info.tracks.find((t) => t.handler === 'soun');
    expect(audioTrack).toBeDefined();
    // A trilha de áudio deve cobrir a soma de todos os segmentos (~4s), não ficando truncada no primeiro
    expect(audioTrack?.durationSec).toBeGreaterThan(3.5);
    expect(audioTrack?.sampleCount).toBeGreaterThanOrEqual(170);
  });
});
