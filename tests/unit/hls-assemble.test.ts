/**
 * Contrato usado (SPEC-0012:UT-05) — entrypoints/offscreen/assemble.ts (mux.js REAL, bytes REAIS do clipe de fixture):
 *   assembleTs(init: Uint8Array | undefined, segments: readonly Uint8Array[]): Promise<Uint8Array>
 *     TS (H.264/AAC) -> MP4 (ftyp + moov + moof/mdat...), duração ≈ a do clipe (6 s), resolução da variante;
 *   assembleFmp4(init: Uint8Array, segments: readonly Uint8Array[]): Promise<Uint8Array>
 *     init + segmentos concatenados, init primeiro, bytes intactos;
 *   falhas rejeitam com AssemblyError (src/core/hls-download/errors) cujo `code` é:
 *     'UNSUPPORTED_CODEC'  nenhuma trilha H.264/AAC (ex.: MPEG-2/MP2 ou bytes que não são TS);
 *     'TOO_LARGE'          soma de byteLength > 1,5 GiB (checada ANTES de tocar nos dados);
 *     'ENCRYPTED' | 'UNSUPPORTED_CODEC'  init fMP4 com caixa sinf/schm (criptografia, p.ex. cenc).
 * O leitor de caixas MP4 de apoio é tests/unit/support/mp4.ts (sem ffprobe).
 */
import { describe, expect, it } from 'vitest';
import {
  assembleFmp4,
  assembleTs,
  normalizeTrunV1,
  transmuxTsToFmp4,
} from '../../entrypoints/offscreen/assemble';
import { AssemblyError } from '../../src/core/hls-download';
import {
  CLIP_DURATION_SEC,
  clipFile,
  concat,
  fmp4Init,
  fmp4Segments,
  tsSegments,
} from './support/hls-clip';
import { inspectMp4, readBoxes } from './support/mp4';
import { box, withEncryptionBox } from './support/mp4-build';
import { MAX_BUFFERED_BYTES } from '../../src/core/hls-download';

const DURATION_TOLERANCE = 0.6;

/** Objeto com o tamanho declarado de `bytes` bytes, sem alocar memória (só `byteLength` é lido). */
const declared = (bytes: number): Uint8Array => ({ byteLength: bytes }) as unknown as Uint8Array;

describe('leitor de caixas MP4 de apoio', () => {
  it('SPEC-0012:UT-05 (guarda: passa antes da mudança) lê um MP4 progressivo do ffmpeg: ftyp/moov/mdat, 160x120, ~2 s', () => {
    const info = inspectMp4(clipFile('../../sample.mp4'));

    expect(info.topLevel).toEqual(expect.arrayContaining(['ftyp', 'moov', 'mdat']));
    const video = info.tracks.find((t) => t.handler === 'vide');
    expect([video?.width, video?.height]).toEqual([160, 120]);
    expect(info.durationSec).toBeCloseTo(2, 0);
  });

  it('SPEC-0012:UT-05 (guarda: passa antes da mudança) lê o fMP4 do ffmpeg (init + fragmentos): 320x180, ~6 s', () => {
    const info = inspectMp4(concat([fmp4Init(), ...fmp4Segments()]));

    expect(info.topLevel).toEqual(expect.arrayContaining(['ftyp', 'moov', 'moof', 'mdat']));
    const video = info.tracks.find((t) => t.handler === 'vide');
    expect([video?.width, video?.height]).toEqual([320, 180]);
    expect(Math.abs(info.durationSec - CLIP_DURATION_SEC)).toBeLessThan(DURATION_TOLERANCE);
  });
});

