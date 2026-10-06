/**
 * SPEC-0017:UT-02 — Montagem do EncryptionPlan, rotação de chaves e derivação de IV.
 */
import { describe, expect, it } from 'vitest';
import { buildEncryptionPlan, deriveIv } from '../../src/aes128/plan';

const BASE_URL = 'https://cdn.example.test/hls/media.m3u8';

describe('SPEC-0017:UT-02 montagem do plano de criptografia e IVs', () => {
  it('SPEC-0017:UT-02 deriva IV em big-endian 128 bits a partir de mediaSequence + i', () => {
    // Sequência 0 + segmento 0 -> IV com 16 zeros
    const iv0 = deriveIv(0, 0);
    expect(iv0).toHaveLength(16);
    expect(iv0.every((b) => b === 0)).toBe(true);

    // Sequência 10 + segmento 5 -> 15 em big-endian nos últimos bytes
    const iv15 = deriveIv(10, 5);
    expect(iv15[15]).toBe(15);
    expect(iv15[14]).toBe(0);

    // Número grande: 0x010203
    const ivBig = deriveIv(0x10000, 0x0203);
    const view = new DataView(ivBig.buffer);
    expect(view.getBigUint64(8)).toBe(BigInt(0x10203));
  });

  it('SPEC-0017:UT-02 monta plano para playlist com chave única e IV implícito', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-MEDIA-SEQUENCE:100',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      '#EXTINF:2.0,',
      'seg0.ts',
      '#EXTINF:2.0,',
      'seg1.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const plan = buildEncryptionPlan(playlist, BASE_URL);
    expect(plan.mediaSequence).toBe(100);
    expect(plan.keys).toEqual([{ url: 'https://cdn.example.test/hls/key.bin' }]);
    expect(plan.segmentKeys).toEqual([0, 0]);
    expect(plan.initKey).toBeUndefined();
  });

  it('SPEC-0017:UT-02 monta plano com rotação de chaves e METHOD=NONE', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-KEY:METHOD=AES-128,URI="keyA.bin",IV=0x0123456789abcdef0123456789abcdef',
      '#EXTINF:2.0,',
      'seg0.ts',
      '#EXT-X-KEY:METHOD=AES-128,URI="keyB.bin",IV=0xfedcba9876543210fedcba9876543210',
      '#EXTINF:2.0,',
      'seg1.ts',
      '#EXT-X-KEY:METHOD=NONE',
      '#EXTINF:2.0,',
      'seg2.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const plan = buildEncryptionPlan(playlist, BASE_URL);
    expect(plan.keys).toHaveLength(2);
    expect(plan.keys[0]?.url).toBe('https://cdn.example.test/hls/keyA.bin');
    expect(plan.keys[0]?.iv).toBe('0123456789abcdef0123456789abcdef');
    expect(plan.keys[1]?.url).toBe('https://cdn.example.test/hls/keyB.bin');
    expect(plan.keys[1]?.iv).toBe('fedcba9876543210fedcba9876543210');
    // Segmentos: 0 usa keyA, 1 usa keyB, 2 usa NONE (null)
    expect(plan.segmentKeys).toEqual([0, 1, null]);
  });

  it('SPEC-0017:UT-02 aceita EXT-X-MAP quando a chave de init possui IV explícito', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x0123456789abcdef0123456789abcdef',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXTINF:2.0,',
      'seg0.m4s',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const plan = buildEncryptionPlan(playlist, BASE_URL);
    expect(plan.initKey).toBe(0);
    expect(plan.segmentKeys).toEqual([0]);
  });

  it('SPEC-0017:UT-02 recusa plano quando init (EXT-X-MAP) é cifrado sem IV explícito', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"', // sem IV explícito
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXTINF:2.0,',
      'seg0.m4s',
      '#EXT-X-ENDLIST',
    ].join('\n');

    expect(() => buildEncryptionPlan(playlist, BASE_URL)).toThrow();
  });
});
