import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { captureDownloads, observeAndResolve, startJob } from './support/hls-job';
import { simulateOffscreen } from './support/offscreen';
import type { SimulatedOffscreen } from './support/offscreen';
import { body, rangeHandler, startPlaylistServer } from './support/playlist-server';
import type { PlaylistServer } from './support/playlist-server';
import { splitTrack } from './support/split-av';

const video = splitTrack('video');

let bg: BackgroundHarness;
let server: PlaylistServer | undefined;
let offscreen: SimulatedOffscreen;
const o = (path: string): string => `${server?.origin ?? ''}${path}`;

beforeEach(() => {
  bg = startBackground();
});
afterEach(async () => {
  await server?.close();
});

const AUDIO_TS_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
audio-0.aac
#EXT-X-ENDLIST
`;

const MASTER_TS_AUDIO = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="234",NAME="Português",LANGUAGE="pt",DEFAULT=YES,URI="audio-ts.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,AUDIO="234"
video.m3u8
`;

describe('HLS job com áudio TS/ADTS', () => {
  it('SPEC-0019:IT-01 download de master playlist com áudio TS/ADTS cria job e envia start ao offscreen com áudio sem initUrl', async () => {
    server = await startPlaylistServer({
      '/av/master.m3u8': body(MASTER_TS_AUDIO),
      '/av/video.m3u8': body(video.playlist),
      '/av/video.mp4': rangeHandler(video.file),
      '/av/audio-ts.m3u8': body(AUDIO_TS_PLAYLIST),
      '/av/audio-0.aac': rangeHandler(new Uint8Array([0xff, 0xf1, 0x50, 0x80]), { contentType: 'audio/aac' }),
    });
    offscreen = simulateOffscreen(bg);
    captureDownloads(bg, 1);

    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));
    const { jobId } = await startJob(bg, candidate.id);

    expect(jobId).toBeDefined();

    // Aguarda o job iniciar e o comando start ser emitido ao offscreen
    await expect.poll(() => offscreen.starts().length).toBeGreaterThan(0);

    const [start] = offscreen.starts();
    expect(start?.jobId).toBe(jobId);
    expect(start?.audio).toBeDefined();
    expect(start?.audio?.initUrl).toBeUndefined();
    expect(start?.audio?.urls).toEqual([o('/av/audio-0.aac')]);
  });
});
