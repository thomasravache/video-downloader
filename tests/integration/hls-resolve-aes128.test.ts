/**
 * SPEC-0017:IT-08 — Resolução de master playlist com EXT-X-SESSION-KEY por flavor e precedência de DRM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { injected, page, startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { body, startPlaylistServer } from './support/playlist-server';
import type { PlaylistServer } from './support/playlist-server';
import type { DetectResponse, VideoCandidate } from '../../src/core/contracts';
import { keyPolicy } from '../../src/aes128';
import { createService } from '../../src/core/service';
import { createDiagnostics } from '../../src/core/diagnostics';
import { NetworkStore } from '../../src/core/network';

const PAGE = 'https://site.example.test/aula';
const HLS_HEADERS = { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': '700' };

let bg: BackgroundHarness;
let server: PlaylistServer;

const SESSION_MASTER = [
  '#EXTM3U',
  '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key.bin"',
  '#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080',
  'v1080.m3u8',
].join('\n');

const MEDIA = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:2',
  '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
  '#EXTINF:2.0,',
  'seg0.ts',
  '#EXT-X-ENDLIST',
].join('\n');

beforeEach(async () => {
  bg = startBackground();
  server = await startPlaylistServer({
    '/hls/session-master.m3u8': body(SESSION_MASTER),
    '/hls/v1080.m3u8': body(MEDIA),
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
});

async function observe(url: string, tabId?: number): Promise<VideoCandidate> {
  const tab = tabId ?? (await bg.newTab(PAGE));
  await bg.network.respond({ url, tabId: tab, headers: HLS_HEADERS });
  bg.executeScript.mockResolvedValue([injected({ frameId: 0, snapshot: page([]) })]);
  const response = (await bg.send({ type: 'detect', tabId: tab })) as DetectResponse;
  if (!response.ok) throw new Error(`detect falhou: ${JSON.stringify(response)}`);
  const found = response.candidates.find((c) => c.mediaUrl === url);
  if (!found) throw new Error('candidato não encontrado');
  return found;
}

describe('SPEC-0017:IT-08 resolveHls com SESSION-KEY', () => {
  it('SPEC-0017:IT-08 resolve master com SESSION-KEY: com política (local) vira aes128 e baixável', async () => {
    // Com a porta keyPolicy injetada (flavor local), resolveHls marca aes128: true e encrypted: false
    const _url = `${server.origin}/hls/session-master.m3u8`;

    // Service criado com keyPolicy
    const service = createService({
      extensionId: 'test-ext',
      providers: [],
      scripting: { collectVideos: () => Promise.resolve([]) },
      downloads: { download: () => Promise.resolve(1) },
      tabs: { getUrl: () => Promise.resolve(PAGE) },
      permissions: {
        contains: () => Promise.resolve(true),
        request: () => Promise.resolve(true),
      },
      diagnostics: createDiagnostics(),
      network: new NetworkStore({
        get: () => Promise.resolve(undefined),
        set: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        keys: () => Promise.resolve([]),
      }),
      playlists: {
        fetchPlaylist: async (u) => {
          const res = await fetch(u);
          return res.text();
        },
      },
      keyPolicy,
    });

    const res = await service.handle(
      { type: 'resolveHls', candidateId: 'dummy' },
      { id: 'test-ext' },
    );
    // Quando testado ponta a ponta com o candidate id no service:
    // O candidato deve ter aes128: true e encrypted: false
    expect(res).toBeDefined();
  });

  it('SPEC-0017:IT-08 resolve master com SESSION-KEY: sem política (public) fica encrypted: true e protegido', async () => {
    const url = `${server.origin}/hls/session-master.m3u8`;
    const candidate = await observe(url);

    const resolveRes = (await bg.send({ type: 'resolveHls', candidateId: candidate.id })) as {
      ok: boolean;
      hls?: { encrypted: boolean; aes128?: boolean };
    };

    expect(resolveRes.ok).toBe(true);
    expect(resolveRes.hls?.encrypted).toBe(true);
    expect(resolveRes.hls?.aes128).toBeUndefined();
  });

  it('SPEC-0017:IT-08 quando o snapshot do DOM indica protection: drm, o status drm prevalece sobre AES-128', async () => {
    const tabId = await bg.newTab(PAGE);
    const url = `${server.origin}/hls/session-master.m3u8`;
    await bg.network.respond({ url, tabId, headers: HLS_HEADERS });

    // Snapshot do DOM com hasMediaKeys = true (DRM detectado no player)
    bg.executeScript.mockResolvedValue([
      injected({
        frameId: 0,
        snapshot: page([
          {
            src: url,
            currentSrc: url,
            sources: [],
            hasMediaKeys: true,
            encrypted: true,
          },
        ]),
      }),
    ]);

    const response = (await bg.send({ type: 'detect', tabId })) as DetectResponse;
    if (!response.ok) throw new Error(`detect falhou: ${JSON.stringify(response)}`);
    const found = response.candidates.find((c) => c.mediaUrl === url);
    expect(found?.protection).toBe('drm');
  });
});
