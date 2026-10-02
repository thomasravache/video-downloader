/**
 * Contrato usado (SPEC-0012, revisão MAJOR-1): `parseMediaSegments(text, baseUrl)` recusa (lança
 * `HlsParseError`) a playlist que depende de EXT-X-BYTERANGE (segmento) ou de BYTERANGE em EXT-X-MAP;
 * baixar o arquivo inteiro ignorando a faixa produziria um MP4 corrompido marcado como salvo.
 * Download por Range está fora do escopo da spec.
 */
import { describe, expect, it } from 'vitest';
import { HlsParseError } from '../../src/core/hls';
import { parseMediaSegments } from '../../src/core/hls-download';

const BASE = 'https://cdn.example.test/hls/media.m3u8';
const head = '#EXTM3U\n#EXT-X-VERSION:4\n#EXT-X-TARGETDURATION:2\n';

describe('parseMediaSegments: faixas de bytes', () => {
  it('SPEC-0012:UT-01 EXT-X-BYTERANGE em um segmento -> HlsParseError', () => {
    const text = `${head}#EXTINF:2.0,\n#EXT-X-BYTERANGE:1000@0\nall.ts\n#EXTINF:2.0,\n#EXT-X-BYTERANGE:1000@1000\nall.ts\n#EXT-X-ENDLIST\n`;

    expect(() => parseMediaSegments(text, BASE)).toThrow(HlsParseError);
  });

  it('SPEC-0012:UT-01 EXT-X-MAP com BYTERANGE -> HlsParseError', () => {
    const text = `${head}#EXT-X-MAP:URI="all.mp4",BYTERANGE="720@0"\n#EXTINF:2.0,\ns0.m4s\n#EXT-X-ENDLIST\n`;

    expect(() => parseMediaSegments(text, BASE)).toThrow(HlsParseError);
  });

  it('SPEC-0012:UT-01 (guarda) playlist sem faixas continua aceita', () => {
    const text = `${head}#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2.0,\ns0.m4s\n#EXT-X-ENDLIST\n`;

    expect(parseMediaSegments(text, BASE)).toMatchObject({
      urls: ['https://cdn.example.test/hls/s0.m4s'],
      initUrl: 'https://cdn.example.test/hls/init.mp4',
      fmp4: true,
    });
  });
});
