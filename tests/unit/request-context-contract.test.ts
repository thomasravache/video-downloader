/**
 * Contrato usado (SPEC-0016:CT-01), aditivo sobre SPEC-0015@1 (src/core/contracts):
 *   - `VideoCandidate.initiatorOrigin?: string`: exatamente uma origem http(s) ("https://host[:porta]", sem
 *     caminho/query/fragmento); `validateDetectResponse` rejeita qualquer outra coisa quando o campo existe;
 *   - `validateResolveHlsResponse(input)` -> { ok: true, value } | { ok: false, error }: aceita
 *     `{ ok: true, hls }` e `{ ok: false, error, status? }` com `error` conhecido e `status` INTEIRO opcional;
 *   - sem os campos novos, tudo o que a SPEC-0015@1 aceitava continua aceito.
 */
import { describe, expect, it } from 'vitest';
import { validateDetectResponse, validateResolveHlsResponse } from '../../src/core/contracts';
import { parseHlsPlaylist } from '../../src/core/hls';

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a1b2c3d4e5f60718',
    providerId: 'network',
    tabId: 7,
    pageUrl: '',
    mediaUrl: 'https://cdn.exemplo.test/hls/master.m3u8',
    protection: 'none',
    support: 'unsupported-stream',
    frameId: 3,
    frameUrl: '',
    kind: 'hls',
    source: 'network',
    ...overrides,
  };
}

const detect = (c: Record<string, unknown>) =>
  validateDetectResponse({ ok: true, candidates: [c], access: { blockedOrigins: [] } });

describe('contrato do candidato com initiatorOrigin', () => {
  it('SPEC-0016:CT-01 (guarda) candidato sem o campo novo continua válido', () => {
    expect(detect(candidate()).ok).toBe(true);
  });

  it('SPEC-0016:CT-01 initiatorOrigin com origem http(s) válida é aceito (com e sem porta)', () => {
    for (const initiatorOrigin of [
      'https://player.exemplo.test',
      'http://x.test:8080',
      'http://127.0.0.1:5173',
    ]) {
      expect(detect(candidate({ initiatorOrigin })).ok, initiatorOrigin).toBe(true);
    }
  });

  it('SPEC-0016:CT-01 initiatorOrigin com caminho, query, fragmento, esquema não-http(s) ou tipo errado é rejeitado', () => {
    for (const initiatorOrigin of [
      'https://player.exemplo.test/',
      'https://player.exemplo.test/aula',
      'https://player.exemplo.test?q=1',
      'https://player.exemplo.test#f',
      'ftp://player.exemplo.test',
      'chrome-extension://abc',
      'file:///tmp',
      'player.exemplo.test',
      '',
      'null',
      'https://player.exemplo.test\r\nX: 1',
      7,
      null,
      true,
      ['https://player.exemplo.test'],
      { origin: 'https://player.exemplo.test' },
    ]) {
      expect(detect(candidate({ initiatorOrigin })).ok, JSON.stringify(initiatorOrigin)).toBe(
        false,
      );
    }
  });
});

describe('contrato do erro de resolveHls com status', () => {
  const hls = parseHlsPlaylist(
    '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nv.m3u8\n',
    'https://c.test/m.m3u8',
  );

  it('SPEC-0016:CT-01 erro de resolve sem status continua aceito (SPEC-0015@1)', () => {
    for (const error of [
      'CANDIDATE_NOT_FOUND',
      'HLS_FETCH_FAILED',
      'HLS_PARSE_FAILED',
      'INVALID_MESSAGE',
    ]) {
      const input = { ok: false, error };

      expect(validateResolveHlsResponse(input), error).toEqual({ ok: true, value: input });
    }
    expect(validateResolveHlsResponse({ ok: true, hls })).toEqual({
      ok: true,
      value: { ok: true, hls },
    });
  });

  it('SPEC-0016:CT-01 erro de resolve com status inteiro é aceito', () => {
    for (const status of [401, 403, 404, 500]) {
      const input = { ok: false, error: 'HLS_FETCH_FAILED', status };

      expect(validateResolveHlsResponse(input), String(status)).toEqual({ ok: true, value: input });
    }
  });

  it('SPEC-0016:CT-01 status que não é inteiro (decimal, texto, nulo, NaN, lista) é rejeitado', () => {
    for (const status of [403.5, '403', null, Number.NaN, Infinity, [403], {}, true]) {
      expect(
        validateResolveHlsResponse({ ok: false, error: 'HLS_FETCH_FAILED', status }).ok,
        `${typeof status}:${JSON.stringify(status)}`,
      ).toBe(false);
    }
  });

  it('SPEC-0016:CT-01 error desconhecido, ok ausente e entrada que não é objeto são rejeitados', () => {
    for (const input of [
      { ok: false, error: 'OUTRO' },
      { ok: false },
      { error: 'HLS_FETCH_FAILED' },
      null,
      'x',
      [],
    ]) {
      expect(validateResolveHlsResponse(input).ok, JSON.stringify(input)).toBe(false);
    }
  });
});
