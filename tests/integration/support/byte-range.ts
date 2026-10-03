/**
 * Fixture de byte range para os testes de integração da SPEC-0013 (não é teste): um ÚNICO arquivo fMP4
 * (`media.mp4`) montado com bytes REAIS do clipe fMP4 (init + 3 segmentos), com lixo antes, entre o init e o
 * 1º segmento e depois; a playlist aponta para trechos do arquivo (EXT-X-MAP BYTERANGE, 1º segmento
 * `len@off`, demais só `len`, como a playlist real do curso).
 */
import { concat, fmp4Init, fmp4Segments } from '../../unit/support/hls-clip';

const junk = (length: number, value: number): Uint8Array => new Uint8Array(length).fill(value);

export interface SingleFileFixture {
  /** O arquivo inteiro servido pelo servidor. */
  file: Uint8Array;
  /** Resultado esperado do job: init + segmentos, na ordem. */
  expectedOutput: Uint8Array;
  /** Cabeçalhos `Range` esperados: init primeiro, depois cada segmento. */
  ranges: string[];
  /** Texto da playlist; `uri` é o URI (com query, se for o caso) usado no MAP e em cada segmento. */
  playlist(uri?: string): string;
}

export function singleFileFixture(): SingleFileFixture {
  const init = fmp4Init();
  const segments = fmp4Segments();
  const lead = 40;
  const gap = 33;
  const initOffset = lead;
  const firstOffset = lead + init.byteLength + gap;
  const file = concat([junk(lead, 0xee), init, junk(gap, 0xdd), ...segments, junk(10, 0xcc)]);
  const header = (offset: number, length: number): string =>
    `bytes=${String(offset)}-${String(offset + length - 1)}`;
  const ranges = [header(initOffset, init.byteLength)];
  let at = firstOffset;
  for (const segment of segments) {
    ranges.push(header(at, segment.byteLength));
    at += segment.byteLength;
  }
  return {
    file,
    expectedOutput: concat([init, ...segments]),
    ranges,
    playlist(uri = 'media.mp4') {
      const lines = [
        '#EXTM3U',
        '#EXT-X-VERSION:6',
        '#EXT-X-TARGETDURATION:2',
        '#EXT-X-PLAYLIST-TYPE:VOD',
        `#EXT-X-MAP:URI="${uri}",BYTERANGE="${String(init.byteLength)}@${String(initOffset)}"`,
      ];
      segments.forEach((segment, i) => {
        lines.push(
          '#EXTINF:2.0,',
          `#EXT-X-BYTERANGE:${String(segment.byteLength)}${i === 0 ? `@${String(firstOffset)}` : ''}`,
          uri,
        );
      });
      lines.push('#EXT-X-ENDLIST', '');
      return lines.join('\n');
    },
  };
}
