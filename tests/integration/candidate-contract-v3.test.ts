/**
 * Contrato usado (SPEC-0010:CT-01; consumido pela SPEC-0011):
 *   src/core/contracts -> validateDetectResponse(input): { ok: true, value } | { ok: false, error }
 *   VideoCandidate v3 = v2 + kind: 'file'|'hls'|'dash' (obrigatório) + source: 'dom'|'network' (obrigatório)
 * O validador é escrito à mão (sem biblioteca de schema).
 */
import { describe, expect, it } from 'vitest';
import { validateDetectResponse } from '../../src/core/contracts';

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a1b2c3d4e5f60718',
    providerId: 'generic',
    tabId: 7,
    pageUrl: 'https://site.example.test/aula',
    mediaUrl: 'https://cdn.example.test/media/c.mp4',
    protection: 'none',
    support: 'downloadable',
    frameId: 0,
    frameUrl: 'https://site.example.test/aula',
    kind: 'file',
    source: 'network',
    ...overrides,
  };
}

function response(c: Record<string, unknown>): Record<string, unknown> {
  return { ok: true, candidates: [c], access: { blockedOrigins: [] } };
}

describe('contrato de VideoCandidate v3', () => {
  it('SPEC-0010:CT-01 (guarda: passa antes da mudança) aceita todo kind em {file,hls,dash} combinado com todo source em {dom,network}', () => {
    for (const kind of ['file', 'hls', 'dash']) {
      for (const source of ['dom', 'network']) {
        const input = response(candidate({ kind, source }));

        expect(validateDetectResponse(input), `${kind}/${source}`).toEqual({
          ok: true,
          value: input,
        });
      }
    }
  });

  it('SPEC-0010:CT-01 rejeita kind desconhecido ou de tipo errado', () => {
    for (const kind of ['mss', 'FILE', 'video', '', 1, null, ['file']]) {
      expect(validateDetectResponse(response(candidate({ kind }))).ok, JSON.stringify(kind)).toBe(
        false,
      );
    }
  });

  it('SPEC-0010:CT-01 rejeita source desconhecido ou de tipo errado', () => {
    for (const source of ['cache', 'DOM', 'sniff', '', 0, null, ['dom']]) {
      expect(
        validateDetectResponse(response(candidate({ source }))).ok,
        JSON.stringify(source),
      ).toBe(false);
    }
  });

  it('SPEC-0010:CT-01 rejeita candidato sem kind ou sem source', () => {
    const { kind: _kind, ...withoutKind } = candidate();
    const { source: _source, ...withoutSource } = candidate();

    expect(validateDetectResponse(response(withoutKind)).ok).toBe(false);
    expect(validateDetectResponse(response(withoutSource)).ok).toBe(false);
  });

  it('SPEC-0010:CT-01 um único candidato inválido invalida a resposta inteira', () => {
    const input = {
      ok: true,
      candidates: [candidate(), candidate({ kind: 'mss' })],
      access: { blockedOrigins: [] },
    };

    expect(validateDetectResponse(input).ok).toBe(false);
  });
});
