/**
 * Contrato usado (SPEC-0010:UT-01), proposto em src/core/network.ts:
 *   NetworkResponse { url, method, statusCode, tabId, frameId, contentType?, contentLength? }
 *   classifyNetworkResponse(r: NetworkResponse): { kind: 'file'|'hls'|'dash'; mimeType?; sizeBytes? } | null
 * `contentLength` já é o tamanho total (Content-Length ou total de Content-Range).
 */
import { describe, expect, it } from 'vitest';
import { classifyNetworkResponse } from '../../src/core/network';
import type { NetworkResponse } from '../../src/core/network';

const MiB = 1024 * 1024;

function response(overrides: Partial<NetworkResponse> = {}): NetworkResponse {
  return {
    url: 'https://cdn.example.test/v/aula.mp4',
    method: 'GET',
    statusCode: 200,
    tabId: 1,
    frameId: 0,
    contentType: 'video/mp4',
    contentLength: 5 * MiB,
    ...overrides,
  };
}

const kindOf = (r: NetworkResponse) => classifyNetworkResponse(r)?.kind ?? null;

describe('classifyNetworkResponse: arquivos de vídeo', () => {
  it('SPEC-0010:UT-01 video/mp4 de 5 MiB vira candidato file com mimeType e tamanho', () => {
    expect(classifyNetworkResponse(response())).toEqual({
      kind: 'file',
      mimeType: 'video/mp4',
      sizeBytes: 5 * MiB,
    });
  });

  it('SPEC-0010:UT-01 video/webm e video/ogg por Content-Type (sem extensão) são file', () => {
    for (const contentType of ['video/webm', 'video/ogg']) {
      expect(
        kindOf(response({ url: 'https://cdn.example.test/stream/42', contentType })),
        contentType,
      ).toBe('file');
    }
  });

  it('SPEC-0010:UT-01 .mp4?x=1 com application/octet-stream é file (extensão ignora a query)', () => {
    const r = classifyNetworkResponse(
      response({
        url: 'https://cdn.example.test/v/aula.mp4?x=1',
        contentType: 'application/octet-stream',
      }),
    );

    expect(r).toMatchObject({ kind: 'file', sizeBytes: 5 * MiB });
  });

  it('SPEC-0010:UT-01 extensões .webm .m4v .ogv valem com octet-stream ou video/*', () => {
    for (const ext of ['webm', 'm4v', 'ogv']) {
      for (const contentType of ['application/octet-stream', 'video/x-custom']) {
        expect(
          kindOf(response({ url: `https://cdn.example.test/a.${ext}`, contentType })),
          `${ext} ${contentType}`,
        ).toBe('file');
      }
    }
  });

  it('SPEC-0010:UT-01 extensão de vídeo com Content-Type incompatível (text/html) é descartada', () => {
    expect(kindOf(response({ contentType: 'text/html' }))).toBeNull();
    expect(kindOf(response({ contentType: 'image/png' }))).toBeNull();
  });

  it('SPEC-0010:UT-01 resposta 206 com tamanho total vindo de Content-Range usa o total', () => {
    const r = classifyNetworkResponse(response({ statusCode: 206, contentLength: 5_000_000 }));

    expect(r).toMatchObject({ kind: 'file', sizeBytes: 5_000_000 });
  });

  it('SPEC-0010:UT-01 tamanho desconhecido é aceito (sem sizeBytes); o corte é 100 KiB', () => {
    const unknown = classifyNetworkResponse(
      (({ contentLength: _omit, ...rest }) => rest)(response()),
    );
    expect(unknown?.kind).toBe('file');
    expect(unknown?.sizeBytes).toBeUndefined();

    expect(kindOf(response({ contentLength: 100 * 1024 }))).toBe('file');
    expect(kindOf(response({ contentLength: 100 * 1024 - 1 }))).toBeNull();
  });

  it('SPEC-0010:UT-01 arquivo minúsculo (video/mp4 de 2 KiB) é descartado', () => {
    expect(classifyNetworkResponse(response({ contentLength: 2048 }))).toBeNull();
  });
});

