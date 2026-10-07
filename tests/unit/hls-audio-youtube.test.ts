import { describe, expect, it } from 'vitest';
import { audioOptions } from '../../entrypoints/popup/audio';
import { chooseAudio } from '../../src/core/hls-download';
import { parseHlsPlaylist } from '../../src/core/hls';

const BASE = 'https://rr.googlevideo.com/videoplayback/file/index.m3u8';

const YOUTUBE_MASTER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="233",NAME="English (original)",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="en",URI="https://rr.googlevideo.com/videoplayback/itag/233_en/index.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="233",NAME="Português (Brasil)",DEFAULT=NO,AUTOSELECT=YES,LANGUAGE="pt-BR",URI="https://rr.googlevideo.com/videoplayback/itag/233_pt/index.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="234",NAME="English (original)",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="en",URI="https://rr.googlevideo.com/videoplayback/itag/234_en/index.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="234",NAME="Português (Brasil)",DEFAULT=NO,AUTOSELECT=YES,LANGUAGE="pt-BR",URI="https://rr.googlevideo.com/videoplayback/itag/234_pt/index.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="234",NAME="Español (Latinoamérica)",DEFAULT=NO,AUTOSELECT=YES,LANGUAGE="es-419",URI="https://rr.googlevideo.com/videoplayback/itag/234_es/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=4641000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="234"
https://rr.googlevideo.com/videoplayback/itag/137/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2542000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="234"
https://rr.googlevideo.com/videoplayback/itag/136/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=920000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="233"
https://rr.googlevideo.com/videoplayback/itag/134/index.m3u8
`;

describe('HLS YouTube audio selection', () => {
  it('SPEC-0019:UT-01 manifesto master do YouTube com múltiplos audioGroup oferece apenas faixas do grupo correspondente e seleção de Português retorna faixa com índice válido', () => {
    const hls = parseHlsPlaylist(YOUTUBE_MASTER, BASE);
    expect(hls.type).toBe('master');

    // Variante de 720p (index 1) pertence ao audioGroup "234"
    const variant720Index = 1;
    expect(hls.variants[variant720Index]?.height).toBe(720);
    expect(hls.variants[variant720Index]?.audioGroup).toBe('234');

    const options = audioOptions(hls, variant720Index);
    // Somente faixas do grupo 234 são oferecidas (não inclui grupo 233)
    expect(options).toHaveLength(3);
    const offeredTrackIndices = options.map((opt) => opt.index);
    const offeredTracks = offeredTrackIndices.map((i) => hls.audio?.[i]);
    expect(offeredTracks.every((track) => track?.groupId === '234')).toBe(true);

    // Seleção de Português (Brasil) retorna faixa correta com index válido
    const ptOption = options.find((opt) => opt.label.includes('Português (Brasil)'));
    expect(ptOption).toBeDefined();
    if (!ptOption) throw new Error('esperado ptOption');
    expect(ptOption.index).toBeDefined();

    const chosen = chooseAudio(hls, variant720Index, ptOption.index);
    expect(chosen).toMatchObject({
      name: 'Português (Brasil)',
      groupId: '234',
      language: 'pt-BR',
      index: ptOption.index,
    });
  });
});
