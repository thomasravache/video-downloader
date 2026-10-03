/**
 * Contrato usado (SPEC-0014 §6, ADR-0014) — PROVA DE CONCEITO (fase 1, portão):
 *   entrypoints/offscreen/merge -> assembleMerged(video: {init, segments}, audio: {init, segments}): Promise<Uint8Array>
 *   Saída: MP4 com `ftyp` + `moov`, EXATAMENTE 2 trilhas (1 `vide`, 1 `soun`), pacotes copiados (sem recodificar),
 *   contagem de amostras igual à das fontes, duração de cada trilha ±0,2 s da fonte. Falha de junção rejeita com
 *   `AssemblyError` (`ASSEMBLY_FAILED`).
 * Fontes REAIS (e2e/fixtures/hls/split-av, geradas com ffmpeg): `video.mp4` só H.264 (`-an`) e `audio.mp4` só AAC
 * (`-vn`), fMP4 de arquivo único como o do curso (as duas com track_ID 1). A saída é lida por `inspectMp4`
 * (tests/unit/support/mp4.ts, sem ffprobe); a conferência com ffprobe é a evidência manual da spec.
 * A medição de tempo e pico de memória com ≈ 200 MB é INFORMATIVA (só registra no console).
 */
import { describe, expect, it } from 'vitest';
import { assembleMerged } from '../../entrypoints/offscreen/merge';
import { AssemblyError } from '../../src/core/hls-download';
import { concat } from '../unit/support/hls-clip';
import { inspectMp4, readBoxes } from '../unit/support/mp4';
import type { TrackInfo } from '../unit/support/mp4';
import { splitTrack } from './support/split-av';
import type { SplitTrack } from './support/split-av';

const video = splitTrack('video');
const audio = splitTrack('audio');
const asInput = (t: Pick<SplitTrack, 'init' | 'segments'>) => ({
  init: t.init,
  segments: t.segments,
});
const sourceInfo = (t: Pick<SplitTrack, 'init' | 'segments'>) =>
  inspectMp4(concat([t.init, ...t.segments]));
const only = (tracks: TrackInfo[], handler: string): TrackInfo => {
  const found = tracks.filter((t) => t.handler === handler);
  expect(found, `trilhas ${handler}`).toHaveLength(1);
  return found[0] as TrackInfo;
};

describe('assembleMerged: fMP4 só de vídeo + fMP4 só de áudio -> um MP4 com duas trilhas', () => {
  it('SPEC-0014:IT-01 as fontes são o que a spec descreve (guarda: uma trilha cada, track_ID 1, sem som no vídeo)', () => {
    const v = sourceInfo(video);
    const a = sourceInfo(audio);

    expect(v.tracks.map((t) => [t.handler, t.trackId])).toEqual([['vide', 1]]);
    expect(a.tracks.map((t) => [t.handler, t.trackId])).toEqual([['soun', 1]]);
    expect(v.tracks[0]?.sampleCount).toBeGreaterThan(0);
    expect(a.tracks[0]?.sampleCount).toBeGreaterThan(0);
  });

  it('SPEC-0014:IT-01 a saída tem ftyp+moov e exatamente 2 trilhas (vide 320x180 e soun) com track_ID distintos', async () => {
    const out = await assembleMerged(asInput(video), asInput(audio));

    const info = inspectMp4(out);
    expect(info.topLevel[0]).toBe('ftyp');
    expect(info.topLevel).toContain('moov');
    expect(info.tracks).toHaveLength(2);
    expect(info.tracks.map((t) => t.handler).sort()).toEqual(['soun', 'vide']);
    expect(new Set(info.tracks.map((t) => t.trackId)).size).toBe(2);
    expect(only(info.tracks, 'vide')).toMatchObject({ width: 320, height: 180 });
    // Pacotes copiados: as entradas de amostra de origem continuam (nada foi recodificado).
    expect(info.allTypes.has('avc1')).toBe(true);
    expect(info.allTypes.has('mp4a')).toBe(true);
    expect(info.allTypes.has('encv')).toBe(false);
    expect(info.allTypes.has('enca')).toBe(false);
  });

  it('SPEC-0014:IT-01 contagem de amostras igual à das fontes, em cada trilha', async () => {
    const out = await assembleMerged(asInput(video), asInput(audio));

    const info = inspectMp4(out);
    expect(only(info.tracks, 'vide').sampleCount).toBe(sourceInfo(video).tracks[0]?.sampleCount);
    expect(only(info.tracks, 'soun').sampleCount).toBe(sourceInfo(audio).tracks[0]?.sampleCount);
  });

  it('SPEC-0014:IT-01 a duração de cada trilha fica a ±0,2 s da fonte', async () => {
    const out = await assembleMerged(asInput(video), asInput(audio));

    const info = inspectMp4(out);
    const v = sourceInfo(video).tracks[0] as TrackInfo;
    const a = sourceInfo(audio).tracks[0] as TrackInfo;
    expect(Math.abs(only(info.tracks, 'vide').durationSec - v.durationSec)).toBeLessThanOrEqual(
      0.2,
    );
    expect(Math.abs(only(info.tracks, 'soun').durationSec - a.durationSec)).toBeLessThanOrEqual(
      0.2,
    );
  });

  it('SPEC-0014:IT-01 o tamanho é o das fontes (cópia de pacotes: sem recodificar nem perder dados)', async () => {
    const out = await assembleMerged(asInput(video), asInput(audio));

    const sources = video.file.byteLength + audio.file.byteLength;
    expect(out.byteLength).toBeGreaterThan(sources * 0.9);
    expect(out.byteLength).toBeLessThan(sources * 1.1);
    expect(() => readBoxes(out)).not.toThrow();
  });

  it('SPEC-0014:IT-01 as duas fontes têm track_ID 1: a saída não repete o track_ID', async () => {
    // As duas fontes têm track_ID 1; a junção não pode produzir duas trilhas com o mesmo ID.
    const info = inspectMp4(await assembleMerged(asInput(video), asInput(audio)));

    expect(info.tracks.map((t) => t.trackId).sort()).not.toEqual([1, 1]);
  });

  it('SPEC-0014:IT-01 bytes que não são MP4 rejeitam com AssemblyError ASSEMBLY_FAILED', async () => {
    const garbage = { init: new Uint8Array(64).fill(7), segments: [new Uint8Array(32).fill(9)] };

    const failure = await assembleMerged(garbage, asInput(audio)).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AssemblyError);
    expect((failure as AssemblyError).code).toBe('ASSEMBLY_FAILED');
  });
});

