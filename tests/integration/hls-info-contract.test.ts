/**
 * Contrato usado (SPEC-0011:CT-01; consumido pela SPEC-0012):
 *   src/core/hls -> validateHlsInfo(input): { ok: true, value: HlsInfo } | { ok: false, error: string }
 *   HlsInfo v1 = { type: 'master'|'media'; variants: HlsVariant[]; durationSec?; segmentCount?;
 *                  encrypted: boolean; live: boolean; fmp4: boolean }
 *   HlsVariant = { index: number; url: string; bandwidth: number; width?; height?; codecs?; label: string }
 * O validador é escrito à mão (sem biblioteca de schema), como validateDetectResponse (SPEC-0010).
 */
import { describe, expect, it } from 'vitest';
import { validateHlsInfo } from '../../src/core/hls';

function variant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    index: 0,
    url: 'https://cdn.example.test/hls/v1080.m3u8',
    bandwidth: 3_200_000,
    width: 1920,
    height: 1080,
    codecs: 'avc1.640028,mp4a.40.2',
    label: '1080p',
    ...overrides,
  };
}

function master(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'master',
    variants: [
      variant(),
      variant({ index: 1, url: 'https://cdn.example.test/hls/v720.m3u8', label: '720p' }),
      variant({ index: 2, url: 'https://cdn.example.test/hls/a.m3u8', label: '800 kbps' }),
    ],
    durationSec: 10.5,
    segmentCount: 3,
    encrypted: false,
    live: false,
    fmp4: false,
    ...overrides,
  };
}

function media(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'media',
    variants: [],
    durationSec: 10.5,
    segmentCount: 3,
    encrypted: false,
    live: false,
    fmp4: true,
    ...overrides,
  };
}

function without(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const { [key]: _removed, ...rest } = source;
  return rest;
}

describe('contrato de HlsInfo v1', () => {
  it('SPEC-0011:CT-01 aceita um HlsInfo completo de master e de media, devolvendo o mesmo valor', () => {
    for (const input of [master(), media()]) {
      expect(validateHlsInfo(input)).toEqual({ ok: true, value: input });
    }
  });

  it('SPEC-0011:CT-01 aceita os campos opcionais ausentes (duração, segmentos, largura, altura e codecs)', () => {
    const bare = master({
      variants: [
        { index: 0, url: 'https://cdn.example.test/a.m3u8', bandwidth: 800_000, label: '800 kbps' },
      ],
    });
    const input = without(without(bare, 'durationSec'), 'segmentCount');

    expect(validateHlsInfo(input)).toEqual({ ok: true, value: input });
  });

  it('SPEC-0011:CT-01 rejeita objeto sem encrypted', () => {
    expect(validateHlsInfo(without(media(), 'encrypted')).ok).toBe(false);
    expect(validateHlsInfo(without(master(), 'encrypted')).ok).toBe(false);
  });

  it('SPEC-0011:CT-01 rejeita objeto sem live', () => {
    expect(validateHlsInfo(without(media(), 'live')).ok).toBe(false);
    expect(validateHlsInfo(without(master(), 'live')).ok).toBe(false);
  });

  it('SPEC-0011:CT-01 rejeita objeto sem fmp4, sem type ou sem variants (campos obrigatórios do contrato)', () => {
    for (const key of ['fmp4', 'type', 'variants']) {
      expect(validateHlsInfo(without(media(), key)).ok, key).toBe(false);
    }
  });

  it('SPEC-0011:CT-01 rejeita variantes sem url (ou com url que não é texto)', () => {
    expect(validateHlsInfo(master({ variants: [without(variant(), 'url')] })).ok).toBe(false);
    for (const url of [1, null, undefined, ['https://x.test/a.m3u8']]) {
      expect(validateHlsInfo(master({ variants: [variant({ url })] })).ok).toBe(false);
    }
  });

  it('SPEC-0011:CT-01 rejeita variante sem label, sem bandwidth ou sem index', () => {
    for (const key of ['label', 'bandwidth', 'index']) {
      expect(validateHlsInfo(master({ variants: [without(variant(), key)] })).ok, key).toBe(false);
    }
  });

  it('SPEC-0011:CT-01 rejeita type desconhecido e flags que não são booleanas', () => {
    expect(validateHlsInfo(media({ type: 'dash' })).ok).toBe(false);
    expect(validateHlsInfo(media({ type: 'MASTER' })).ok).toBe(false);
    for (const key of ['encrypted', 'live', 'fmp4']) {
      for (const value of ['true', 1, null]) {
        expect(validateHlsInfo(media({ [key]: value })).ok, `${key}=${String(value)}`).toBe(false);
      }
    }
  });

  it('SPEC-0011:CT-01 rejeita entradas que não são objetos', () => {
    for (const input of [null, undefined, 'hls', 42, [], [media()]]) {
      expect(validateHlsInfo(input).ok, JSON.stringify(input)).toBe(false);
    }
  });
});
