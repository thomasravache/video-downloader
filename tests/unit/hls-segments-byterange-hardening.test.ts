/**
 * SPEC-0013 (revisão, endurecimento fail-closed): offset implícito só vale após o segmento IMEDIATAMENTE
 * anterior do mesmo recurso (RFC 8216 §4.3.2.2); BYTERANGE em grafia não reconhecida é recusado; segmento
 * inteiro cujo URL coincide com um URL fatiado (ou o init) é playlist malformada.
 */
import { describe, expect, it } from 'vitest';
import { HlsParseError } from '../../src/core/hls';
import { parseMediaSegments } from '../../src/core/hls-download';
import { BR_BASE, COURSE_PLAYLIST, playlistOf } from './support/hls-byterange';

describe('parseMediaSegments: endurecimento de byte range', () => {
  it('SPEC-0013:UT-09 offset implícito depois de outro recurso no meio: HlsParseError', () => {
    const text = playlistOf([
      ['10@0', 'a.mp4'],
      ['10@0', 'b.mp4'],
      ['10', 'a.mp4'],
    ]);

    expect(() => parseMediaSegments(text, BR_BASE)).toThrow(HlsParseError);
  });

  it('SPEC-0013:UT-09 offset implícito depois de segmento sem BYTERANGE: HlsParseError', () => {
    const text = playlistOf([
      ['10@0', 'a.mp4'],
      ['', 'x.m4s'],
      ['10', 'a.mp4'],
    ]);

    expect(() => parseMediaSegments(text, BR_BASE)).toThrow(HlsParseError);
  });

  it('SPEC-0013:UT-09 offset implícito logo após o anterior do mesmo recurso continua válido', () => {
    const text = playlistOf([
      ['10@0', 'a.mp4'],
      ['10', 'a.mp4'],
      ['5@100', 'b.mp4'],
      ['5', 'b.mp4'],
    ]);

    expect(parseMediaSegments(text, BR_BASE).ranges).toEqual([
      { offset: 0, length: 10 },
      { offset: 10, length: 10 },
      { offset: 100, length: 5 },
      { offset: 105, length: 5 },
    ]);
    expect(parseMediaSegments(COURSE_PLAYLIST, BR_BASE).ranges).toHaveLength(4);
  });

  it.each([
    ['#EXT-X-BYTERANGE em minúsculas', '#ext-x-byterange:5@0\n'],
    ['#EXT-X-BYTERANGE com caixa mista', '#Ext-X-ByteRange:5@0\n'],
  ])('SPEC-0013:UT-10 %s não reconhecido: HlsParseError', (_name, line) => {
    const text = `#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\n${line}a.mp4\n#EXT-X-ENDLIST\n`;

    expect(() => parseMediaSegments(text, BR_BASE)).toThrow(HlsParseError);
  });

  it('SPEC-0013:UT-10 atributo byterange em minúsculas no EXT-X-MAP: HlsParseError', () => {
    const text = playlistOf([['5@0', 'a.mp4']], '#EXT-X-MAP:URI="a.mp4",byterange="5@0"\n');

    expect(() => parseMediaSegments(text, BR_BASE)).toThrow(HlsParseError);
  });

  it('SPEC-0013:UT-11 segmento sem faixa com o mesmo URL de um segmento fatiado: HlsParseError', () => {
    const text = playlistOf([
      ['10@0', 'a.mp4'],
      ['', 'a.mp4'],
    ]);

    expect(() => parseMediaSegments(text, BR_BASE)).toThrow(HlsParseError);
  });

  it('SPEC-0013:UT-11 segmento sem faixa com o mesmo URL do init: HlsParseError', () => {
    const text = playlistOf(
      [
        ['10@100', 'a.mp4'],
        ['', 'init.mp4'],
      ],
      '#EXT-X-MAP:URI="init.mp4"\n',
    );

    expect(() => parseMediaSegments(text, BR_BASE)).toThrow(HlsParseError);
  });
});
