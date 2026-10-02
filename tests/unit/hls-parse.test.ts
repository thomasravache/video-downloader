/**
 * Contrato usado (SPEC-0011:UT-01..UT-05), parse puro de TEXTO de playlist, sem rede:
 *   src/core/hls -> parseHlsPlaylist(text, baseUrl): HlsInfo   (lança HlsParseError, code 'HLS_PARSE_FAILED')
 *                   HlsParseError, HlsInfo, HlsVariant
 *   HlsInfo v1: type 'master'|'media'; variants (master: banda decrescente; media: []); durationSec?;
 *     segmentCount?; encrypted; live; fmp4. HlsVariant: index, url (absoluta), bandwidth, width?, height?,
 *     codecs?, label ('<altura>p' ou '<round(bandwidth/1000)> kbps').
 * Observação: `HlsVariant.index` não tem semântica fixada na spec (posição na lista ordenada ou na
 * playlist original); os testes só exigem que os índices formem uma permutação de 0..n-1.
 * As fixtures de e2e/fixtures/hls/ também são lidas aqui para garantir que descrevem o que o E2E espera.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HlsParseError, parseHlsPlaylist } from '../../src/core/hls';

const BASE = 'https://cdn.example.test/hls/master.m3u8';
const fixture = (name: string): string =>
  readFileSync(resolve(import.meta.dirname, '../../e2e/fixtures/hls', name), 'utf8');

/** Master fora de ordem de banda, com 2 variantes com RESOLUTION e 1 só com BANDWIDTH. */
const MASTER_MIXED = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
v720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=800000
audio-low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080
v1080.m3u8
`;

function indexes(variants: { index: number }[]): number[] {
  return variants.map((v) => v.index).sort((a, b) => a - b);
}

describe('parseHlsPlaylist: master e variantes', () => {
  it('SPEC-0011:UT-01 master com 3 variantes (com e sem RESOLUTION) volta ordenado por banda decrescente com rótulos 1080p/720p/<kbps> kbps', () => {
    const info = parseHlsPlaylist(MASTER_MIXED, BASE);

    expect(info.type).toBe('master');
    expect(info.variants.map((v) => v.bandwidth)).toEqual([3_200_000, 1_500_000, 800_000]);
    expect(info.variants.map((v) => v.label)).toEqual(['1080p', '720p', '800 kbps']);
    expect(info.variants.map((v) => v.url)).toEqual([
      'https://cdn.example.test/hls/v1080.m3u8',
      'https://cdn.example.test/hls/v720.m3u8',
      'https://cdn.example.test/hls/audio-low.m3u8',
    ]);
    expect(indexes(info.variants)).toEqual([0, 1, 2]);
    for (const variant of info.variants) {
      expect(Number.isInteger(variant.index)).toBe(true);
    }
  });

  it('SPEC-0011:UT-01 largura, altura e codecs vêm de RESOLUTION e CODECS; ausentes ficam indefinidos', () => {
    const [best, mid, low] = parseHlsPlaylist(MASTER_MIXED, BASE).variants;

    expect(best).toMatchObject({ width: 1920, height: 1080 });
    expect(best?.codecs).toBeUndefined();
    expect(mid).toMatchObject({ width: 1280, height: 720, codecs: 'avc1.64001f,mp4a.40.2' });
    expect(low?.width).toBeUndefined();
    expect(low?.height).toBeUndefined();
  });

  it('SPEC-0011:UT-01 a altura conhecida vence a banda no rótulo e o rótulo por banda arredonda para kbps', () => {
    const text = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1234567
a.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=999999,RESOLUTION=854x480
b.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=64000
c.m3u8
`;

    const info = parseHlsPlaylist(text, BASE);

    expect(info.variants.map((v) => v.label)).toEqual(['1235 kbps', '480p', '64 kbps']);
  });

  it('SPEC-0011:UT-01 a fixture master do E2E tem 3 qualidades 1080p/720p/480p', () => {
    const info = parseHlsPlaylist(fixture('master.m3u8'), 'http://127.0.0.1:1/hls/master.m3u8');

    expect(info.variants.map((v) => v.label)).toEqual(['1080p', '720p', '480p']);
    expect(info.variants.map((v) => v.url)).toEqual([
      'http://127.0.0.1:1/hls/v1080.m3u8',
      'http://127.0.0.1:1/hls/v720.m3u8',
      'http://127.0.0.1:1/hls/v480.m3u8',
    ]);
  });
});

