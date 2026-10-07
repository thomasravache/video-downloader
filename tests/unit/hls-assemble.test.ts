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
import { assembleFmp4, assembleTs } from '../../entrypoints/offscreen/assemble';
import { AssemblyError } from '../../src/core/hls-download';
import {
  CLIP_DURATION_SEC,
  clipFile,
  concat,
  fmp4Init,
  fmp4Segments,
  tsSegments,
} from './support/hls-clip';
import { inspectMp4 } from './support/mp4';
import { withEncryptionBox } from './support/mp4-build';
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