/** Fragmentos com `mdat` inflado por bytes de enchimento: as amostras (trun) são as mesmas, o volume cresce. */
function inflate(segments: readonly Uint8Array[], extraPerSegment: number): Uint8Array[] {
  return segments.map((segment) => {
    const mdat = readBoxes(segment).find((b) => b.type === 'mdat');
    if (!mdat) {
      throw new Error('segmento sem mdat');
    }
    const out = new Uint8Array(segment.byteLength + extraPerSegment);
    out.set(segment, 0);
    new DataView(out.buffer).setUint32(mdat.start, mdat.end - mdat.start + extraPerSegment);
    return out;
  });
}

describe('assembleMerged: medição informativa (sintético de ≈ 200 MB)', () => {
  it('SPEC-0014:IT-01 (informativo) registra tempo e pico de memória; a saída continua com 2 trilhas', async () => {
    const perSegment = Math.round((100 * 1024 * 1024) / video.segments.length);
    const perAudioSegment = Math.round((100 * 1024 * 1024) / audio.segments.length);
    const big = {
      video: { init: video.init, segments: inflate(video.segments, perSegment) },
      audio: { init: audio.init, segments: inflate(audio.segments, perAudioSegment) },
    };
    const inputBytes = [...big.video.segments, ...big.audio.segments].reduce(
      (sum, s) => sum + s.byteLength,
      0,
    );
    const baseline = process.memoryUsage().rss;
    let peak = baseline;
    const timer = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().rss);
    }, 10);

    const startedAt = performance.now();
    const out = await assembleMerged(big.video, big.audio);
    const elapsedMs = Math.round(performance.now() - startedAt);
    clearInterval(timer);
    peak = Math.max(peak, process.memoryUsage().rss);

    const mib = (n: number): string => (n / (1024 * 1024)).toFixed(0);
    console.info(
      `[SPEC-0014:IT-01 medição] entrada ${mib(inputBytes)} MiB; saída ${mib(out.byteLength)} MiB; ` +
        `tempo ${String(elapsedMs)} ms; pico de RSS ${mib(peak)} MiB (+${mib(peak - baseline)} MiB sobre a linha de base)`,
    );
    expect(inputBytes).toBeGreaterThan(190 * 1024 * 1024);
    const info = inspectMp4(out);
    expect(info.tracks.map((t) => t.handler).sort()).toEqual(['soun', 'vide']);
    expect(only(info.tracks, 'vide').sampleCount).toBe(sourceInfo(video).tracks[0]?.sampleCount);
    expect(only(info.tracks, 'soun').sampleCount).toBe(sourceInfo(audio).tracks[0]?.sampleCount);
  }, 180_000);
});
