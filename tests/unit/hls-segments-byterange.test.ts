/**
 * SPEC-0013 (substitui os testes de recusa da SPEC-0012: mudança deliberada de comportamento).
 * Contrato usado (SPEC-0013 §6): `parseMediaSegments(text, baseUrl)` devolve, além de `urls`/`initUrl`,
 *   `ranges?: (ByteRange | undefined)[]` (mesma ordem de `urls`, só se algum segmento tem BYTERANGE) e
 *   `initRange?: ByteRange` (BYTERANGE do EXT-X-MAP), com offsets RESOLVIDOS (`len` sem `@` = fim da faixa
 *   anterior do MESMO URL). Faixa inválida ou offset implícito sem faixa anterior => `HlsParseError`.
 */
import { describe, expect, it } from 'vitest';
import { HlsParseError } from '../../src/core/hls';
import { parseMediaSegments } from '../../src/core/hls-download';
import {
  BR_BASE,
  BR_FILE,
  COURSE_FIRST_OFFSET,
  COURSE_LENGTHS,
  COURSE_PLAYLIST,
  playlistOf,
} from './support/hls-byterange';
import { clipText } from './support/hls-clip';

describe('parseMediaSegments: faixas de bytes', () => {
  it('SPEC-0013:UT-01 len@off em cada segmento: ranges alinhados a urls com offset/length corretos', () => {
    const text = playlistOf([
      ['1000@0', 'a.mp4'],
      ['500@2000', 'a.mp4'],
      ['700@5000', 'b.mp4'],
    ]);

    const media = parseMediaSegments(text, BR_BASE);

    expect(media.urls).toEqual([
      'https://cdn.example.test/curso/a.mp4',
      'https://cdn.example.test/curso/a.mp4',
      'https://cdn.example.test/curso/b.mp4',
    ]);
    expect(media.ranges).toEqual([
      { offset: 0, length: 1000 },
      { offset: 2000, length: 500 },
      { offset: 5000, length: 700 },
    ]);
  });

  it('SPEC-0013:UT-01 segmento sem BYTERANGE numa playlist com ranges: ranges[i] é undefined (busca o URL inteiro)', () => {
    const text = playlistOf([
      ['1000@0', 'a.mp4'],
      ['', 'whole.m4s'],
      ['300@1000', 'a.mp4'],
    ]);

    const media = parseMediaSegments(text, BR_BASE);

    expect(media.urls).toHaveLength(3);
    expect(media.ranges).toHaveLength(3);
    expect(media.ranges?.[0]).toEqual({ offset: 0, length: 1000 });
    expect(media.ranges?.[1]).toBeUndefined();
    expect(media.ranges?.[2]).toEqual({ offset: 1000, length: 300 });
  });

  it('SPEC-0013:UT-02 playlist real do curso: offset implícito = fim da faixa anterior; a soma bate com o último fim', () => {
    const media = parseMediaSegments(COURSE_PLAYLIST, BR_BASE);

    expect(media.urls).toEqual(COURSE_LENGTHS.map(() => BR_FILE));
    const ranges = media.ranges ?? [];
    expect(ranges).toHaveLength(COURSE_LENGTHS.length);
    let expectedOffset = COURSE_FIRST_OFFSET;
    COURSE_LENGTHS.forEach((length, i) => {
      expect(ranges[i], `segmento ${String(i)}`).toEqual({ offset: expectedOffset, length });
      expectedOffset += length;
    });
    expect(ranges[1]?.offset).toBe(1573 + 1_060_672);
    const last = ranges[ranges.length - 1];
    expect((last?.offset ?? 0) + (last?.length ?? 0)).toBe(
      COURSE_FIRST_OFFSET + COURSE_LENGTHS.reduce((a, b) => a + b, 0),
    );
    expect(media.fmp4).toBe(true);
    expect(media.durationSec).toBeCloseTo(14.5, 3);
  });

  it('SPEC-0013:UT-03 EXT-X-MAP com BYTERANGE: initRange {0, 893} e initUrl resolvido', () => {
    const media = parseMediaSegments(COURSE_PLAYLIST, BR_BASE);

    expect(media.initUrl).toBe(BR_FILE);
    expect(media.initRange).toEqual({ offset: 0, length: 893 });
  });

  it('SPEC-0013:UT-03 EXT-X-MAP BYTERANGE sem offset (len) com outro offset explícito: initRange fiel ao texto', () => {
    const text = playlistOf(
      [['500@900', 'a.mp4']],
      '#EXT-X-MAP:URI="init.mp4",BYTERANGE="120@40"\n',
    );

    const media = parseMediaSegments(text, BR_BASE);

    expect(media.initRange).toEqual({ offset: 40, length: 120 });
    expect(media.initUrl).toBe('https://cdn.example.test/curso/init.mp4');
  });
});

