/**
 * Contrato usado (SPEC-0015:CT-01; consome SPEC-0014@1 e SPEC-0013@1): `HlsInfo.mediaResources` é ADITIVO.
 *   - HlsInfo (master e media) SEM `mediaResources` (SPEC-0014@1) continua válido, devolvendo o mesmo valor;
 *   - com `mediaResources` (lista de strings, no máximo 32; vazia vale) é válido, também dentro de candidatos de
 *     `validateDetectResponse`;
 *   - `mediaResources` malformado é rejeitado: não é lista, itens que não são string, mais de 32 itens;
 *   - mensagem `download` sem `audioIndex` segue aceita; com `audioIndex` é aceita e preservada.
 */
import { describe, expect, it } from 'vitest';
import { validateDetectResponse } from '../../src/core/contracts';
import { validateHlsInfo } from '../../src/core/hls';
import { validateMessage } from '../../src/core/messages';

const SELF = 'ext-id';
const own = { id: SELF };

const master = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'master',
  variants: [
    {
      index: 0,
      url: 'https://cdn.example.test/v1080.m3u8',
      bandwidth: 3_200_000,
      label: '1080p',
      audioGroup: 'a1',
    },
  ],
  audio: [
    {
      index: 0,
      groupId: 'a1',
      name: 'English',
      default: true,
      url: 'https://cdn.example.test/a.m3u8',
    },
  ],
  encrypted: false,
  live: false,
  fmp4: true,
  ...over,
});
const media = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'media',
  variants: [],
  durationSec: 6,
  segmentCount: 3,
  encrypted: false,
  live: false,
  fmp4: true,
  ...over,
});
const resources = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `https://cdn.example.test/curso/arq-${String(i)}.mp4`);

describe('HlsInfo.mediaResources é aditivo', () => {
  it('SPEC-0015:CT-01 (guarda) HlsInfo da SPEC-0014@1, master ou media, sem mediaResources, continua válido', () => {
    for (const input of [master(), media()]) {
      expect(validateHlsInfo(input)).toEqual({ ok: true, value: input });
    }
  });

  it('SPEC-0015:CT-01 com mediaResources (1, 32 e vazia) é válido e o valor volta igual', () => {
    for (const list of [resources(1), resources(32), []]) {
      const input = master({ mediaResources: list });
      expect(validateHlsInfo(input)).toEqual({ ok: true, value: input });
    }
  });

  it('SPEC-0015:CT-01 mediaResources que não é lista é rejeitado (string, objeto, número, null)', () => {
    for (const bad of ['https://cdn.example.test/a.mp4', { 0: 'x' }, 7, null]) {
      expect(validateHlsInfo(master({ mediaResources: bad })).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('SPEC-0015:CT-01 mediaResources com item que não é string é rejeitado', () => {
    for (const bad of [[1], [null], [{ url: 'x' }], ['https://cdn.example.test/a.mp4', 2]]) {
      expect(validateHlsInfo(master({ mediaResources: bad })).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('SPEC-0015:CT-01 mediaResources com mais de 32 itens é rejeitado', () => {
    expect(validateHlsInfo(master({ mediaResources: resources(33) })).ok).toBe(false);
    expect(validateHlsInfo(master({ mediaResources: resources(200) })).ok).toBe(false);
  });

  it('SPEC-0015:CT-01 dentro de um candidato: com mediaResources válido a detecção é aceita; malformado, rejeitada', () => {
    const candidate = {
      id: 'c1',
      providerId: 'generic',
      tabId: 1,
      pageUrl: 'https://site.example.test/aula',
      mediaUrl: 'https://cdn.example.test/master.m3u8',
      protection: 'none',
      support: 'downloadable',
      frameId: 0,
      frameUrl: 'https://site.example.test/aula',
      kind: 'hls',
      source: 'network',
    };
    const respond = (c: unknown): boolean =>
      validateDetectResponse({ ok: true, candidates: [c], access: { blockedOrigins: [] } }).ok;

    expect(respond({ ...candidate, hls: master() })).toBe(true);
    expect(respond({ ...candidate, hls: master({ mediaResources: resources(2) }) })).toBe(true);
    expect(respond({ ...candidate, hls: master({ mediaResources: 'x' }) })).toBe(false);
    expect(respond({ ...candidate, hls: master({ mediaResources: resources(33) }) })).toBe(false);
  });
});

describe('mensagem download: audioIndex opcional (SPEC-0014@1)', () => {
  it('SPEC-0015:CT-01 (guarda) sem audioIndex segue aceita; com audioIndex é aceita e preservada', () => {
    expect(validateMessage({ type: 'download', candidateId: 'abc' }, own, SELF)).toEqual({
      ok: true,
      message: { type: 'download', candidateId: 'abc' },
    });
    expect(
      validateMessage(
        { type: 'download', candidateId: 'abc', variantIndex: 0, audioIndex: 1 },
        own,
        SELF,
      ),
    ).toEqual({
      ok: true,
      message: { type: 'download', candidateId: 'abc', variantIndex: 0, audioIndex: 1 },
    });
  });
});
