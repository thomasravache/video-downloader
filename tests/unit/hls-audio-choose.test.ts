/**
 * Contrato usado (SPEC-0014:UT-03):
 *   src/core/hls-download -> chooseAudio(info, variantIndex, audioIndex?): HlsAudioTrack | 'none' | 'invalid'
 *   - variante sem `audioGroup`, grupo sem faixas ou variante inexistente na master sem áudio => 'none'
 *     (sem áudio separado: comportamento de hoje);
 *   - sem `audioIndex`: a faixa `default` do grupo da variante, senão a primeira do grupo;
 *   - `audioIndex` = posição em `info.audio`; precisa ser inteiro >= 0, existir e ser do MESMO grupo da
 *     variante; senão 'invalid'.
 */
import { describe, expect, it } from 'vitest';
import type { HlsAudioTrack, HlsInfo, HlsVariant } from '../../src/core/hls';
import { chooseAudio } from '../../src/core/hls-download';

const variant = (index: number, audioGroup?: string): HlsVariant => ({
  index,
  url: `https://cdn.example.test/v${String(index)}.m3u8`,
  bandwidth: 1_000_000 - index,
  label: `${String(720 - index)}p`,
  ...(audioGroup !== undefined && { audioGroup }),
});
const track = (index: number, groupId: string, name: string, isDefault = false): HlsAudioTrack => ({
  index,
  groupId,
  name,
  default: isDefault,
  url: `https://cdn.example.test/${name}.m3u8`,
});
const info = (variants: HlsVariant[], audio?: HlsAudioTrack[]): HlsInfo => ({
  type: 'master',
  variants,
  encrypted: false,
  live: false,
  fmp4: false,
  ...(audio !== undefined && { audio }),
});

/** a1: [en (default), pt]; a2: [fr, de (default)]; a3: [it] (sem DEFAULT). */
const AUDIO = [
  track(0, 'a1', 'en', true),
  track(1, 'a1', 'pt'),
  track(2, 'a2', 'fr'),
  track(3, 'a2', 'de', true),
  track(4, 'a3', 'it'),
];
const MASTER = info(
  [variant(0, 'a1'), variant(1, 'a2'), variant(2, 'a3'), variant(3), variant(4, 'sem-faixas')],
  AUDIO,
);

describe('chooseAudio', () => {
  it('SPEC-0014:UT-03 sem audioIndex devolve a faixa DEFAULT do grupo da variante (mesmo quando não é a primeira)', () => {
    expect(chooseAudio(MASTER, 0)).toBe(AUDIO[0]);
    expect(chooseAudio(MASTER, 1)).toBe(AUDIO[3]);
  });

  it('SPEC-0014:UT-03 sem DEFAULT no grupo devolve a primeira faixa do grupo', () => {
    expect(chooseAudio(MASTER, 2)).toBe(AUDIO[4]);
    const noDefault = info([variant(0, 'a1')], [track(0, 'a1', 'pt'), track(1, 'a1', 'en')]);
    expect(chooseAudio(noDefault, 0)).toMatchObject({ name: 'pt' });
  });

  it('SPEC-0014:UT-03 audioIndex válido (do mesmo grupo) devolve a faixa escolhida, inclusive a não padrão', () => {
    expect(chooseAudio(MASTER, 0, 1)).toBe(AUDIO[1]);
    expect(chooseAudio(MASTER, 0, 0)).toBe(AUDIO[0]);
    expect(chooseAudio(MASTER, 1, 2)).toBe(AUDIO[2]);
  });

  it('SPEC-0014:UT-03 audioIndex de OUTRO grupo é invalid', () => {
    expect(chooseAudio(MASTER, 0, 2)).toBe('invalid');
    expect(chooseAudio(MASTER, 1, 0)).toBe('invalid');
    expect(chooseAudio(MASTER, 2, 3)).toBe('invalid');
  });

  it('SPEC-0014:UT-03 audioIndex inexistente, negativo ou não inteiro é invalid', () => {
    for (const bad of [
      5,
      99,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
    ]) {
      expect(chooseAudio(MASTER, 0, bad), String(bad)).toBe('invalid');
    }
  });

  it('SPEC-0014:UT-03 variante sem audioGroup, grupo sem faixas e master sem áudio devolvem none (sem áudio separado)', () => {
    expect(chooseAudio(MASTER, 3)).toBe('none');
    expect(chooseAudio(MASTER, 4)).toBe('none');
    expect(chooseAudio(info([variant(0, 'a1')]), 0)).toBe('none');
    expect(chooseAudio(info([variant(0)], AUDIO), 0)).toBe('none');
  });

  it('SPEC-0014:UT-03 variante sem áudio separado com audioIndex: invalid (não há grupo ao qual a faixa pertença)', () => {
    expect(chooseAudio(MASTER, 3, 0)).toBe('invalid');
    expect(chooseAudio(MASTER, 4, 0)).toBe('invalid');
  });
});
