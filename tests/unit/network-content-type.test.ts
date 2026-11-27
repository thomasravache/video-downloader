/**
 * Contrato usado (SPEC-0024:CH-02, UT-06), src/core/network.ts:
 *   classifyNetworkResponse(r: NetworkResponse): { kind: 'file'|'hls'|'dash'; mimeType?; sizeBytes? } | null
 *   D6: com extensão de vídeo conhecida (.mp4/.m4v/.webm/.ogv/.mov) também valem `binary/octet-stream`,
 *   `video/quicktime` (.mov) e resposta SEM Content-Type; o tamanho mínimo (MIN_FILE_BYTES) continua valendo.
 */
import { describe, expect, it } from 'vitest';
import { classifyNetworkResponse } from '../../src/core/network';
import type { NetworkResponse } from '../../src/core/network';
import { response } from './support/detect-service';

const kindOf = (r: NetworkResponse) => classifyNetworkResponse(r)?.kind ?? null;

describe('classifyNetworkResponse: caracterização (antes da SPEC-0024)', () => {
  it('SPEC-0024:CH-02 (guarda: passa antes da mudança) .mp4 video/mp4, .m3u8, .ts, imagem e .mp4 text/html', () => {
    const cases: [NetworkResponse, string | null][] = [
      [response({ url: 'https://cdn.example.test/v/aula.mp4', contentType: 'video/mp4' }), 'file'],
      [
        response({
          url: 'https://cdn.example.test/hls/master.m3u8',
          contentType: 'application/vnd.apple.mpegurl',
          contentLength: 700,
        }),
        'hls',
      ],
      [response({ url: 'https://cdn.example.test/hls/seg-1.ts', contentType: 'video/mp2t' }), null],
      [response({ url: 'https://cdn.example.test/img/capa.png', contentType: 'image/png' }), null],
      [response({ url: 'https://cdn.example.test/v/aula.mp4', contentType: 'text/html' }), null],
    ];

    expect(cases.map(([r]) => kindOf(r))).toEqual(cases.map(([, kind]) => kind));
  });
});
