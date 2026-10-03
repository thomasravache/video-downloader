/**
 * Contrato usado (SPEC-0014:CT-01; consome SPEC-0011@1, SPEC-0012@1 e SPEC-0013@1): extensões ADITIVAS.
 *   - HlsInfo/HlsVariant sem os campos novos continuam válidos (`validateHlsInfo`); com `audio` (HlsAudioTrack[])
 *     e `audioGroup` também; `audio` malformado (não-array, faixa sem url/nome/índice) é rejeitado;
 *   - candidatos com `hls.audio` passam em `validateDetectResponse`;
 *   - mensagem `download` sem `audioIndex` segue aceita; com `audioIndex` (inteiro >= 0) é aceita E preservada
 *     por `validateMessage` (não é descartada);
 *   - `start` do offscreen sem `audio` (SPEC-0012/0013) segue aceito; com `audio` válido também.
 */
import { describe, expect, it } from 'vitest';
import { isCommand } from '../../entrypoints/offscreen/commands';
import { validateDetectResponse } from '../../src/core/contracts';
import { validateHlsInfo } from '../../src/core/hls';
import { validateMessage } from '../../src/core/messages';

const SELF = 'ext-id';
const own = { id: SELF };

const variant = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  index: 0,
  url: 'https://cdn.example.test/v1080.m3u8',
  bandwidth: 3_200_000,
  label: '1080p',
  ...over,
});
const track = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  index: 0,
  groupId: 'a1',
  name: 'English',
  language: 'en',
  default: true,
  url: 'https://cdn.example.test/a.m3u8',
  ...over,
});
const master = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'master',
  variants: [variant()],
  encrypted: false,
  live: false,
  fmp4: true,
  ...over,
});

describe('HlsInfo: campos novos são aditivos', () => {
  it('SPEC-0014:CT-01 sem audio/audioGroup (SPEC-0011@1) continua válido, devolvendo o mesmo valor', () => {
    const input = master();

    expect(validateHlsInfo(input)).toEqual({ ok: true, value: input });
  });

  it('SPEC-0014:CT-01 com audio e audioGroup é válido (language opcional)', () => {
    const input = master({
      variants: [variant({ audioGroup: 'a1' })],
      audio: [track(), track({ index: 1, name: 'Português', default: false, language: undefined })],
    });

    expect(validateHlsInfo(input)).toEqual({ ok: true, value: input });
  });

  it('SPEC-0014:CT-01 audio vazio ou ausente é aceito; audio que não é lista é rejeitado', () => {
    expect(validateHlsInfo(master({ audio: [] })).ok).toBe(true);
    for (const audio of ['en', 42, {}, null, [null], ['en']]) {
      expect(validateHlsInfo(master({ audio })).ok, JSON.stringify(audio)).toBe(false);
    }
  });

  it('SPEC-0014:CT-01 faixa de áudio sem url, sem nome, sem groupId, sem index ou sem default é rejeitada', () => {
    for (const key of ['url', 'name', 'groupId', 'index', 'default']) {
      const { [key]: _removed, ...incomplete } = track();
      expect(validateHlsInfo(master({ audio: [incomplete] })).ok, key).toBe(false);
    }
    expect(validateHlsInfo(master({ audio: [track({ url: 42 })] })).ok).toBe(false);
    expect(validateHlsInfo(master({ audio: [track({ default: 'yes' })] })).ok).toBe(false);
  });

  it('SPEC-0014:CT-01 audioGroup que não é texto é rejeitado', () => {
    for (const audioGroup of [1, null, {}]) {
      expect(validateHlsInfo(master({ variants: [variant({ audioGroup })] })).ok).toBe(false);
    }
  });

  it('SPEC-0014:CT-01 a resposta de detect com candidato HLS que traz audio é válida', () => {
    const candidate = {
      id: 'c1',
      providerId: 'network',
      tabId: 1,
      pageUrl: 'https://site.example.test/aula',
      mediaUrl: 'https://cdn.example.test/master.m3u8',
      protection: 'none',
      support: 'downloadable',
      frameId: 0,
      frameUrl: '',
      kind: 'hls',
      source: 'network',
      hls: master({ variants: [variant({ audioGroup: 'a1' })], audio: [track()] }),
    };

    const respond = (c: unknown) =>
      validateDetectResponse({ ok: true, candidates: [c], access: { blockedOrigins: [] } }).ok;
    expect(respond({ ...candidate, hls: master() })).toBe(true);
    expect(respond(candidate)).toBe(true);
    expect(respond({ ...candidate, hls: master({ audio: 'en' }) })).toBe(false);
  });
});

describe('mensagem download: audioIndex opcional', () => {
  it('SPEC-0014:CT-01 sem audioIndex (SPEC-0012@1) continua aceita, com e sem variantIndex', () => {
    expect(validateMessage({ type: 'download', candidateId: 'abc' }, own, SELF)).toEqual({
      ok: true,
      message: { type: 'download', candidateId: 'abc' },
    });
    expect(
      validateMessage({ type: 'download', candidateId: 'abc', variantIndex: 2 }, own, SELF),
    ).toEqual({ ok: true, message: { type: 'download', candidateId: 'abc', variantIndex: 2 } });
  });

  it('SPEC-0014:CT-01 com audioIndex é aceita e o campo é preservado (variantIndex junto ou sozinho)', () => {
    expect(
      validateMessage({ type: 'download', candidateId: 'abc', audioIndex: 1 }, own, SELF),
    ).toEqual({ ok: true, message: { type: 'download', candidateId: 'abc', audioIndex: 1 } });
    expect(
      validateMessage(
        { type: 'download', candidateId: 'abc', variantIndex: 0, audioIndex: 3 },
        own,
        SELF,
      ),
    ).toEqual({
      ok: true,
      message: { type: 'download', candidateId: 'abc', variantIndex: 0, audioIndex: 3 },
    });
  });

  it('SPEC-0014:CT-01 audioIndex 0 é preservado (não é tratado como ausente)', () => {
    expect(
      validateMessage({ type: 'download', candidateId: 'abc', audioIndex: 0 }, own, SELF),
    ).toEqual({ ok: true, message: { type: 'download', candidateId: 'abc', audioIndex: 0 } });
  });
});

describe('start do offscreen: audio opcional', () => {
  const base = {
    target: 'offscreen',
    type: 'start',
    jobId: 'j1',
    urls: ['https://cdn.example.test/v.mp4'],
    initUrl: 'https://cdn.example.test/v.mp4',
    fmp4: true,
  };

  it('SPEC-0014:CT-01 start sem audio (SPEC-0012@1) e com ranges (SPEC-0013@1) seguem aceitos', () => {
    expect(isCommand(base)).toBe(true);
    expect(
      isCommand({
        ...base,
        ranges: [{ offset: 893, length: 100 }],
        initRange: { offset: 0, length: 893 },
      }),
    ).toBe(true);
  });

  it('SPEC-0014:CT-01 start com audio válido também é aceito', () => {
    expect(
      isCommand({
        ...base,
        audio: {
          urls: ['https://cdn.example.test/a.mp4'],
          initUrl: 'https://cdn.example.test/a.mp4',
          ranges: [{ offset: 728, length: 12793 }],
          initRange: { offset: 0, length: 728 },
        },
      }),
    ).toBe(true);
  });
});
