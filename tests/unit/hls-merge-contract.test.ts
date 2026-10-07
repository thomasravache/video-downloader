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
import { transmuxTsToFmp4 } from '../../entrypoints/offscreen/assemble';
import { isCommand } from '../../entrypoints/offscreen/commands';
import { assembleMerged } from '../../entrypoints/offscreen/merge';
import { validateDetectResponse } from '../../src/core/contracts';
import type { JobPlan, OffscreenStart } from '../../src/core/hls-download';
import { validateHlsInfo } from '../../src/core/hls';
import { validateMessage } from '../../src/core/messages';
import { tsSegments } from './support/hls-clip';
import { inspectMp4, readBoxes } from './support/mp4';
import { makePackedAacSegment } from './support/packed-aac';

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

  it('SPEC-0019:CT-01 JobPlan e OffscreenStart aceitam audio sem initUrl e mantêm compatibilidade com formato legado da SPEC-0014', () => {
    const startWithoutInit: OffscreenStart = {
      target: 'offscreen',
      type: 'start',
      jobId: 'j-ts',
      urls: ['https://cdn.example.test/v.mp4'],
      fmp4: true,
      audio: {
        urls: ['https://cdn.example.test/a1.ts', 'https://cdn.example.test/a2.ts'],
      },
    };
    expect(isCommand(startWithoutInit)).toBe(true);
    expect(startWithoutInit.audio?.initUrl).toBeUndefined();

    const planWithoutInit: JobPlan = {
      candidateId: 'c1',
      providerId: 'network',
      variantIndex: 0,
      filename: 'video.mp4',
      correlationId: 'corr-1',
      urls: ['https://cdn.example.test/v1.mp4'],
      fmp4: true,
      audio: {
        urls: ['https://cdn.example.test/a1.ts'],
      },
    };
    expect(planWithoutInit.audio?.initUrl).toBeUndefined();

    // Compatibilidade com SPEC-0014 (com initUrl)
    const planWithInit: JobPlan = {
      candidateId: 'c2',
      providerId: 'network',
      variantIndex: 1,
      filename: 'video2.mp4',
      correlationId: 'corr-2',
      urls: ['https://cdn.example.test/v2.mp4'],
      initUrl: 'https://cdn.example.test/v2-init.mp4',
      fmp4: true,
      audio: {
        urls: ['https://cdn.example.test/a2.mp4'],
        initUrl: 'https://cdn.example.test/a2-init.mp4',
      },
    };
    expect(planWithInit.audio?.initUrl).toBe('https://cdn.example.test/a2-init.mp4');
  });

  it('SPEC-0020:CT-01 Contrato JobPlan permite initUrl opcional no vídeo e no áudio', () => {
    const planWithoutBothInit: JobPlan = {
      candidateId: 'c-ts-both',
      providerId: 'network',
      variantIndex: 0,
      filename: 'video-ts-both.mp4',
      correlationId: 'corr-ts-both',
      urls: ['https://cdn.example.test/v1.ts', 'https://cdn.example.test/v2.ts'],
      fmp4: false,
      audio: {
        urls: ['https://cdn.example.test/a1.ts', 'https://cdn.example.test/a2.ts'],
      },
    };
    expect(planWithoutBothInit.initUrl).toBeUndefined();
    expect(planWithoutBothInit.fmp4).toBe(false);
    expect(planWithoutBothInit.audio?.initUrl).toBeUndefined();

    const startWithoutBothInit: OffscreenStart = {
      target: 'offscreen',
      type: 'start',
      jobId: 'j-ts-both',
      urls: ['https://cdn.example.test/v1.ts'],
      fmp4: false,
      audio: {
        urls: ['https://cdn.example.test/a1.ts'],
      },
    };
    expect(isCommand(startWithoutBothInit)).toBe(true);
    expect(startWithoutBothInit.initUrl).toBeUndefined();
    expect(startWithoutBothInit.audio?.initUrl).toBeUndefined();
  });
});

describe('transmuxTsToFmp4 e compatibilidade com assembleMerged (SPEC-0021)', () => {
  it('SPEC-0021:CT-01 Contrato do transmuxTsToFmp4 garante compatibilidade de saída com assembleMerged do Mediabunny para áudio e vídeo sem emitir track_id: 0', async () => {
    const audioSeg0 = makePackedAacSegment(0, 43);
    const audioSeg1 = makePackedAacSegment(90000, 43);
    const { initSegment, fragments } = await transmuxTsToFmp4([audioSeg0, audioSeg1]);

    // O contrato proíbe emitir track_id: 0 para contêiner MP4 válido (ISO/IEC 14496-12)
    const topInit = readBoxes(initSegment);
    const moov = topInit.find((b) => b.type === 'moov');
    expect(moov).toBeDefined();
    if (!moov) return;

    const trak = readBoxes(initSegment, moov.payload, moov.end).find((b) => b.type === 'trak');
    expect(trak).toBeDefined();
    if (!trak) return;

    const tkhd = readBoxes(initSegment, trak.payload, trak.end).find((b) => b.type === 'tkhd');
    expect(tkhd).toBeDefined();
    if (!tkhd) return;

    const tkhdView = new DataView(initSegment.buffer, initSegment.byteOffset);
    const tkhdVersion = initSegment[tkhd.payload];
    const tkhdTrackId = tkhdView.getUint32(tkhd.payload + (tkhdVersion === 1 ? 20 : 12));
    expect(tkhdTrackId).not.toBe(0);
    expect(tkhdTrackId).toBe(1);

    const mvex = readBoxes(initSegment, moov.payload, moov.end).find((b) => b.type === 'mvex');
    expect(mvex).toBeDefined();
    if (!mvex) return;

    const trex = readBoxes(initSegment, mvex.payload, mvex.end).find((b) => b.type === 'trex');
    expect(trex).toBeDefined();
    if (!trex) return;

    const trexTrackId = tkhdView.getUint32(trex.payload + 4);
    expect(trexTrackId).not.toBe(0);
    expect(trexTrackId).toBe(1);

    for (const frag of fragments) {
      const topFrag = readBoxes(frag);
      const moof = topFrag.find((b) => b.type === 'moof');
      expect(moof).toBeDefined();
      if (!moof) continue;

      const traf = readBoxes(frag, moof.payload, moof.end).find((b) => b.type === 'traf');
      expect(traf).toBeDefined();
      if (!traf) continue;

      const tfhd = readBoxes(frag, traf.payload, traf.end).find((b) => b.type === 'tfhd');
      expect(tfhd).toBeDefined();
      if (!tfhd) continue;

      const fragView = new DataView(frag.buffer, frag.byteOffset);
      const tfhdTrackId = fragView.getUint32(tfhd.payload + 4);
      expect(tfhdTrackId).not.toBe(0);
      expect(tfhdTrackId).toBe(1);
    }

    // Saída gerada deve ser compatível com assembleMerged do Mediabunny
    const videoResult = await transmuxTsToFmp4([tsSegments('v360')[0] as Uint8Array]);
    const videoBlob = new Blob([videoResult.initSegment, ...videoResult.fragments] as BlobPart[]);
    const audioBlob = new Blob([initSegment, ...fragments] as BlobPart[]);

    const merged = await assembleMerged({ blob: videoBlob }, { blob: audioBlob });
    const info = inspectMp4(merged);
    expect(info.tracks.map((t) => t.handler).sort()).toEqual(['soun', 'vide']);
    expect(info.tracks.every((t) => t.trackId !== 0)).toBe(true);
  });
});

