/**
 * Contrato usado (SPEC-0011:UT-01..UT-05), parse puro de TEXTO de playlist, sem rede:
 *   src/core/hls -> parseHlsPlaylist(text, baseUrl): HlsInfo   (lança HlsParseError, code 'HLS_PARSE_FAILED')
 *                   HlsParseError, HlsInfo, HlsVariant
 *   HlsInfo v1: type 'master'|'media'; variants (master: banda decrescente; media: []); durationSec?;
 *     segmentCount?; encrypted; live; fmp4. HlsVariant: index, url (absoluta), bandwidth, width?, height?,
 *     codecs?, label ('<altura>p' ou '<round(bandwidth/1000)> kbps').
 * `HlsVariant.index` = posição na lista ORDENADA por banda decrescente (0 = maior; Emenda 1).
 * As fixtures de e2e/fixtures/hls/ também são lidas aqui para garantir que descrevem o que o E2E espera.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ParsedManifest } from 'm3u8-parser';
import { HlsParseError, parseHlsPlaylist, variantsOf } from '../../src/core/hls';

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
    info.variants.forEach((variant, i) => {
      expect(variant.index).toBe(i);
    });
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

describe('parseHlsPlaylist: regra de dúvida do METHOD (Emenda 2)', () => {
  const encryptedOf = (keyLine: string): boolean =>
    parseHlsPlaylist(withKey(keyLine), BASE).encrypted;

  it('SPEC-0011:UT-03 METHOD=NONE escondido na URI entre aspas, com METHOD=AES-128 real, é criptografada', () => {
    expect(encryptedOf('#EXT-X-KEY:URI="https://k/x?a,METHOD=NONE",METHOD=AES-128')).toBe(true);
  });

  it('SPEC-0011:UT-03 METHOD=NONE escondido em atributo desconhecido entre aspas, com SAMPLE-AES real, é criptografada', () => {
    expect(encryptedOf('#EXT-X-KEY:X-FOO="a,METHOD=NONE",METHOD=SAMPLE-AES')).toBe(true);
  });

  it('SPEC-0011:UT-03 METHOD=NONE só dentro de atributo entre aspas e nenhum METHOD real conta como criptografada', () => {
    expect(encryptedOf('#EXT-X-KEY:URI="https://k/x?a,METHOD=NONE"')).toBe(true);
    expect(encryptedOf('#EXT-X-KEY:URI="k.bin",X-FOO="METHOD=NONE"')).toBe(true);
  });

  it('SPEC-0011:UT-03 METHOD repetido conta como criptografada, em qualquer ordem', () => {
    expect(encryptedOf('#EXT-X-KEY:METHOD=NONE,METHOD=AES-128')).toBe(true);
    expect(encryptedOf('#EXT-X-KEY:METHOD=AES-128,METHOD=NONE')).toBe(true);
    expect(encryptedOf('#EXT-X-KEY:METHOD=NONE,METHOD=NONE')).toBe(true);
  });

  it('SPEC-0011:UT-03 METHOD ausente ou com valor desconhecido conta como criptografada', () => {
    expect(encryptedOf('#EXT-X-KEY:METHOD=FOO')).toBe(true);
    expect(encryptedOf('#EXT-X-KEY:URI="k.bin"')).toBe(true);
    expect(encryptedOf('#EXT-X-KEY:')).toBe(true);
  });

  it('SPEC-0011:UT-03 a mesma regra vale para EXT-X-SESSION-KEY no master', () => {
    const master = (sessionKey: string): string => `#EXTM3U
${sessionKey}
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720
v720.m3u8
`;

    expect(
      parseHlsPlaylist(
        master('#EXT-X-SESSION-KEY:URI="https://k/x?a,METHOD=NONE",METHOD=AES-128'),
        BASE,
      ).encrypted,
    ).toBe(true);
    // Emenda 3: EXT-X-SESSION-KEY de qualquer forma conta como criptografada.
    expect(parseHlsPlaylist(master('#EXT-X-SESSION-KEY:METHOD=NONE'), BASE).encrypted).toBe(true);
  });

  it('SPEC-0011:UT-03 METHOD=none/None em minúsculas conta como criptografada (lista de permissão, Emenda 3)', () => {
    expect(encryptedOf('#EXT-X-KEY:METHOD=none')).toBe(true);
    expect(encryptedOf('#EXT-X-KEY:METHOD=None')).toBe(true);
  });

  it('SPEC-0011:UT-03 guarda: exatamente #EXT-X-KEY:METHOD=NONE continua limpo', () => {
    expect(encryptedOf('#EXT-X-KEY:METHOD=NONE')).toBe(false);
  });

  it('SPEC-0011:UT-03 NONE com atributos extras conta como criptografada (Emenda 3, conservador)', () => {
    expect(encryptedOf('#EXT-X-KEY:METHOD=NONE,KEYFORMAT="identity"')).toBe(true);
    expect(encryptedOf('#EXT-X-KEY:KEYFORMAT="identity",METHOD=NONE')).toBe(true);
  });
});

describe('parseHlsPlaylist: lista de permissão de chaves (Emenda 3)', () => {
  const encryptedOf = (keyLine: string): boolean =>
    parseHlsPlaylist(withKey(keyLine), BASE).encrypted;

  const hostile: [string, string][] = [
    ['aspas soltas em atributo desconhecido', '#EXT-X-KEY:METHOD=NONE,X=a"b,METHOD=AES-128,Y="'],
    ['aspas soltas em A/D', '#EXT-X-KEY:METHOD=NONE,A=b"c,METHOD=AES-128,D=e"f'],
    ['URI com aspa sem fechar', '#EXT-X-KEY:METHOD=NONE,URI="x,METHOD=AES-128'],
    ['U+2028 dentro da string', '#EXT-X-KEY:METHOD=AES-128,URI="k "'],
    ['U+2029 dentro da string', '#EXT-X-KEY:METHOD=AES-128,URI="k "'],
    ['U+0085 dentro da string', '#EXT-X-KEY:METHOD=AES-128,URI="k\u0085"'],
    ['U+2028 seguido de METHOD=NONE', '#EXT-X-KEY:METHOD=AES-128,URI="k ",METHOD=NONE'],
    ['tag precedida de espaço', ' #EXT-X-KEY:METHOD=AES-128,URI="x"'],
    ['tag precedida de NBSP', ' #EXT-X-KEY:METHOD=AES-128,URI="x"'],
    ['tag precedida de U+2028', ' #EXT-X-KEY:METHOD=AES-128,URI="x"'],
    ['CR solto no meio da linha', '#EXT-X-KEY:METHOD=NONE\r,METHOD=AES-128'],
    ['valor em minúsculas', '#EXT-X-KEY:METHOD=none'],
    ['NONE com atributo extra', '#EXT-X-KEY:METHOD=NONE,URI="https://k/x"'],
    ['NONE com espaço final', '#EXT-X-KEY:METHOD=NONE '],
    ['NONE com NUL final', '#EXT-X-KEY:METHOD=NONE\0'],
    ['NONE com dois CR finais', '#EXT-X-KEY:METHOD=NONE\r\r'],
    ['NONE com tab final', '#EXT-X-KEY:METHOD=NONE\t'],
  ];

  it.each(hostile)('SPEC-0011:UT-03 %s conta como criptografada', (_name, keyLine) => {
    expect(encryptedOf(keyLine)).toBe(true);
  });

  it('SPEC-0011:UT-03 gêmeo de SESSION-KEY do caso URI sem fechar, num master, conta como criptografado', () => {
    const master = `#EXTM3U
#EXT-X-SESSION-KEY:METHOD=NONE,URI="x,METHOD=AES-128
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720
v720.m3u8
`;

    expect(parseHlsPlaylist(master, BASE).encrypted).toBe(true);
  });

  it('SPEC-0011:UT-03 SESSION-KEY de qualquer forma, também em playlist de mídia, conta como criptografada', () => {
    expect(encryptedOf('#EXT-X-SESSION-KEY:METHOD=NONE,URI="x,METHOD=AES-128')).toBe(true);
    expect(encryptedOf('#EXT-X-SESSION-KEY:METHOD=NONE')).toBe(true);
  });

  it('SPEC-0011:UT-03 guarda: exatamente #EXT-X-KEY:METHOD=NONE é limpo', () => {
    expect(encryptedOf('#EXT-X-KEY:METHOD=NONE')).toBe(false);
  });

  it('SPEC-0011:UT-03 guarda: exatamente #EXT-X-KEY:METHOD=NONE com finais de linha CRLF é limpo', () => {
    const crlf = withKey('#EXT-X-KEY:METHOD=NONE').replace(/\n/g, '\r\n');

    expect(parseHlsPlaylist(crlf, BASE).encrypted).toBe(false);
  });

  it('SPEC-0011:UT-03 guarda: BOM UTF-8 no início da playlist com METHOD=NONE é limpo', () => {
    const bom = `﻿${withKey('#EXT-X-KEY:METHOD=NONE')}`;

    expect(parseHlsPlaylist(bom, BASE).encrypted).toBe(false);
  });

  it('SPEC-0011:UT-03 guarda: playlist sem nenhuma tag de chave é limpa', () => {
    expect(parseHlsPlaylist(withKey(undefined), BASE).encrypted).toBe(false);
  });

  it('SPEC-0011:UT-03 guarda: tag em minúsculas é ignorada (as tags da RFC 8216 diferenciam maiúsculas)', () => {
    // Deliberado: `#ext-x-key` não é uma tag HLS; players não a interpretam, então não conta como chave.
    expect(encryptedOf('#ext-x-key:METHOD=AES-128,URI="x"')).toBe(false);
  });

  it('SPEC-0011:UT-03 propriedade: em 2.000 linhas de chave aleatórias, só é limpa a linha exatamente #EXT-X-KEY:METHOD=NONE', () => {
    // Gerador determinístico (mulberry32), sem dependência nova.
    let state = 0x5eed0011;
    const rand = (): number => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const fragments = [
      'METHOD=NONE',
      'METHOD=AES-128',
      'METHOD=SAMPLE-AES',
      '"',
      ',',
      '\r',
      ' ',
      'URI="k.bin"',
      'URI="x',
      ' ',
      'X-FOO',
      'X-FOO="a,METHOD=NONE"',
      '=',
    ];
    const EXACT = '#EXT-X-KEY:METHOD=NONE';
    let clean = 0;

    for (let i = 0; i < 2000; i += 1) {
      const count = Math.floor(rand() * 6);
      let line = '#EXT-X-KEY:';
      for (let j = 0; j < count; j += 1) {
        line += fragments[Math.floor(rand() * fragments.length)] ?? '';
      }
      // Um único \r final antes do \n é tolerado (CRLF) e não torna a linha suspeita.
      const expectClean = line === EXACT || line === `${EXACT}\r`;
      let encrypted = true;
      try {
        encrypted = parseHlsPlaylist(withKey(line), BASE).encrypted;
      } catch (error) {
        // Recusar a playlist (HLS_PARSE_FAILED) também é seguro: nunca devolve "limpa".
        expect(error, JSON.stringify(line)).toBeInstanceOf(HlsParseError);
      }
      if (!encrypted) {
        clean += 1;
      }

      expect(encrypted, JSON.stringify(line)).toBe(!expectClean);
    }

    expect(clean).toBeGreaterThan(0);
  });
});

describe('parseHlsPlaylist: limite de variantes e esquemas (Emenda 2)', () => {
  it('SPEC-0011:UT-06 master com 16.000 variantes devolve no máximo 50, as de maior banda, index 0..49 ordenado', () => {
    const lines = ['#EXTM3U'];
    for (let i = 1; i <= 16_000; i++) {
      lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${String(i * 1000)}`, `v${String(i)}.m3u8`);
    }

    const info = parseHlsPlaylist(lines.join('\n') + '\n', BASE);

    expect(info.variants.length).toBeLessThanOrEqual(50);
    expect(info.variants).toHaveLength(50);
    expect(info.variants.map((v) => v.index)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(info.variants[0]?.bandwidth).toBe(16_000_000);
    expect(info.variants[49]?.bandwidth).toBe(15_951_000);
    const bandwidths = info.variants.map((v) => v.bandwidth);
    expect(bandwidths).toEqual([...bandwidths].sort((a, b) => b - a));
  });

  it('SPEC-0011:UT-06 variantes com URL file:, javascript: e ftp: são descartadas; as http(s) ficam', () => {
    const text = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=9000000
file:///etc/passwd
#EXT-X-STREAM-INF:BANDWIDTH=8000000
javascript:alert(1)
#EXT-X-STREAM-INF:BANDWIDTH=7000000
ftp://cdn.example.test/v.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000
https://cdn.example.test/hls/v-abs.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1000000
http://cdn.example.test/hls/v-http.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=500000
rel.m3u8
`;

    const info = parseHlsPlaylist(text, BASE);

    expect(info.variants.map((v) => v.url)).toEqual([
      'https://cdn.example.test/hls/v-abs.m3u8',
      'http://cdn.example.test/hls/v-http.m3u8',
      'https://cdn.example.test/hls/rel.m3u8',
    ]);
    expect(info.variants.map((v) => v.index)).toEqual([0, 1, 2]);
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

describe('parseHlsPlaylist: deteccao de playlist de legendas (SPEC-0018:UT-04)', () => {
  it('SPEC-0018:UT-04 playlist HLS de mídia cujos segmentos sao .webvtt/.vtt e identificada como type subtitles', () => {
    const vttPlaylist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXTINF:4.0,
seg0.webvtt
#EXTINF:4.0,
seg1.vtt
#EXT-X-ENDLIST
`;
    const info = parseHlsPlaylist(vttPlaylist, 'https://cdn.example.test/hls/subtitles.m3u8');
    expect(info.type).toBe('subtitles');
  });
});

describe('parseHlsPlaylist: distinção de codecs e ordenação preferencial H.264 (SPEC-0019:UT-04)', () => {
  it('SPEC-0019:UT-04 quando há variantes com mesma resolução em codecs diferentes, rótulos incluem codec legível e AVC1 tem precedência sobre VP9', () => {
    const MASTER_CODEC_DUP = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=4800000,RESOLUTION=1920x1080,CODECS="vp09.00.41.08"
v1080-vp9.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4600000,RESOLUTION=1920x1080,CODECS="avc1.640028"
v1080-avc.m3u8
`;
    const info = parseHlsPlaylist(MASTER_CODEC_DUP, BASE);
    expect(info.variants).toHaveLength(2);

    // Em empate de resolução (ambas 1080p), a variante AVC1 deve ser posicionada antes da variante VP9
    expect(info.variants[0]?.codecs).toContain('avc1');
    expect(info.variants[1]?.codecs).toContain('vp09');

    // Os rótulos devem incluir o identificador de codec legível
    expect(info.variants[0]?.label).toContain('(H.264)');
    expect(info.variants[1]?.label).toContain('(VP9)');

    // Testa também que variantsOf pode ser invocado diretamente respeitando o mesmo contrato
    const parsedManifest: ParsedManifest = {
      playlists: [
        { uri: 'v1080-vp9.m3u8', attributes: { BANDWIDTH: 4800000, RESOLUTION: { width: 1920, height: 1080 }, CODECS: 'vp09.00.41.08' } },
        { uri: 'v1080-avc.m3u8', attributes: { BANDWIDTH: 4600000, RESOLUTION: { width: 1920, height: 1080 }, CODECS: 'avc1.640028' } },
      ],
    };
    const directVariants = variantsOf(parsedManifest, BASE);
    expect(directVariants[0]?.codecs).toContain('avc1');
    expect(directVariants[0]?.label).toContain('(H.264)');
  });
});

