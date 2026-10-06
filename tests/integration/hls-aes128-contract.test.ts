/**
 * SPEC-0017:CT-01 — Contrato de compatibilidade retroativa e validação dos novos campos.
 */
import { describe, expect, it } from 'vitest';
import { isCommand } from '../../entrypoints/offscreen/commands';
import { validateHlsInfo } from '../../src/core/hls';
import { validateJobState } from '../../src/core/hls-download';
import type { EncryptionPlan } from '../../src/core/hls-download/protocol';

function validHlsInfo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'media',
    variants: [],
    durationSec: 10,
    segmentCount: 5,
    encrypted: false,
    live: false,
    fmp4: false,
    ...overrides,
  };
}

const validPlan: EncryptionPlan = {
  keys: [{ url: 'https://cdn.example.test/k.bin' }],
  segmentKeys: [0],
  mediaSequence: 0,
};

function validStart(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    target: 'offscreen',
    type: 'start',
    jobId: 'job-1',
    urls: ['https://cdn.example.test/seg.ts'],
    fmp4: false,
    ...overrides,
  };
}

function validJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobId: 'j1',
    candidateId: 'c1',
    variantIndex: 0,
    state: 'running',
    segmentsDone: 0,
    segmentsTotal: 5,
    bytesDone: 0,
    percent: 0,
    ...overrides,
  };
}

describe('SPEC-0017:CT-01 contrato aditivo de AES-128', () => {
  it('SPEC-0017:CT-01 aceita HlsInfo legado sem aes128 e aceita HlsInfo com aes128: true quando encrypted: false', () => {
    // Legado sem aes128
    const legacy = validHlsInfo();
    expect(validateHlsInfo(legacy).ok).toBe(true);

    // Novo com aes128: true
    const withAes = validHlsInfo({ aes128: true, encrypted: false });
    expect(validateHlsInfo(withAes).ok).toBe(true);
  });

  it('SPEC-0017:CT-01 rejeita HlsInfo com aes128: false ou combinação conflitante de aes128: true com encrypted: true', () => {
    const falseAes = validHlsInfo({ aes128: false });
    expect(validateHlsInfo(falseAes).ok).toBe(false);

    const conflicting = validHlsInfo({ aes128: true, encrypted: true });
    expect(validateHlsInfo(conflicting).ok).toBe(false);
  });

  it('SPEC-0017:CT-01 aceita comando start legado e aceita start com encryption válido', () => {
    expect(isCommand(validStart())).toBe(true);
    expect(isCommand(validStart({ encryption: validPlan }))).toBe(true);
  });

  it('SPEC-0017:CT-01 aceita comando start com audio contendo encryption válido', () => {
    const audio = {
      urls: ['https://cdn.example.test/a.m4s'],
      encryption: validPlan,
    };
    expect(isCommand(validStart({ fmp4: true, audio }))).toBe(true);
  });

  it('SPEC-0017:CT-01 JobState aceita erros legados e os novos erros KEY_FAILED e DECRYPT_FAILED', () => {
    for (const error of ['KEY_FAILED', 'DECRYPT_FAILED']) {
      const state = validJob({ state: 'error', error });
      expect(validateJobState(state).ok, `erro aceito: ${error}`).toBe(true);
    }
  });
});
