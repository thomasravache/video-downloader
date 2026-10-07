import { describe, expect, it, vi } from 'vitest';
import type { Provider, VideoCandidate } from '../../src/core/contracts';
import { createDiagnostics } from '../../src/core/diagnostics';
import type { OffscreenCommand } from '../../src/core/hls-download/protocol';
import type { OffscreenPort } from '../../src/core/ports';
import { createService } from '../../src/core/service';

const SELF = 'self';
const VIDEO_PLAYLIST_URL = 'https://cdn.example.test/hls/video.m3u8';
const VIDEO_TS_PLAYLIST_URL = 'https://cdn.example.test/hls/video-ts.m3u8';
const AUDIO_PLAYLIST_URL = 'https://cdn.example.test/hls/audio.m3u8';
const CORRUPT_AUDIO_PLAYLIST_URL = 'https://cdn.example.test/hls/audio-corrupt.m3u8';

const VIDEO_FMP4_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.0,
video-0.m4s
#EXT-X-ENDLIST
`;

const VIDEO_TS_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
video-0.ts
#EXT-X-ENDLIST
`;

const AUDIO_TS_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
audio-0.aac
#EXT-X-ENDLIST
`;

function createHlsCandidate(
  id: string,
  audioUrl: string,
  videoUrl: string = VIDEO_PLAYLIST_URL,
): VideoCandidate {
  return {
    id,
    providerId: 'test-provider',
    tabId: 1,
    pageUrl: 'https://youtube.test/watch?v=1',
    mediaUrl: 'https://cdn.example.test/hls/master.m3u8',
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
          url: videoUrl,
          bandwidth: 2_500_000,
          label: '720p',
          audioGroup: '234',
        },
      ],
      audio: [
        {
          index: 0,
          groupId: '234',
          name: 'Português',
          default: true,
          url: audioUrl,
        },
      ],
      encrypted: false,
      live: false,
      fmp4: false,
    },
  };
}

function setupService(candidates: VideoCandidate[]) {
  const provider: Provider = {
    id: 'test-provider',
    flavors: ['public', 'local'],
    matches: () => true,
    detect: () => Promise.resolve(candidates),
  };
  const jobStore = {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
  };
  const sendSpy = vi
    .fn<(command: OffscreenCommand) => Promise<void>>()
    .mockResolvedValue(undefined);
  const offscreen: OffscreenPort = {
    ensure: vi.fn().mockResolvedValue(undefined),
    send: sendSpy,
    isOpen: vi.fn().mockResolvedValue(false),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const fetchPlaylist = vi.fn((url: string): Promise<string> => {
    if (url === VIDEO_PLAYLIST_URL) {
      return Promise.resolve(VIDEO_FMP4_PLAYLIST);
    }
    if (url === VIDEO_TS_PLAYLIST_URL) {
      return Promise.resolve(VIDEO_TS_PLAYLIST);
    }
    if (url === AUDIO_PLAYLIST_URL) {
      return Promise.resolve(AUDIO_TS_PLAYLIST);
    }
    if (url === CORRUPT_AUDIO_PLAYLIST_URL) {
      return Promise.resolve('<html><body>404 Not Found</body></html>');
    }
    return Promise.reject(new Error(`URL não encontrada: ${url}`));
  });

  const service = createService({
    extensionId: SELF,
    providers: [provider],
    scripting: { collectVideos: () => Promise.resolve([]) },
    downloads: { download: () => Promise.resolve(1) },
    tabs: { getUrl: () => Promise.resolve('https://youtube.test/watch?v=1') },
    permissions: { contains: () => Promise.resolve(false), request: () => Promise.resolve(false) },
    diagnostics: createDiagnostics(),
    playlists: { fetchPlaylist },
    jobStore,
    offscreen,
  });

  return { service, offscreen, sendSpy, fetchPlaylist };
}

describe('service HLS com áudio TS/ADTS', () => {
  it('SPEC-0019:UT-02 download com vídeo fMP4 e áudio TS/ADTS sem EXT-X-MAP não é recusado com UNSUPPORTED e gera JobPlan com áudio sem initUrl', async () => {
    const candidate = createHlsCandidate('cand-valid-ts', AUDIO_PLAYLIST_URL);
    const { service, sendSpy } = setupService([candidate]);

    await service.handle({ type: 'detect', tabId: 1 }, { id: SELF });

    const response = await service.handle(
      { type: 'download', candidateId: candidate.id },
      { id: SELF },
    );

    // No código original (SPEC-0014), !audioMedia.fmp4 causa erro UNSUPPORTED
    // A SPEC-0019 exige que o download seja aceito e o JobPlan contenha audio sem initUrl
    expect(response).toMatchObject({ ok: true });
    if (!response.ok || !('jobId' in response)) throw new Error('esperado response com jobId');
    expect(typeof response.jobId).toBe('string');
    expect(sendSpy).toHaveBeenCalled();
    const [firstCall] = sendSpy.mock.calls;
    const command = firstCall?.[0];
    expect(command).toMatchObject({
      type: 'start',
      audio: {
        urls: ['https://cdn.example.test/hls/audio-0.aac'],
        initUrl: undefined,
      },
    });
  });

  it('SPEC-0020:UT-01 service.ts aceita downloadHls com vídeo MPEG-TS (media.fmp4 === false) e áudio separado sem recusar com UNSUPPORTED', async () => {
    const candidate = createHlsCandidate(
      'cand-ts-video-audio',
      AUDIO_PLAYLIST_URL,
      VIDEO_TS_PLAYLIST_URL,
    );
    const { service, sendSpy } = setupService([candidate]);

    await service.handle({ type: 'detect', tabId: 1 }, { id: SELF });

    const response = await service.handle(
      { type: 'download', candidateId: candidate.id },
      { id: SELF },
    );

    expect(response).toMatchObject({ ok: true });
    if (!response.ok || !('jobId' in response)) throw new Error('esperado response com jobId');
    expect(typeof response.jobId).toBe('string');
    expect(sendSpy).toHaveBeenCalled();
    const [firstCall] = sendSpy.mock.calls;
    const command = firstCall?.[0];
    expect(command).toMatchObject({
      type: 'start',
      fmp4: false,
      urls: ['https://cdn.example.test/hls/video-0.ts'],
      audio: {
        urls: ['https://cdn.example.test/hls/audio-0.aac'],
        initUrl: undefined,
      },
    });
    if (command && command.type === 'start') {
      expect(command.initUrl).toBeUndefined();
    }
  });

  it('SPEC-0019:UT-03 playlist de áudio retornando conteúdo inválido ou não-mídia é recusada com HLS_NOT_RESOLVED', async () => {
    const candidate = createHlsCandidate('cand-corrupt-audio', CORRUPT_AUDIO_PLAYLIST_URL);
    const { service, sendSpy } = setupService([candidate]);

    await service.handle({ type: 'detect', tabId: 1 }, { id: SELF });

    const response = await service.handle(
      { type: 'download', candidateId: candidate.id },
      { id: SELF },
    );

    expect(response).toEqual({ ok: false, error: 'HLS_NOT_RESOLVED' });
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