const VOD = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:4.0,
seg0.ts
#EXTINF:4.0,
seg1.ts
#EXTINF:2.5,
seg2.ts
#EXT-X-ENDLIST
`;

describe('parseHlsPlaylist: playlist de mídia', () => {
  it('SPEC-0011:UT-02 VOD com ENDLIST: tipo media, variantes vazias, duração e segmentos somados, live e fmp4 falsos', () => {
    const info = parseHlsPlaylist(VOD, BASE);

    expect(info).toMatchObject({
      type: 'media',
      variants: [],
      segmentCount: 3,
      encrypted: false,
      live: false,
      fmp4: false,
    });
    expect(info.durationSec).toBeCloseTo(10.5, 5);
  });

  it('SPEC-0011:UT-02 sem EXT-X-ENDLIST a playlist é ao vivo', () => {
    const live = VOD.replace('#EXT-X-ENDLIST\n', '');

    const info = parseHlsPlaylist(live, BASE);

    expect(info).toMatchObject({ type: 'media', live: true, segmentCount: 3 });
  });

  it('SPEC-0011:UT-02 EXT-X-MAP liga fmp4 e não altera a contagem de segmentos', () => {
    const fmp4 = VOD.replace(
      '#EXT-X-MEDIA-SEQUENCE:0\n',
      '#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-MAP:URI="init.mp4"\n',
    );

    const info = parseHlsPlaylist(fmp4, BASE);

    expect(info).toMatchObject({ fmp4: true, segmentCount: 3, live: false, encrypted: false });
  });

  it('SPEC-0011:UT-02 as fixtures VOD, ao vivo, criptografada e fMP4 do E2E têm os sinais esperados', () => {
    const base = 'http://127.0.0.1:1/hls/x.m3u8';

    expect(parseHlsPlaylist(fixture('v1080.m3u8'), base)).toMatchObject({
      type: 'media',
      segmentCount: 3,
      live: false,
      encrypted: false,
      fmp4: false,
    });
    expect(parseHlsPlaylist(fixture('live.m3u8'), base)).toMatchObject({
      type: 'media',
      live: true,
      encrypted: false,
    });
    expect(parseHlsPlaylist(fixture('encrypted.m3u8'), base)).toMatchObject({
      type: 'media',
      live: false,
      encrypted: true,
    });
    expect(parseHlsPlaylist(fixture('fmp4.m3u8'), base)).toMatchObject({
      type: 'media',
      fmp4: true,
      live: false,
      encrypted: false,
    });
  });

  it('SPEC-0011:UT-02 desempenho: 5.000 segmentos em menos de 50 ms', () => {
    const segments = Array.from(
      { length: 5000 },
      (_, i) => `#EXTINF:2.000,\nhttps://cdn.example.test/seg/${String(i)}.ts?sig=${String(i)}`,
    ).join('\n');
    const text = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n${segments}\n#EXT-X-ENDLIST\n`;
    parseHlsPlaylist(VOD, BASE); // aquecimento do JIT

    const started = performance.now();
    const info = parseHlsPlaylist(text, BASE);
    const elapsed = performance.now() - started;

    expect(info.segmentCount).toBe(5000);
    expect(info.durationSec).toBeCloseTo(10_000, 3);
    expect(elapsed).toBeLessThan(50);
  });
});

function withKey(keyLine: string | undefined, extra = ''): string {
  return `#EXTM3U
#EXT-X-VERSION:5
#EXT-X-TARGETDURATION:4
${keyLine ?? ''}
${extra}
#EXTINF:4.0,
seg0.ts
#EXT-X-ENDLIST
`;
}