describe('assembleTs: segmentos TS reais -> MP4 (mux.js)', () => {
  it('SPEC-0018:CH-01 (guarda: passa antes da mudança) assembleTs com os segmentos do clipe de fixture v360 gera MP4 válido com ftyp, moov e mdat', async () => {
    const mp4 = await assembleTs(undefined, tsSegments('v360'));

    const info = inspectMp4(mp4);
    expect(info.topLevel[0]).toBe('ftyp');
    expect(info.topLevel).toContain('moov');
    expect(info.topLevel).toContain('mdat');
  });

  it('SPEC-0012:UT-05 a variante 640x360 vira MP4 que começa com ftyp e contém moov e mdat', async () => {
    const mp4 = await assembleTs(undefined, tsSegments('v360'));

    const info = inspectMp4(mp4);
    expect(info.topLevel[0]).toBe('ftyp');
    expect(info.topLevel).toContain('moov');
    expect(info.topLevel).toContain('mdat');
    expect(info.topLevel.indexOf('moov')).toBeLessThan(info.topLevel.indexOf('mdat'));
  });

  it('SPEC-0012:UT-05 a duração do MP4 é ≈ a do clipe e há trilhas de vídeo (H.264) e de áudio (AAC)', async () => {
    const info = inspectMp4(await assembleTs(undefined, tsSegments('v360')));

    expect(Math.abs(info.durationSec - CLIP_DURATION_SEC)).toBeLessThan(DURATION_TOLERANCE);
    expect(info.tracks.map((t) => t.handler).sort()).toEqual(['soun', 'vide']);
    expect(info.allTypes.has('avc1')).toBe(true);
    expect(info.allTypes.has('mp4a')).toBe(true);
  });

  it('SPEC-0012:UT-05 a resolução do vídeo no tkhd é a da variante montada (640x360 e 320x180)', async () => {
    for (const [quality, width, height] of [
      ['v360', 640, 360],
      ['v180', 320, 180],
    ] as const) {
      const video = inspectMp4(await assembleTs(undefined, tsSegments(quality))).tracks.find(
        (t) => t.handler === 'vide',
      );
      expect([video?.width, video?.height], quality).toEqual([width, height]);
    }
  });

  it('SPEC-0012:UT-05 TS sem H.264/AAC (MPEG-2 + MP2) falha com AssemblyError UNSUPPORTED_CODEC', async () => {
    const promise = assembleTs(undefined, [clipFile('other-codec.mpegts')]);

    await expect(promise).rejects.toBeInstanceOf(AssemblyError);
    await expect(promise).rejects.toMatchObject({ code: 'UNSUPPORTED_CODEC' });
  });

  it('SPEC-0012:UT-05 bytes que não são TS também falham com UNSUPPORTED_CODEC (nunca um MP4 vazio)', async () => {
    const promise = assembleTs(undefined, [new Uint8Array(4096).fill(7)]);

    await expect(promise).rejects.toMatchObject({ code: 'UNSUPPORTED_CODEC' });
  });

  it('SPEC-0012:UT-05 lista de segmentos acima de 1,5 GiB falha com TOO_LARGE antes de montar', async () => {
    const promise = assembleTs(undefined, [declared(MAX_BUFFERED_BYTES), declared(1)]);

    await expect(promise).rejects.toBeInstanceOf(AssemblyError);
    await expect(promise).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });
});

describe('assembleFmp4: init + segmentos concatenados', () => {
  it('SPEC-0012:UT-05 o resultado é init seguido dos segmentos, na ordem, com os bytes intactos', async () => {
    const init = fmp4Init();
    const segments = fmp4Segments();

    const out = await assembleFmp4(init, segments);

    expect(out).toEqual(concat([init, ...segments]));
    expect(out.subarray(0, init.byteLength)).toEqual(init);
  });

  it('SPEC-0012:UT-05 o fMP4 montado é um MP4 válido: ftyp primeiro, moov, mdat, ~6 s e 320x180', async () => {
    const info = inspectMp4(await assembleFmp4(fmp4Init(), fmp4Segments()));

    expect(info.topLevel[0]).toBe('ftyp');
    expect(info.topLevel).toEqual(expect.arrayContaining(['moov', 'mdat']));
    expect(Math.abs(info.durationSec - CLIP_DURATION_SEC)).toBeLessThan(DURATION_TOLERANCE);
    const video = info.tracks.find((t) => t.handler === 'vide');
    expect([video?.width, video?.height]).toEqual([320, 180]);
  });

  it('SPEC-0012:UT-05 init com caixa sinf/schm (criptografia) é recusado: ENCRYPTED ou UNSUPPORTED_CODEC', async () => {
    const encryptedInit = withEncryptionBox(fmp4Init());
    expect(inspectMp4(encryptedInit).allTypes.has('schm')).toBe(true);

    const promise = assembleFmp4(encryptedInit, fmp4Segments());

    await expect(promise).rejects.toBeInstanceOf(AssemblyError);
    await expect(promise).rejects.toSatisfy((error: AssemblyError) =>
      ['ENCRYPTED', 'UNSUPPORTED_CODEC'].includes(error.code),
    );
  });

  it('SPEC-0012:UT-05 fMP4 acima de 1,5 GiB falha com TOO_LARGE', async () => {
    const promise = assembleFmp4(fmp4Init(), [declared(MAX_BUFFERED_BYTES)]);

    await expect(promise).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });
});

