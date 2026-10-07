import { describe, expect, it } from 'vitest';
import { assembleMerged } from '../../entrypoints/offscreen/merge';
import { fmp4Init, fmp4Segments, tsSegments } from './support/hls-clip';
import { inspectMp4 } from './support/mp4';

describe('assembleMerged com áudio TS/ADTS sem init MP4', () => {
  it('SPEC-0019:UT-06 vídeo fMP4 e áudio TS/ADTS sem init MP4 produzem arquivo MP4 com duas trilhas sincronizadas', async () => {
    const videoTrack = {
      init: fmp4Init(),
      segments: fmp4Segments(),
    };
    // Áudio em formato TS/ADTS sem init MP4
    const audioTrack = {
      blob: new Blob(tsSegments('v180') as unknown as BlobPart[]),
    };

    const out = await assembleMerged(videoTrack, audioTrack);
    const info = inspectMp4(out);

    expect(info.topLevel[0]).toBe('ftyp');
    expect(info.topLevel).toContain('moov');
    expect(info.tracks).toHaveLength(2);
    expect(info.tracks.map((t) => t.handler).sort()).toEqual(['soun', 'vide']);
    expect(info.tracks.find((t) => t.handler === 'vide')).toBeDefined();
    expect(info.tracks.find((t) => t.handler === 'soun')).toBeDefined();
  });
});