describe('parseHlsPlaylist: criptografia', () => {
  it('SPEC-0011:UT-03 METHOD=NONE e playlist sem EXT-X-KEY não são criptografadas', () => {
    expect(parseHlsPlaylist(withKey('#EXT-X-KEY:METHOD=NONE'), BASE).encrypted).toBe(false);
    expect(parseHlsPlaylist(withKey(undefined), BASE).encrypted).toBe(false);
  });

  it('SPEC-0011:UT-03 AES-128 é criptografada', () => {
    const info = parseHlsPlaylist(
      withKey('#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x00000000000000000000000000000001'),
      BASE,
    );

    expect(info.encrypted).toBe(true);
  });

  it('SPEC-0011:UT-03 SAMPLE-AES é criptografada', () => {
    const info = parseHlsPlaylist(
      withKey(
        '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://k",KEYFORMAT="com.apple.streamingkeydelivery"',
      ),
      BASE,
    );

    expect(info.encrypted).toBe(true);
  });

  it('SPEC-0011:UT-03 qualquer EXT-X-KEY com método diferente de NONE conta, mesmo seguido de METHOD=NONE', () => {
    const text = `#EXTM3U
#EXT-X-VERSION:5
#EXT-X-TARGETDURATION:4
#EXT-X-KEY:METHOD=AES-128,URI="k.bin"
#EXTINF:4.0,
a.ts
#EXT-X-KEY:METHOD=NONE
#EXTINF:4.0,
b.ts
#EXT-X-ENDLIST
`;

    expect(parseHlsPlaylist(text, BASE).encrypted).toBe(true);
  });

  it('SPEC-0011:UT-03 EXT-X-SESSION-KEY num master torna a playlist criptografada; sem ele o master é limpo', () => {
    const master = (sessionKey: string): string => `#EXTM3U
${sessionKey}
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720
v720.m3u8
`;

    expect(
      parseHlsPlaylist(
        master('#EXT-X-SESSION-KEY:METHOD=AES-128,URI="https://k.example.test/k"'),
        BASE,
      ).encrypted,
    ).toBe(true);
    expect(parseHlsPlaylist(master(''), BASE).encrypted).toBe(false);
  });
});

describe('parseHlsPlaylist: resolução de URLs', () => {
  it('SPEC-0011:UT-04 URLs de variantes relativas, de caminho absoluto e absolutas ficam absolutas e preservam a query', () => {
    const base = 'https://cdn.example.test/a/b/master.m3u8?basetoken=zzz';
    const text = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080
../v/720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720
/abs/x.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=854x480
https://other.example.test/p/y.m3u8?token=abc&x=1
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360
seg/360.m3u8?t=1&sig=a%2Fb
`;

    const info = parseHlsPlaylist(text, base);

    expect(info.variants.map((v) => v.url)).toEqual([
      'https://cdn.example.test/a/v/720.m3u8',
      'https://cdn.example.test/abs/x.m3u8',
      'https://other.example.test/p/y.m3u8?token=abc&x=1',
      'https://cdn.example.test/a/b/seg/360.m3u8?t=1&sig=a%2Fb',
    ]);
  });

  it('SPEC-0011:UT-04 a query da URL base não vaza para URLs relativas sem query', () => {
    const info = parseHlsPlaylist(
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nlow.m3u8\n',
      'https://cdn.example.test/hls/master.m3u8?token=segredo',
    );

    expect(info.variants[0]?.url).toBe('https://cdn.example.test/hls/low.m3u8');
  });
});

describe('parseHlsPlaylist: entrada inválida', () => {
  const garbage = Array.from({ length: 256 }, (_, i) => String.fromCharCode((i * 37) % 256)).join(
    '',
  );
  const inputs: [string, string][] = [
    ['texto vazio', ''],
    ['só espaços e quebras de linha', '  \n\r\n\t '],
    [
      'HTML',
      '<!doctype html><html><head><title>Erro</title></head><body><h1>404</h1></body></html>',
    ],
    ['lixo binário', garbage],
    ['texto comum sem #EXTM3U', 'olá mundo\nisto não é uma playlist\n'],
  ];

  it.each(inputs)(
    'SPEC-0011:UT-05 %s lança HlsParseError com code HLS_PARSE_FAILED',
    (_name, text) => {
      expect(() => parseHlsPlaylist(text, BASE)).toThrow(HlsParseError);
      try {
        parseHlsPlaylist(text, BASE);
      } catch (error) {
        expect(error).toBeInstanceOf(HlsParseError);
        expect(error).toMatchObject({ code: 'HLS_PARSE_FAILED' });
      }
    },
  );
});
