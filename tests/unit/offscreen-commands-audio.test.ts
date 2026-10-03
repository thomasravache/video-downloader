/**
 * Contrato usado (SPEC-0014 §6, UT-04): `isCommand` do offscreen valida o campo opcional `audio` do `start`:
 *   audio?: { urls: string[]; initUrl?: string; ranges?: (ByteRange|undefined)[]; initRange?: ByteRange }
 *   - `audio` é um objeto; `urls` não vazio, só http(s); `initUrl` (se houver) http(s);
 *   - `ranges` (se presente): MESMO tamanho de `audio.urls`; itens `undefined`/`null` (o `sendMessage` serializa
 *     `undefined` assim) ou {offset, length} válidos (as mesmas regras da SPEC-0013);
 *   - `initRange` só com `initUrl` e válido.
 * Sem `audio` o `start` da SPEC-0012@1/SPEC-0013@1 continua aceito.
 */
import { describe, expect, it } from 'vitest';
import { isCommand } from '../../entrypoints/offscreen/commands';

const VIDEO = ['https://cdn.example.test/v.mp4', 'https://cdn.example.test/v.mp4'];
const AUDIO_URLS = ['https://cdn.example.test/a.mp4', 'https://cdn.example.test/a.mp4'];
const start = (audio?: unknown, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  target: 'offscreen',
  type: 'start',
  jobId: 'j1',
  urls: VIDEO,
  initUrl: 'https://cdn.example.test/v.mp4',
  fmp4: true,
  ...(audio !== undefined && { audio }),
  ...over,
});
const range = (offset: number, length: number) => ({ offset, length });
const audio = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  urls: AUDIO_URLS,
  initUrl: 'https://cdn.example.test/a.mp4',
  ...over,
});

describe('isCommand: audio do start', () => {
  it('SPEC-0014:UT-04 aceita audio válido: só urls; com initUrl; com ranges e initRange', () => {
    expect(isCommand(start({ urls: AUDIO_URLS }))).toBe(true);
    expect(isCommand(start(audio()))).toBe(true);
    expect(
      isCommand(
        start(audio({ ranges: [range(893, 1000), range(1893, 1000)], initRange: range(0, 893) })),
      ),
    ).toBe(true);
  });

  it('SPEC-0014:UT-04 aceita null em audio.ranges (undefined serializado por sendMessage)', () => {
    expect(isCommand(start(audio({ ranges: [null, range(0, 10)] })))).toBe(true);
  });

  it('SPEC-0014:UT-04 rejeita audio que não é objeto', () => {
    for (const bad of ['audio', 42, [], [AUDIO_URLS], true, null]) {
      expect(isCommand(start(undefined, { audio: bad })), JSON.stringify(bad)).toBe(false);
    }
  });

  it('SPEC-0014:UT-04 rejeita audio.urls vazio, ausente, não-array ou com URL que não é http(s)', () => {
    expect(isCommand(start(audio({ urls: [] })))).toBe(false);
    expect(isCommand(start({ initUrl: 'https://cdn.example.test/a.mp4' }))).toBe(false);
    expect(isCommand(start(audio({ urls: 'https://cdn.example.test/a.mp4' })))).toBe(false);
    for (const bad of [
      'javascript:alert(1)',
      'data:audio/mp4;base64,AAAA',
      'file:///etc/passwd',
      'blob:https://x/y',
      'ftp://x/y',
      '',
      'not a url',
      42,
    ]) {
      expect(isCommand(start(audio({ urls: [AUDIO_URLS[0], bad] }))), String(bad)).toBe(false);
    }
  });

  it('SPEC-0014:UT-04 rejeita audio.initUrl que não é http(s)', () => {
    expect(isCommand(start(audio({ initUrl: 'javascript:alert(1)' })))).toBe(false);
    expect(isCommand(start(audio({ initUrl: 42 })))).toBe(false);
  });

  it('SPEC-0014:UT-04 rejeita audio.ranges de tamanho diferente de audio.urls (e não-array)', () => {
    expect(isCommand(start(audio({ ranges: [range(0, 10)] })))).toBe(false);
    expect(isCommand(start(audio({ ranges: [range(0, 10), range(10, 10), range(20, 10)] })))).toBe(
      false,
    );
    expect(isCommand(start(audio({ ranges: [] })))).toBe(false);
    expect(isCommand(start(audio({ ranges: 'bytes=0-9' })))).toBe(false);
  });

  it('SPEC-0014:UT-04 rejeita item de audio.ranges com faixa inválida', () => {
    const bad: unknown[] = [
      42,
      'x',
      [],
      { offset: -1, length: 10 },
      { offset: 0, length: 0 },
      { offset: 1.5, length: 10 },
      { offset: Number.NaN, length: 10 },
      { offset: '0', length: 10 },
      { offset: Number.MAX_SAFE_INTEGER, length: 1 },
    ];
    for (const item of bad) {
      expect(isCommand(start(audio({ ranges: [range(0, 10), item] }))), JSON.stringify(item)).toBe(
        false,
      );
    }
  });

  it('SPEC-0014:UT-04 rejeita audio.initRange sem audio.initUrl e initRange inválido', () => {
    expect(isCommand(start({ urls: AUDIO_URLS, initRange: range(0, 893) }))).toBe(false);
    expect(isCommand(start(audio({ initRange: range(-1, 5) })))).toBe(false);
    expect(isCommand(start(audio({ initRange: range(0, 0) })))).toBe(false);
    expect(isCommand(start(audio({ initRange: 'bytes=0-892' })))).toBe(false);
  });

  it('SPEC-0014:UT-04 audio inválido invalida o start inteiro, mesmo com o vídeo válido; o vídeo sem audio segue aceito', () => {
    expect(isCommand(start())).toBe(true);
    expect(isCommand(start(audio({ urls: [] })))).toBe(false);
    expect(
      isCommand(start(audio({ initRange: range(0, 0) }), { ranges: [range(0, 5), range(5, 5)] })),
    ).toBe(false);
  });
});