describe('classifyNetworkResponse: HLS e DASH', () => {
  it('SPEC-0010:UT-01 Content-Type de playlist HLS vira hls', () => {
    for (const contentType of [
      'application/vnd.apple.mpegurl',
      'application/x-mpegurl',
      'audio/mpegurl',
    ]) {
      expect(
        kindOf(response({ url: 'https://cdn.example.test/play/master', contentType })),
        contentType,
      ).toBe('hls');
    }
  });

  it('SPEC-0010:UT-01 .m3u8 sem Content-Type útil (e com query) vira hls, mesmo pequeno', () => {
    const base = { contentType: 'application/octet-stream', contentLength: 600 };
    expect(kindOf(response({ ...base, url: 'https://cdn.example.test/p/master.m3u8' }))).toBe(
      'hls',
    );
    expect(kindOf(response({ ...base, url: 'https://cdn.example.test/p/master.m3u8?t=1' }))).toBe(
      'hls',
    );
  });

  it('SPEC-0010:UT-01 application/dash+xml ou .mpd vira dash', () => {
    expect(
      kindOf(response({ url: 'https://cdn.example.test/m', contentType: 'application/dash+xml' })),
    ).toBe('dash');
    expect(
      kindOf(
        response({
          url: 'https://cdn.example.test/m/manifest.mpd',
          contentType: 'application/octet-stream',
          contentLength: 900,
        }),
      ),
    ).toBe('dash');
  });
});

describe('classifyNetworkResponse: descartes', () => {
  it('SPEC-0010:UT-01 segmentos (.ts .m4s .aac .m4a .mp3 .vtt) são descartados', () => {
    for (const ext of ['ts', 'm4s', 'aac', 'm4a', 'mp3', 'vtt']) {
      for (const contentType of ['video/mp4', 'application/octet-stream', 'video/mp2t']) {
        expect(
          classifyNetworkResponse(
            response({ url: `https://cdn.example.test/seg/0001.${ext}?x=1`, contentType }),
          ),
          `${ext} ${contentType}`,
        ).toBeNull();
      }
    }
  });

  it('SPEC-0010:UT-01 imagens são descartadas', () => {
    expect(
      classifyNetworkResponse(
        response({ url: 'https://cdn.example.test/capa.jpg', contentType: 'image/jpeg' }),
      ),
    ).toBeNull();
    expect(
      classifyNetworkResponse(
        response({ url: 'https://cdn.example.test/capa.png', contentType: 'image/png' }),
      ),
    ).toBeNull();
  });

  it('SPEC-0010:UT-01 método diferente de GET é descartado', () => {
    for (const method of ['POST', 'HEAD', 'PUT']) {
      expect(classifyNetworkResponse(response({ method })), method).toBeNull();
    }
  });

  it('SPEC-0010:UT-01 status fora de 200/206 é descartado', () => {
    for (const statusCode of [204, 301, 304, 403, 404, 500]) {
      expect(classifyNetworkResponse(response({ statusCode })), String(statusCode)).toBeNull();
    }
  });

  it('SPEC-0010:UT-01 esquema que não é http(s) é descartado', () => {
    for (const url of [
      'blob:https://site.example.test/3f1c-uuid',
      'data:video/mp4;base64,AAAA',
      'ftp://files.example.test/a.mp4',
      'file:///tmp/a.mp4',
      'chrome-extension://abcdef/a.mp4',
    ]) {
      expect(classifyNetworkResponse(response({ url })), url).toBeNull();
    }
  });

  it('SPEC-0010:UT-01 tabId negativo (requisição fora de aba) é descartado; tabId 0 vale', () => {
    expect(classifyNetworkResponse(response({ tabId: -1 }))).toBeNull();
    expect(classifyNetworkResponse(response({ tabId: 0 }))?.kind).toBe('file');
  });

  it('SPEC-0010:UT-01 desempenho: classificar uma resposta leva menos de 1 ms em média', () => {
    const samples = [
      response(),
      response({ url: 'https://cdn.example.test/seg/1.ts', contentType: 'video/mp2t' }),
      response({ url: 'https://cdn.example.test/p/m.m3u8', contentType: 'application/x-mpegurl' }),
      response({ method: 'POST' }),
    ];
    const runs = 4000;

    const start = performance.now();
    for (let i = 0; i < runs; i++) {
      classifyNetworkResponse(samples[i % samples.length] as NetworkResponse);
    }
    const perCall = (performance.now() - start) / runs;

    expect(perCall).toBeLessThan(1);
  });
});
