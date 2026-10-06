/**
 * SPEC-0017:UT-05 — Validação de encryption em OffscreenStart e OffscreenAudio (commands.ts).
 */
import { describe, expect, it } from 'vitest';
import { isCommand } from '../../entrypoints/offscreen/commands';
import type { EncryptionPlan } from '../../src/core/hls-download/protocol';

const VIDEO_URLS = ['https://cdn.example.test/v0.ts', 'https://cdn.example.test/v1.ts'];
const AUDIO_URLS = ['https://cdn.example.test/a0.m4s', 'https://cdn.example.test/a1.m4s'];

const validPlan = (urls = VIDEO_URLS): EncryptionPlan => ({
  keys: [
    {
      url: 'https://cdn.example.test/key0.bin',
      iv: '0123456789abcdef0123456789abcdef',
    },
  ],
  segmentKeys: urls.map(() => 0),
  mediaSequence: 0,
});

const start = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  target: 'offscreen',
  type: 'start',
  jobId: 'job-1',
  urls: VIDEO_URLS,
  fmp4: false,
  ...overrides,
});

describe('SPEC-0017:UT-05 validação de encryption no comando start do offscreen', () => {
  it('SPEC-0017:UT-05 aceita start com encryption válido', () => {
    expect(isCommand(start({ encryption: validPlan() }))).toBe(true);
  });

  it('SPEC-0017:UT-05 aceita start com audio.encryption válido', () => {
    const audio = {
      urls: AUDIO_URLS,
      initUrl: 'https://cdn.example.test/init.mp4',
      encryption: validPlan(AUDIO_URLS),
    };
    expect(isCommand(start({ fmp4: true, audio }))).toBe(true);
  });

  it('SPEC-0017:UT-05 rejeita encryption com índice fora de keys', () => {
    const badPlan: EncryptionPlan = {
      keys: [{ url: 'https://cdn.example.test/k.bin' }],
      segmentKeys: [0, 5], // 5 fora do range de keys
      mediaSequence: 0,
    };
    expect(isCommand(start({ encryption: badPlan }))).toBe(false);
  });

  it('SPEC-0017:UT-05 rejeita encryption com segmentKeys de tamanho diferente de urls', () => {
    const badPlan: EncryptionPlan = {
      keys: [{ url: 'https://cdn.example.test/k.bin' }],
      segmentKeys: [0], // tamanho 1, mas urls tem tamanho 2
      mediaSequence: 0,
    };
    expect(isCommand(start({ encryption: badPlan }))).toBe(false);
  });

  it('SPEC-0017:UT-05 rejeita encryption com mais de 8 chaves', () => {
    const badPlan: EncryptionPlan = {
      keys: Array.from({ length: 9 }, (_, i) => ({
        url: `https://cdn.example.test/key${String(i)}.bin`,
      })),
      segmentKeys: [0, 1],
      mediaSequence: 0,
    };
    expect(isCommand(start({ encryption: badPlan }))).toBe(false);
  });

  it('SPEC-0017:UT-05 rejeita encryption com URL não-http(s)', () => {
    const badPlan: EncryptionPlan = {
      keys: [{ url: 'javascript:alert(1)' }],
      segmentKeys: [0, 0],
      mediaSequence: 0,
    };
    expect(isCommand(start({ encryption: badPlan }))).toBe(false);
  });

  it('SPEC-0017:UT-05 rejeita encryption com IV malformado (não tem 32 hex minúsculos sem 0x)', () => {
    const badIvPlan: EncryptionPlan = {
      keys: [{ url: 'https://cdn.example.test/k.bin', iv: '0x0123' }],
      segmentKeys: [0, 0],
      mediaSequence: 0,
    };
    expect(isCommand(start({ encryption: badIvPlan }))).toBe(false);
  });

  it('SPEC-0017:UT-05 rejeita audio.encryption inválido', () => {
    const audio = {
      urls: AUDIO_URLS,
      encryption: {
        keys: [{ url: 'https://cdn.example.test/k.bin' }],
        segmentKeys: [99], // inválido
        mediaSequence: 0,
      },
    };
    expect(isCommand(start({ fmp4: true, audio }))).toBe(false);
  });
});
