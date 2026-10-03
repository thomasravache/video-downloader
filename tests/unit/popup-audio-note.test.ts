/**
 * Contrato usado (SPEC-0014:UT-05): função PURA (sem DOM) do popup:
 *   entrypoints/popup/audio -> audioIncludedText(hls, variantIndex, format): string | undefined
 *   `format(nome)` é a tradução ("Inclui áudio: <nome>" / "Includes audio: <nome>", chave i18n `audioIncluded`);
 *   devolve o texto quando `chooseAudio(hls, variantIndex)` devolve uma faixa (nome da faixa escolhida), e
 *   `undefined` quando o download não vai juntar áudio ('none': variante sem áudio separado, master sem faixas,
 *   playlist de mídia). O nome entra como TEXTO (o chamador usa `textContent`).
 */
import { describe, expect, it } from 'vitest';
import { audioIncludedText } from '../../entrypoints/popup/audio';
import { parseHlsPlaylist } from '../../src/core/hls';
import type { HlsInfo } from '../../src/core/hls';

const BASE = 'https://cdn.example.test/hls/master.m3u8';
const format = (name: string): string => `Inclui áudio: ${name}`;

const MASTER = parseHlsPlaylist(
  [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",NAME="Português",LANGUAGE="pt",URI="pt.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="en.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a2",NAME="Deutsch",LANGUAGE="de",DEFAULT=YES,URI="de.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080,AUDIO="a1"',
    'v1080.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,AUDIO="a2"',
    'v720.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480',
    'v480.m3u8',
    '',
  ].join('\n'),
  BASE,
);

describe('texto "Inclui áudio" do cartão HLS', () => {
  it('SPEC-0014:UT-05 variante com áudio separado: "Inclui áudio: English" (a faixa DEFAULT do grupo)', () => {
    expect(audioIncludedText(MASTER, 0, format)).toBe('Inclui áudio: English');
  });

  it('SPEC-0014:UT-05 a faixa vem do grupo da variante escolhida (outra variante, outro grupo, outro nome)', () => {
    expect(audioIncludedText(MASTER, 1, format)).toBe('Inclui áudio: Deutsch');
  });

  it('SPEC-0014:UT-05 variante sem áudio separado (sem AUDIO=): nada', () => {
    expect(audioIncludedText(MASTER, 2, format)).toBeUndefined();
  });

  it('SPEC-0014:UT-05 master sem faixas, índice inexistente e playlist de mídia: nada', () => {
    const plain = parseHlsPlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nv.m3u8\n', BASE);
    const media: HlsInfo = {
      type: 'media',
      variants: [],
      encrypted: false,
      live: false,
      fmp4: true,
      segmentCount: 3,
    };
    expect(audioIncludedText(plain, 0, format)).toBeUndefined();
    expect(audioIncludedText(MASTER, 9, format)).toBeUndefined();
    expect(audioIncludedText(media, 0, format)).toBeUndefined();
  });

  it('SPEC-0014:UT-05 o nome da faixa é repassado sem alteração ao format (o chamador usa textContent)', () => {
    const hostile = parseHlsPlaylist(
      [
        '#EXTM3U',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",NAME="<img src=x onerror=alert(1)>",DEFAULT=YES,URI="a.m3u8"',
        '#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="a1"',
        'v.m3u8',
        '',
      ].join('\n'),
      BASE,
    );

    expect(audioIncludedText(hostile, 0, (name) => `[${name}]`)).toBe(
      '[<img src=x onerror=alert(1)>]',
    );
  });
});