describe('parseMediaSegments: faixas inválidas e offsets implícitos sem base', () => {
  const invalid = [
    '0@10',
    '-5@0',
    'abc@0',
    '100@-1',
    '100@abc',
    '9007199254740991@1',
    '1@9007199254740991',
    '9007199254740992@0',
  ];
  for (const range of invalid) {
    it(`SPEC-0013:UT-04 BYTERANGE:${range} em segmento -> HlsParseError`, () => {
      const text = playlistOf([[range, 'a.mp4']]);

      expect(() => parseMediaSegments(text, BR_BASE)).toThrow(HlsParseError);
    });
  }

  it('SPEC-0013:UT-04 BYTERANGE inválido no EXT-X-MAP -> HlsParseError', () => {
    for (const range of ['0@0', 'x@0', '10@-3']) {
      const text = playlistOf(
        [['100@0', 'a.mp4']],
        `#EXT-X-MAP:URI="a.mp4",BYTERANGE="${range}"\n`,
      );

      expect(() => parseMediaSegments(text, BR_BASE), range).toThrow(HlsParseError);
    }
  });

  it('SPEC-0013:UT-04 (limite) offset + length igual a Number.MAX_SAFE_INTEGER ainda é válido', () => {
    const text = playlistOf([[`1@${String(Number.MAX_SAFE_INTEGER - 1)}`, 'a.mp4']]);

    expect(parseMediaSegments(text, BR_BASE).ranges).toEqual([
      { offset: Number.MAX_SAFE_INTEGER - 1, length: 1 },
    ]);
  });

  it('SPEC-0013:UT-05 1º segmento com len sem @ -> HlsParseError', () => {
    const text = playlistOf([
      ['1000', 'a.mp4'],
      ['1000', 'a.mp4'],
    ]);

    expect(() => parseMediaSegments(text, BR_BASE)).toThrow(HlsParseError);
    // O mesmo texto com offset explícito no 1º segmento é aceito (a recusa é do offset implícito).
    const ok = playlistOf([
      ['1000@0', 'a.mp4'],
      ['1000', 'a.mp4'],
    ]);
    expect(parseMediaSegments(ok, BR_BASE).ranges).toEqual([
      { offset: 0, length: 1000 },
      { offset: 1000, length: 1000 },
    ]);
  });

  it('SPEC-0013:UT-05 troca de recurso sem @ -> HlsParseError (o offset implícito só vale dentro do mesmo URL)', () => {
    const bad = playlistOf([
      ['1000@0', 'a.mp4'],
      ['500', 'b.mp4'],
    ]);
    const good = playlistOf([
      ['1000@0', 'a.mp4'],
      ['500@0', 'b.mp4'],
      ['500', 'b.mp4'],
    ]);

    expect(() => parseMediaSegments(bad, BR_BASE)).toThrow(HlsParseError);
    expect(parseMediaSegments(good, BR_BASE).ranges).toEqual([
      { offset: 0, length: 1000 },
      { offset: 0, length: 500 },
      { offset: 500, length: 500 },
    ]);
  });

  it('SPEC-0013:UT-02 recursos alternados: o offset implícito segue a última faixa do mesmo URL', () => {
    const text = playlistOf([
      ['1000@0', 'a.mp4'],
      ['400@0', 'b.mp4'],
      ['300@1000', 'a.mp4'],
      ['300', 'a.mp4'],
    ]);

    expect(parseMediaSegments(text, BR_BASE).ranges?.[3]).toEqual({ offset: 1300, length: 300 });
  });
});

describe('parseMediaSegments: sem faixas de bytes (guarda)', () => {
  it('SPEC-0013:UT-06 playlist TS sem BYTERANGE: mesmo resultado de antes, sem ranges nem initRange', () => {
    const media = parseMediaSegments(clipText('v180.m3u8'), 'https://h.test/hls/clip/v180.m3u8');

    expect(media.urls).toEqual(
      [0, 1, 2].map((i) => `https://h.test/hls/clip/v180-${String(i)}.mpegts`),
    );
    expect(media.fmp4).toBe(false);
    expect(media.initUrl).toBeUndefined();
    expect(media.durationSec).toBeCloseTo(6, 0);
    expect(media).not.toHaveProperty('ranges');
    expect(media).not.toHaveProperty('initRange');
  });

  it('SPEC-0013:UT-06 playlist fMP4 em arquivos (EXT-X-MAP sem BYTERANGE): initUrl, sem ranges nem initRange', () => {
    const media = parseMediaSegments(
      clipText('fmp4/media.m3u8'),
      'https://h.test/hls/clip/fmp4/media.m3u8',
    );

    expect(media.fmp4).toBe(true);
    expect(media.initUrl).toBe('https://h.test/hls/clip/fmp4/init.mp4');
    expect(media.urls).toEqual(
      [0, 1, 2].map((i) => `https://h.test/hls/clip/fmp4/f-${String(i)}.m4s`),
    );
    expect(media).not.toHaveProperty('ranges');
    expect(media).not.toHaveProperty('initRange');
  });
});