describe('transmuxer compatível e normalização de timestamps (SPEC-0018)', () => {
  it('SPEC-0018:UT-01 assembleTs remuxa TS com mediabunny gerando MP4 progressivo padronizado com duracao exata e caixas trun v1 normalizadas', async () => {
    const mp4 = await assembleTs(undefined, tsSegments('v360'));

    const info = inspectMp4(mp4);
    // MP4 progressivo padronizado finalizado com mediabunny (fastStart: 'in-memory')
    expect(info.topLevel).toEqual(expect.arrayContaining(['ftyp', 'moov', 'mdat']));
    expect(info.topLevel).not.toContain('moof');
    expect(info.tracks.every((t) => t.sampleCount > 0)).toBe(true);
    expect(Math.abs(info.durationSec - CLIP_DURATION_SEC)).toBeLessThan(0.6);
  });

  it('SPEC-0018:UT-02 fMP4 com anomalia de 27h (trun v0 e offset de composicao negativo) e normalizado para trun v1', () => {
    // Constrói fMP4 com trun em versão 0 e sample.compositionTimeOffset negativo (0xffff_e890 = -6000 ticks)
    const trunV0 = box(
      'trun',
      new Uint8Array([
        0,
        0,
        0x08,
        0x01, // version 0, flags (data_offset + comp_time_offsets)
        0,
        0,
        0,
        2, // sample count: 2
        0,
        0,
        0,
        0, // data offset: 0
        0,
        0,
        0,
        0, // sample 1 CTO: 0
        0xff,
        0xff,
        0xe8,
        0x90, // sample 2 CTO: -6000 (estouro em v0: 4294961296)
      ]),
    );
    const moof = box(
      'moof',
      box('mfhd', new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1])),
      box('traf', box('tfhd', new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1])), trunV0),
    );
    const fmp4WithAnomaly = concat([fmp4Init(), moof]);

    const normalized = normalizeTrunV1(fmp4WithAnomaly);
    const top = readBoxes(normalized);
    let trunVersion: number | undefined;
    for (const moof of top.filter((b) => b.type === 'moof')) {
      for (const traf of readBoxes(normalized, moof.payload, moof.end).filter(
        (b) => b.type === 'traf',
      )) {
        for (const trun of readBoxes(normalized, traf.payload, traf.end).filter(
          (b) => b.type === 'trun',
        )) {
          trunVersion = normalized[trun.payload];
        }
      }
    }

    // Versão da caixa trun deve ser 1
    expect(trunVersion).toBe(1);
  });

  it('SPEC-0018:CT-01 conformidade do contrato de assembleTs com rejeicoes de erro TOO_LARGE, UNSUPPORTED_CODEC e geracao de MP4 progressivo padronizado', async () => {
    // 1. Rejeição com TOO_LARGE quando excede 1.5 GiB
    await expect(
      assembleTs(undefined, [declared(MAX_BUFFERED_BYTES), declared(1)]),
    ).rejects.toMatchObject({
      code: 'TOO_LARGE',
    });

    // 2. Rejeição com UNSUPPORTED_CODEC para bytes corrompidos
    await expect(assembleTs(undefined, [new Uint8Array(4096).fill(7)])).rejects.toMatchObject({
      code: 'UNSUPPORTED_CODEC',
    });

    // 3. Montagem com sucesso gera MP4 progressivo padronizado (sem fragmentos moof)
    const mp4 = await assembleTs(undefined, tsSegments('v360'));
    const info = inspectMp4(mp4);
    expect(info.topLevel).toEqual(['ftyp', 'moov', 'mdat']);
    expect(info.topLevel).not.toContain('moof');
  });
});

describe('transmuxTsToFmp4 com múltiplos segmentos TS (SPEC-0020)', () => {
  it('SPEC-0020:UT-04 Transmux de áudio TS com múltiplos segmentos gera stream fMP4 contínuo contendo a duração total e todos os frames dos segmentos, sem parar no primeiro', async () => {
    const segments = [tsSegments('v180')[0] as Uint8Array, tsSegments('v180')[1] as Uint8Array];

    const { initSegment, fragments } = await transmuxTsToFmp4(segments);

    expect(initSegment).toBeDefined();
    expect(initSegment.byteLength).toBeGreaterThan(0);
    expect(fragments.length).toBeGreaterThanOrEqual(2);

    const fmp4 = concat([initSegment, ...fragments]);
    const info = inspectMp4(fmp4);
    expect(info.topLevel).toEqual(expect.arrayContaining(['moov', 'moof', 'mdat']));
    expect(info.durationSec).toBeGreaterThan(3.0);
  });
});
