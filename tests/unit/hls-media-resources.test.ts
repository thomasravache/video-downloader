/**
 * Contrato usado (SPEC-0015:UT-04): derivação de `HlsInfo.mediaResources`.
 *   src/core/hls-download (segments.ts) -> deriveMediaResources(playlists): string[]
 *   `playlists` = resultados de `parseMediaSegments` (os campos `urls` e `initUrl` bastam) das playlists de
 *   variante/áudio buscadas no resolve. Devolve ORIGEM+CAMINHO (sem query nem fragmento) dos arquivos citados
 *   (segmentos e EXT-X-MAP), ÚNICOS, na ordem de primeira aparição (playlists na ordem dada; em cada uma, o
 *   init antes dos segmentos), no MÁXIMO 32 (os 32 primeiros). Origens diferentes são recursos diferentes.
 */
import { describe, expect, it } from 'vitest';
import { deriveMediaResources, parseMediaSegments } from '../../src/core/hls-download';

const CDN = 'https://cdn.example.test/curso';

/** Playlist fMP4 de arquivo único (EXT-X-MAP + BYTERANGE) que cita `uri` (com query/fragmento, se houver). */
function playlistOf(uri: string, segments = 3): string {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-TARGETDURATION:2',
    `#EXT-X-MAP:URI="${uri}",BYTERANGE="100@0"`,
  ];
  for (let i = 0; i < segments; i++) {
    lines.push('#EXTINF:2.0,', `#EXT-X-BYTERANGE:1000${i === 0 ? '@100' : ''}`, uri);
  }
  lines.push('#EXT-X-ENDLIST', '');
  return lines.join('\n');
}

const parse = (uri: string, base = `${CDN}/v.m3u8`, segments = 3) =>
  parseMediaSegments(playlistOf(uri, segments), base);

describe('deriveMediaResources', () => {
  it('SPEC-0015:UT-04 query e fragmento somem: "arq.mp4?token=x&expires=1#f" repetido (init + 3 segmentos) vira UMA entrada origem+caminho', () => {
    const media = parse(`${CDN}/arq.mp4?token=x&expires=1#f`);
    expect(media.urls).toHaveLength(3);

    expect(deriveMediaResources([media])).toEqual([`${CDN}/arq.mp4`]);
  });

  it('SPEC-0015:UT-04 URIs relativas resolvem pela base da playlist; mesmo caminho com queries diferentes (e entre playlists) conta uma vez', () => {
    const video = parse('video.mp4?token=a', `${CDN}/hls/video.m3u8`);
    const again = parse('video.mp4?token=b', `${CDN}/hls/video-low.m3u8`);
    const audio = parse('audio.mp4?token=a', `${CDN}/hls/audio.m3u8`);

    expect(deriveMediaResources([video, again, audio])).toEqual([
      `${CDN}/hls/video.mp4`,
      `${CDN}/hls/audio.mp4`,
    ]);
  });

  it('SPEC-0015:UT-04 init e segmentos em arquivos diferentes entram (init primeiro); a mesma rota em OUTRA origem é outro recurso', () => {
    const split = parseMediaSegments(
      [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-TARGETDURATION:2',
        '#EXT-X-MAP:URI="init.mp4?t=1"',
        '#EXTINF:2.0,',
        'https://outra.example.test/curso/seg-0.m4s?t=2',
        '#EXTINF:2.0,',
        'seg-1.m4s#frag',
        '#EXT-X-ENDLIST',
        '',
      ].join('\n'),
      `${CDN}/v.m3u8`,
    );

    expect(deriveMediaResources([split])).toEqual([
      `${CDN}/init.mp4`,
      'https://outra.example.test/curso/seg-0.m4s',
      `${CDN}/seg-1.m4s`,
    ]);
  });

  it('SPEC-0015:UT-04 mais de 32 recursos: devolve no máximo 32, únicos, os 32 primeiros na ordem', () => {
    const many = Array.from({ length: 45 }, (_, i) => `arq-${String(i).padStart(2, '0')}.mp4`);
    // 45 arquivos distintos espalhados por 3 playlists, cada URL com token.
    const playlists = [0, 15, 30].map((from) =>
      parseMediaSegments(
        [
          '#EXTM3U',
          '#EXT-X-VERSION:7',
          '#EXT-X-TARGETDURATION:2',
          ...many
            .slice(from, from + 15)
            .flatMap((name) => ['#EXTINF:2.0,', `${name}?token=x&expires=1#f`]),
          '#EXT-X-ENDLIST',
          '',
        ].join('\n'),
        `${CDN}/p.m3u8`,
      ),
    );

    const result = deriveMediaResources(playlists);

    expect(result).toHaveLength(32);
    expect(new Set(result).size).toBe(32);
    expect(result).toEqual(many.slice(0, 32).map((name) => `${CDN}/${name}`));
  });

  it('SPEC-0015:UT-04 nenhum item tem "?", "#", "token" ou "expires"; todos são http(s) absolutos', () => {
    const result = deriveMediaResources([
      parse(`${CDN}/a.mp4?token=SEGREDO&expires=9#f`),
      parse(`${CDN}/b.mp4?X-Amz-Signature=SEGREDO`),
    ]);

    expect(result.length).toBeGreaterThan(0);
    for (const item of result) {
      expect(item).toMatch(/^https?:\/\/[^?#]+$/);
      expect(item).not.toMatch(/SEGREDO|token|expires/i);
    }
  });

  it('SPEC-0015:UT-04 sem playlists devolve lista vazia', () => {
    expect(deriveMediaResources([])).toEqual([]);
  });
});
