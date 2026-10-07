import { describe, expect, it } from 'vitest';
import { groupCandidates } from '../../src/core/candidates';
import type { VideoCandidate } from '../../src/core/contracts';

describe('deduplicação de candidatos de media playlist no popup', () => {
  it('SPEC-0019:UT-05 quando a lista de candidatos contem uma master e uma media playlist variante da master, a media playlist e suprimida/recolhida exibindo apenas o cartao da master', () => {
    const masterVariantUrl =
      'https://rr.googlevideo.com/videoplayback/id/xyz/itag/136/playlist/index.m3u8?expire=123';
    const masterCandidate: VideoCandidate = {
      id: 'c-master',
      providerId: 'network',
      tabId: 1,
      pageUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      mediaUrl:
        'https://rr.googlevideo.com/videoplayback/id/xyz/hls_variant/file/index.m3u8?expire=123',
      protection: 'none',
      support: 'downloadable',
      frameId: 0,
      frameUrl: '',
      kind: 'hls',
      source: 'network',
      hls: {
        type: 'master',
        variants: [
          {
            index: 0,
            url: masterVariantUrl,
            bandwidth: 2_500_000,
            label: '720p',
          },
        ],
        encrypted: false,
        live: false,
        fmp4: false,
      },
    };

    const mediaVariantCandidate: VideoCandidate = {
      id: 'c-media-variant',
      providerId: 'network',
      tabId: 1,
      pageUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      mediaUrl: masterVariantUrl,
      protection: 'none',
      support: 'downloadable',
      frameId: 0,
      frameUrl: '',
      kind: 'hls',
      source: 'network',
    };

    const groups = groupCandidates([masterCandidate, mediaVariantCandidate]);

    // Deve resultar em exatamente 1 grupo exibido como cartão principal (a master)
    expect(groups).toHaveLength(1);
    expect(groups[0]?.primary.id).toBe('c-master');

    // A media playlist filha deve estar recolhida sob o grupo da master e não como cartão independente
    const relatedIds = (groups[0]?.related ?? []).map((c) => c.id);
    expect(relatedIds).toContain('c-media-variant');
  });

  it('SPEC-0020:UT-02 groupCandidates associa media playlist do YouTube com /id/<id>/ à master correspondente como related', () => {
    const videoId = '679c932c0f1248ab';
    const masterCandidate: VideoCandidate = {
      id: 'c-yt-master',
      providerId: 'network',
      tabId: 1,
      pageUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      mediaUrl: `https://rr.googlevideo.com/videoplayback/expire/123/id/${videoId}/itag/0/source/youtube/requiressl/yes/hls_variant/file/index.m3u8`,
      protection: 'none',
      support: 'downloadable',
      frameId: 0,
      frameUrl: '',
      kind: 'hls',
      source: 'network',
      hls: {
        type: 'master',
        variants: [
          {
            index: 0,
            url: `https://rr.googlevideo.com/videoplayback/expire/123/id/${videoId}/itag/137/source/youtube/requiressl/yes/playlist/index.m3u8`,
            bandwidth: 4_000_000,
            label: '1080p',
          },
        ],
        encrypted: false,
        live: false,
        fmp4: false,
      },
    };

    const mediaPlaylistCandidate: VideoCandidate = {
      id: 'c-yt-media-playlist',
      providerId: 'network',
      tabId: 1,
      pageUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      mediaUrl: `https://rr.googlevideo.com/videoplayback/expire/123/id/${videoId}/itag/313/source/youtube/requiressl/yes/hls_playlist/file/index.m3u8`,
      protection: 'none',
      support: 'downloadable',
      frameId: 0,
      frameUrl: '',
      kind: 'hls',
      source: 'network',
    };

    const groups = groupCandidates([masterCandidate, mediaPlaylistCandidate]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.primary.id).toBe('c-yt-master');
    const relatedIds = (groups[0]?.related ?? []).map((c) => c.id);
    expect(relatedIds).toContain('c-yt-media-playlist');
  });
});
