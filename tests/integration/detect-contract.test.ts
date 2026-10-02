/**
 * Contrato usado (SPEC-0009:CT-01; consumido pela SPEC-0010):
 *   src/core/contracts -> validateDetectResponse(input: unknown):
 *                           { ok: true, value: DetectResponse } | { ok: false, error: string }
 *   DetectResponse v2 = { ok: true, candidates: VideoCandidate[] (com frameId inteiro e frameUrl),
 *                         access: { blockedOrigins: string[] (origens http(s)) } }
 *                     | { ok: false, error: 'RESTRICTED_PAGE' | 'INVALID_MESSAGE' }
 */
import { describe, expect, it } from 'vitest';
import type { VideoCandidate } from '../../src/core/contracts';
import { validateDetectResponse } from '../../src/core/contracts';

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: VideoCandidate = {
    id: 'a1b2c3d4e5f60718',
    providerId: 'generic',
    tabId: 7,
    pageUrl: 'https://site.example.test/aula',
    mediaUrl: 'https://player.example.test/media/c.mp4',
    title: 'Aula',
    mimeType: 'video/mp4',
    protection: 'none',
    support: 'downloadable',
    frameId: 5,
    frameUrl: 'https://player.example.test/embed/1',
  };
  return { ...base, ...overrides };
}

function response(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    candidates: [candidate()],
    access: { blockedOrigins: ['https://blocked.example.test', 'http://localhost:8080'] },
    ...overrides,
  };
}

describe('contrato da resposta de detect v2', () => {
  it('SPEC-0009:CT-01 aceita candidatos com frameId e frameUrl e access.blockedOrigins', () => {
    const input = response();

    expect(validateDetectResponse(input)).toEqual({ ok: true, value: input });
  });

  it('SPEC-0009:CT-01 aceita lista vazia de candidatos e de origens bloqueadas, e frame 0', () => {
    expect(
      validateDetectResponse(
        response({ candidates: [candidate({ frameId: 0 })], access: { blockedOrigins: [] } }),
      ).ok,
    ).toBe(true);
    expect(
      validateDetectResponse(response({ candidates: [], access: { blockedOrigins: [] } })).ok,
    ).toBe(true);
  });

  it('SPEC-0009:CT-01 aceita as respostas de erro conhecidas', () => {
    expect(validateDetectResponse({ ok: false, error: 'RESTRICTED_PAGE' }).ok).toBe(true);
    expect(validateDetectResponse({ ok: false, error: 'INVALID_MESSAGE' }).ok).toBe(true);
  });

  it('SPEC-0009:CT-01 rejeita resposta ok sem access ou com access malformado', () => {
    const { access: _removed, ...withoutAccess } = response();

    expect(validateDetectResponse(withoutAccess).ok).toBe(false);
    expect(validateDetectResponse(response({ access: {} })).ok).toBe(false);
    expect(
      validateDetectResponse(response({ access: { blockedOrigins: 'https://a.test' } })).ok,
    ).toBe(false);
    expect(validateDetectResponse(response({ access: null })).ok).toBe(false);
  });

  it('SPEC-0009:CT-01 rejeita candidato sem frameId ou frameUrl, ou com frameId não inteiro', () => {
    const { frameId: _frameId, ...withoutFrameId } = candidate();
    const { frameUrl: _frameUrl, ...withoutFrameUrl } = candidate();

    for (const bad of [
      withoutFrameId,
      withoutFrameUrl,
      candidate({ frameId: 1.5 }),
      candidate({ frameId: '3' }),
      candidate({ frameId: null }),
      candidate({ frameUrl: 42 }),
    ]) {
      expect(validateDetectResponse(response({ candidates: [bad] })).ok, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it('SPEC-0009:CT-01 rejeita origem bloqueada que não seja http(s)', () => {
    for (const origin of [
      'ftp://files.example.test',
      'about:blank',
      'javascript:alert(1)',
      'data:text/html,x',
      'localhost',
      '',
      42,
    ]) {
      expect(
        validateDetectResponse(
          response({ access: { blockedOrigins: ['https://ok.test', origin] } }),
        ).ok,
        String(origin),
      ).toBe(false);
    }
  });

  it('SPEC-0009:CT-01 rejeita valores que não são resposta de detect', () => {
    for (const input of [
      null,
      undefined,
      'texto',
      42,
      [],
      {},
      { ok: true },
      { ok: true, candidates: 'x', access: { blockedOrigins: [] } },
      { ok: false },
      { ok: false, error: 'OUTRO_ERRO' },
    ]) {
      expect(validateDetectResponse(input).ok, JSON.stringify(input)).toBe(false);
    }
  });
});
