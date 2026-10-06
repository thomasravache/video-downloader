/**
 * SPEC-0017:UT-06 — Texto do cartão no popup para AES-128 e chaves de i18n em pt_BR e en.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aes128NoteText } from '../../entrypoints/popup/aes128';
import type { HlsInfo } from '../../src/core/hls';

const NOTE_TEXT = 'Criptografado (AES-128): será descriptografado com a chave da sua sessão';

function hls(overrides: Partial<HlsInfo> = {}): HlsInfo {
  return {
    type: 'media',
    variants: [],
    encrypted: false,
    live: false,
    fmp4: false,
    segmentCount: 3,
    ...overrides,
  };
}

describe('SPEC-0017:UT-06 nota explicativa no cartão e chaves de internacionalização', () => {
  it('SPEC-0017:UT-06 hls com aes128: true exibe a nota explicativa aes128Note', () => {
    const candidateHls = hls({ aes128: true, encrypted: false });
    expect(aes128NoteText(candidateHls, NOTE_TEXT)).toBe(NOTE_TEXT);
  });

  it('SPEC-0017:UT-06 hls com encrypted: true ou sem nenhum não exibe a nota', () => {
    const encryptedHls = hls({ encrypted: true });
    expect(aes128NoteText(encryptedHls, NOTE_TEXT)).toBeUndefined();

    const plainHls = hls({ encrypted: false });
    expect(aes128NoteText(plainHls, NOTE_TEXT)).toBeUndefined();

    expect(aes128NoteText(undefined, NOTE_TEXT)).toBeUndefined();
  });

  it('SPEC-0017:UT-06 as chaves aes128Note, jobErrorKEY_FAILED e jobErrorDECRYPT_FAILED existem em pt_BR e en', () => {
    const messages = (locale: string) =>
      JSON.parse(
        readFileSync(
          join(import.meta.dirname, `../../public/_locales/${locale}/messages.json`),
          'utf8',
        ),
      ) as Record<string, { message: string }>;

    for (const locale of ['pt_BR', 'en']) {
      const all = messages(locale);
      expect(all['aes128Note']?.message.trim(), `aes128Note em ${locale}`).toBeTruthy();
      expect(
        all['jobErrorKEY_FAILED']?.message.trim(),
        `jobErrorKEY_FAILED em ${locale}`,
      ).toBeTruthy();
      expect(
        all['jobErrorDECRYPT_FAILED']?.message.trim(),
        `jobErrorDECRYPT_FAILED em ${locale}`,
      ).toBeTruthy();
    }
  });

  it('SPEC-0017:UT-06 o texto de aes128Note em pt_BR corresponde exatamente ao contrato da spec', () => {
    const pt = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../public/_locales/pt_BR/messages.json'), 'utf8'),
    ) as Record<string, { message: string }>;

    expect(pt['aes128Note']?.message).toBe(NOTE_TEXT);
  });
});
