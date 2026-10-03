/**
 * Contrato usado (SPEC-0015:UT-05): função PURA (sem DOM) do popup:
 *   entrypoints/popup/audio -> audioOptions(hls, variantIndex): AudioOption[]
 *   AudioOption = { index: number; label: string; default: boolean }
 *   - as opções são as faixas do GRUPO de áudio da variante `variantIndex` (mesmo critério de `chooseAudio`),
 *     na ordem de `hls.audio`; `index` = posição em `hls.audio` (o `audioIndex` do download);
 *   - `label` = nome da faixa; com idioma, "Nome (idioma)"; o texto não é interpretado (o chamador usa `textContent`);
 *   - `default: true` na faixa que `chooseAudio(hls, variantIndex)` (sem índice) devolve; nas demais, false;
 *   - grupo com 0 ou 1 faixa, variante sem `AUDIO=`, variante inexistente ou playlist de mídia: lista vazia
 *     (o seletor não aparece; com 1 faixa fica o "Inclui áudio" da SPEC-0014).
 */
import { describe, expect, it } from 'vitest';
import { audioOptions } from '../../entrypoints/popup/audio';
import { parseHlsPlaylist } from '../../src/core/hls';

const BASE = 'https://cdn.example.test/hls/master.m3u8';

const MASTER = parseHlsPlaylist(
  [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",NAME="Português",LANGUAGE="pt",URI="pt.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="en.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",NAME="Sem idioma",URI="x.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a2",NAME="Deutsch",LANGUAGE="de",DEFAULT=YES,URI="de.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a3",NAME="Español",LANGUAGE="es",URI="es.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a3",NAME="Italiano",LANGUAGE="it",URI="it.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080,AUDIO="a1"',
    'v1080.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,AUDIO="a2"',
    'v720.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=854x480,AUDIO="a3"',
    'v480.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360',
    'v360.m3u8',
    '',
  ].join('\n'),
  BASE,
);
// Posições em `audio`: 0 pt, 1 en (default), 2 sem idioma (grupo a1); 3 de (a2); 4 es, 5 it (a3).

describe('opções do seletor "Áudio"', () => {
  it('SPEC-0015:UT-05 grupo com 3 faixas: uma opção por faixa, na ordem, com a DEFAULT marcada e o idioma no rótulo', () => {
    expect(audioOptions(MASTER, 0)).toEqual([
      { index: 0, label: 'Português (pt)', default: false },
      { index: 1, label: 'English (en)', default: true },
      { index: 2, label: 'Sem idioma', default: false },
    ]);
  });

  it('SPEC-0015:UT-05 duas faixas sem DEFAULT: a padrão é a primeira (como chooseAudio sem índice) e é a única marcada', () => {
    const options = audioOptions(MASTER, 2);

    expect(options).toEqual([
      { index: 4, label: 'Español (es)', default: true },
      { index: 5, label: 'Italiano (it)', default: false },
    ]);
  });

  it('SPEC-0015:UT-05 grupo com UMA faixa: sem seletor (lista vazia)', () => {
    expect(audioOptions(MASTER, 1)).toEqual([]);
  });

  it('SPEC-0015:UT-05 variante sem AUDIO=, variante inexistente e índice negativo: sem seletor', () => {
    expect(audioOptions(MASTER, 3)).toEqual([]);
    expect(audioOptions(MASTER, 99)).toEqual([]);
    expect(audioOptions(MASTER, -1)).toEqual([]);
  });

  it('SPEC-0015:UT-05 as opções mudam com a variante (trocar a qualidade recalcula)', () => {
    const indexes = (variant: number): number[] =>
      audioOptions(MASTER, variant).map((o) => o.index);

    expect(indexes(0)).toEqual([0, 1, 2]);
    expect(indexes(2)).toEqual([4, 5]);
    expect(indexes(1)).toEqual([]);
    expect(indexes(0)).toEqual([0, 1, 2]);
  });

  it('SPEC-0015:UT-05 playlist de mídia ou master sem faixas de áudio: sem seletor', () => {
    const media = parseHlsPlaylist(
      '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\ns0.ts\n#EXT-X-ENDLIST\n',
      'https://cdn.example.test/m.m3u8',
    );
    const noAudio = parseHlsPlaylist(
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000,AUDIO="a1"\nv.m3u8\n',
      BASE,
    );

    expect(audioOptions(media, 0)).toEqual([]);
    expect(audioOptions(noAudio, 0)).toEqual([]);
  });

  it('SPEC-0015:UT-05 o nome da faixa vai como texto puro (sem interpretar marcação)', () => {
    const hls = parseHlsPlaylist(
      [
        '#EXTM3U',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",NAME="<img src=x onerror=alert(1)>",LANGUAGE="pt",DEFAULT=YES,URI="a.m3u8"',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",NAME="B",URI="b.m3u8"',
        '#EXT-X-STREAM-INF:BANDWIDTH=1000,AUDIO="a1"',
        'v.m3u8',
        '',
      ].join('\n'),
      BASE,
    );

    expect(audioOptions(hls, 0)[0]?.label).toBe('<img src=x onerror=alert(1)> (pt)');
  });
});
