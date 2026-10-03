/**
 * Contrato usado (SPEC-0012:IT-03) — background REAL + fakeBrowser + servidor HTTP local REAL (+ offscreen
 * simulado, ver tests/integration/support/offscreen.ts). Obrigações de segurança herdadas da revisão da
 * SPEC-0011 (docs/specs/SPEC-0012 §3), todas no SERVIDOR (background), não só na UI:
 *  (a) o download RE-BUSCA e RE-ANALISA a playlist da variante ESCOLHIDA (variantIndex -> HlsVariant.url, http(s))
 *      e recusa `encrypted` (lista de permissão: só a linha exata `#EXT-X-KEY:METHOD=NONE` é limpa) ou `live`
 *      dessa playlist, mesmo que o candidato guardado/master/melhor variante pareçam limpos;
 *  (b) candidato SEM `hls` (não resolvido) é desconhecido: nunca é assumido limpo (recusa ou resolve antes);
 *  (c) `protection === 'encrypted'` é checado explicitamente (além de `support`);
 *  (d) `protection === 'drm'` -> {ok:false, error:'PROTECTED'} e nenhuma requisição;
 *  (e) a guarda `kind === 'hls'` -> UNSUPPORTED de service.download foi REMOVIDA: HLS VOD limpo e resolvido
 *      inicia um job; não resolvido, criptografado ou ao vivo continuam sem job;
 *  (f) init fMP4 com caixa sinf/schm (criptografia) é recusado (job error ENCRYPTED ou UNSUPPORTED_CODEC);
 *  `#EXT-X-FAXS-CM` (DRM Adobe) conta como proteção na decisão do download (ENCRYPTED ou PROTECTED);
 *  respostas de recusa: {ok:false, error:'ENCRYPTED' | 'LIVE' | 'PROTECTED' | 'HLS_NOT_RESOLVED' | ...};
 *  total declarado (Content-Length dos segmentos, ou BANDWIDTH × duração) > 1,5 GiB -> job error 'TOO_LARGE'.
 * Nas recusas NENHUM segmento nem chave é requisitado, nenhum job é criado, o offscreen não é aberto e
 * `downloads.download` não é chamado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { simulateOffscreen } from './support/offscreen';
import type { SimulatedOffscreen } from './support/offscreen';
import {
  clipRoutes,
  detectCandidate,
  fileHandler,
  isSegmentPath,
  observeAndResolve,
  observeHls,
  startDownload,
  startJob,
  waitForJob,
} from './support/hls-job';
import { body, startPlaylistServer } from './support/playlist-server';
import type { Handler, PlaylistServer } from './support/playlist-server';
import { clipFile } from '../unit/support/hls-clip';
import { withEncryptionBox } from '../unit/support/mp4-build';
import type { VideoCandidate } from '../../src/core/contracts';

const GIB = 1024 ** 3;

let bg: BackgroundHarness;
let server: PlaylistServer;
let offscreen: SimulatedOffscreen;

const o = (path: string): string => `${server.origin}${path}`;

function media(lines: string[], { endlist = true, prefix = 's' } = {}): string {
  const segments = [0, 1].map((i) => `#EXTINF:2.0,\n${prefix}${String(i)}.mpegts`).join('\n');
  return `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n${lines.join('\n')}\n${segments}\n${endlist ? '#EXT-X-ENDLIST\n' : ''}`;
}

const master = (hi: string, lo: string, hiBandwidth = 3_000_000): string =>
  `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=${String(hiBandwidth)},RESOLUTION=1280x720\n${hi}\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\n${lo}\n`;

const DUMMY: Handler = fileHandler(new Uint8Array(64).fill(1), 'video/mp2t');

/** Rotas: o clipe real em /hls/clip e playlists adulteradas em /r. */
function routes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    ...clipRoutes(),
    '/r/s0.mpegts': DUMMY,
    '/r/s1.mpegts': DUMMY,
    '/r/hi.m3u8': body(media([])),
    '/r/clean-master.m3u8': body(master('hi.m3u8', 'lo-clean.m3u8')),
    '/r/lo-clean.m3u8': body(media([])),
    '/r/enc.m3u8': body(media(['#EXT-X-KEY:METHOD=AES-128,URI="key.bin"'])),
    '/r/key.bin': DUMMY,
    '/r/live.m3u8': body(media([], { endlist: false })),
    '/r/lo-live.m3u8': body(media([], { endlist: false })),
    '/r/master-lo-live.m3u8': body(master('hi.m3u8', 'lo-live.m3u8')),
    ...extra,
  };
}

async function start(extra: Record<string, Handler> = {}, mode: 'real' | 'manual' = 'manual') {
  server = await startPlaylistServer(routes(extra));
  offscreen = simulateOffscreen(bg, { mode });
}

beforeEach(() => {
  bg = startBackground();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
});

/** Nada além de playlists foi requisitado e nenhum job/offscreen/download aconteceu. */
function expectNoWork(): void {
  expect(server.requests.filter(isSegmentPath)).toEqual([]);
  expect(server.requests.some((r) => r.includes('key.bin') || r.endsWith('/x'))).toBe(false);
  expect(offscreen.starts()).toEqual([]);
  expect(bg.offscreen.createDocument).not.toHaveBeenCalled();
  expect(bg.download).not.toHaveBeenCalled();
}

describe('recusas no servidor: criptografado, ao vivo, protegido', () => {
  it('SPEC-0012:IT-03 playlist criptografada (AES-128) resolvida -> ENCRYPTED, sem job e sem requisição de segmento ou chave', async () => {
    await start();
    const { candidate } = await observeAndResolve(bg, o('/r/enc.m3u8'));
    expect(candidate.protection).toBe('encrypted');

    expect(await startDownload(bg, candidate.id)).toEqual({ ok: false, error: 'ENCRYPTED' });

    expectNoWork();
  });

  it('SPEC-0012:IT-03 playlist ao vivo (sem ENDLIST) resolvida -> LIVE, sem job e sem requisição de segmento', async () => {
    await start();
    const { candidate } = await observeAndResolve(bg, o('/r/live.m3u8'));

    expect(await startDownload(bg, candidate.id)).toEqual({ ok: false, error: 'LIVE' });

    expectNoWork();
  });

  it('SPEC-0012:IT-03 (c) candidato com protection "encrypted" é recusado mesmo com support downloadable e hls limpo', async () => {
    await start();
    const { candidate } = await observeAndResolve(bg, o('/r/clean-master.m3u8'));
    expect(candidate).toMatchObject({ protection: 'none', support: 'downloadable' });
    await tamper(candidate, { protection: 'encrypted' });
    const before = server.requests.length;

    const response = await startDownload(bg, candidate.id);

    expect(response).toEqual({ ok: false, error: 'ENCRYPTED' });
    expect(server.requests.slice(before).filter(isSegmentPath)).toEqual([]);
    expect(offscreen.starts()).toEqual([]);
    expect(bg.download).not.toHaveBeenCalled();
  });

  it('SPEC-0012:IT-03 (d) candidato marcado drm -> PROTECTED, nunca baixado e sem nenhuma requisição ao servidor', async () => {
    await start();
    const { candidate } = await observeAndResolve(bg, o('/r/clean-master.m3u8'));
    await tamper(candidate, { protection: 'drm' });
    const before = server.requests.length;

    const response = await startDownload(bg, candidate.id);

    expect(response).toEqual({ ok: false, error: 'PROTECTED' });
    expect(server.requests.length).toBe(before);
    expect(offscreen.starts()).toEqual([]);
    expect(bg.download).not.toHaveBeenCalled();
  });

  it('SPEC-0012:IT-03 (guarda: passa antes da mudança) download de candidato inexistente -> CANDIDATE_NOT_FOUND', async () => {
    await start();

    expect(await startDownload(bg, 'nao-existe')).toEqual({
      ok: false,
      error: 'CANDIDATE_NOT_FOUND',
    });
  });

  /** Regrava o candidato no storage.session e reinicia o service worker (a memória some, vale o storage). */
  async function tamper(
    candidate: VideoCandidate,
    changes: Partial<VideoCandidate>,
  ): Promise<void> {
    const key = `vd:net:${String(candidate.tabId)}`;
    const stored = (await fakeBrowser.storage.session.get(key))[key] as {
      at: number;
      candidate: VideoCandidate;
    }[];
    const next = stored.map((entry) =>
      entry.candidate.id === candidate.id
        ? { ...entry, candidate: { ...entry.candidate, ...changes } }
        : entry,
    );
    await fakeBrowser.storage.session.set({ [key]: next });
    bg.restart();
  }
});

describe('(a) o download re-analisa a playlist da variante ESCOLHIDA', () => {
  /** Linhas hostis na variante escolhida (a pior), com master e melhor variante limpos. */
  const HOSTILE: [string, string][] = [
    ['METHOD=NONE com URI (fora da lista de permissão)', '#EXT-X-KEY:METHOD=NONE,URI="x"'],
    ['AES-128', '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"'],
    [
      'SAMPLE-AES',
      '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://k",KEYFORMAT="com.apple.streamingkeydelivery"',
    ],
    ['SESSION-KEY', '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key.bin"'],
    [
      'METHOD=NONE seguido de chave AES-128',
      '#EXT-X-KEY:METHOD=NONE\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
    ],
  ];

  for (const [name, line] of HOSTILE) {
    it(`SPEC-0012:IT-03 master e melhor variante limpos, variante escolhida (índice 1) com ${name} -> ENCRYPTED e só playlists requisitadas`, async () => {
      await start({
        '/r/lo-bad.m3u8': body(media([line])),
        '/r/m.m3u8': body(master('hi.m3u8', 'lo-bad.m3u8')),
      });
      const { candidate } = await observeAndResolve(bg, o('/r/m.m3u8'));
      expect(candidate).toMatchObject({ protection: 'none', support: 'downloadable' });
      expect(server.requests).toEqual(['/r/m.m3u8', '/r/hi.m3u8']);

      const response = await startDownload(bg, candidate.id, 1);

      expect(response).toEqual({ ok: false, error: 'ENCRYPTED' });
      expect(server.requests.every((r) => r.endsWith('.m3u8'))).toBe(true);
      expect(server.requests).toContain('/r/lo-bad.m3u8');
      expectNoWork();
    });
  }

  it('SPEC-0012:IT-03 #EXT-X-FAXS-CM (DRM Adobe) na variante escolhida conta como proteção: ENCRYPTED ou PROTECTED', async () => {
    await start({
      '/r/lo-faxs.m3u8': body(media(['#EXT-X-FAXS-CM:URI="https://drm.test/x"'])),
      '/r/m-faxs.m3u8': body(master('hi.m3u8', 'lo-faxs.m3u8')),
    });
    const { candidate } = await observeAndResolve(bg, o('/r/m-faxs.m3u8'));

    const response = await startDownload(bg, candidate.id, 1);

    expect(response.ok).toBe(false);
    expect(['ENCRYPTED', 'PROTECTED']).toContain((response as { error: string }).error);
    expectNoWork();
  });

  it('SPEC-0012:IT-03 variante escolhida (índice 1) ao vivo, com a melhor limpa -> LIVE e só playlists requisitadas', async () => {
    await start();
    const { candidate } = await observeAndResolve(bg, o('/r/master-lo-live.m3u8'));
    expect(candidate).toMatchObject({ protection: 'none', support: 'downloadable' });

    const response = await startDownload(bg, candidate.id, 1);

    expect(response).toEqual({ ok: false, error: 'LIVE' });
    expect(server.requests.every((r) => r.endsWith('.m3u8'))).toBe(true);
    expectNoWork();
  });

  it('SPEC-0012:IT-03 a playlist mudou depois do resolve (variante 0 passou a ter AES-128) -> ENCRYPTED, sem segmentos', async () => {
    let encrypted = false;
    await start({
      '/r/flip.m3u8': (req, res) => {
        body(media(encrypted ? ['#EXT-X-KEY:METHOD=AES-128,URI="key.bin"'] : []))(req, res);
      },
      '/r/m-flip.m3u8': body(master('flip.m3u8', 'lo-clean.m3u8')),
    });
    const { candidate } = await observeAndResolve(bg, o('/r/m-flip.m3u8'));
    expect(candidate.support).toBe('downloadable');
    encrypted = true;

    const response = await startDownload(bg, candidate.id, 0);

    expect(response).toEqual({ ok: false, error: 'ENCRYPTED' });
    expectNoWork();
  });

  it('SPEC-0012:IT-03 (guarda: passa antes da mudança) variante escolhida que não pode ser lida (404) -> recusa, sem job nem segmentos', async () => {
    await start({ '/r/m-gone.m3u8': body(master('hi.m3u8', 'gone.m3u8')) });
    const { candidate } = await observeAndResolve(bg, o('/r/m-gone.m3u8'));

    const response = await startDownload(bg, candidate.id, 1);

    expect(response.ok).toBe(false);
    expectNoWork();
  });

  it('SPEC-0012:IT-03 (guarda: passa antes da mudança) variantIndex que não existe na lista -> recusa, sem job nem segmentos', async () => {
    await start();
    const { candidate } = await observeAndResolve(bg, o('/r/clean-master.m3u8'));

    expect((await startDownload(bg, candidate.id, 9)).ok).toBe(false);

    expectNoWork();
  });
});

describe('(b) candidato não resolvido é desconhecido, nunca limpo', () => {
  it('SPEC-0012:IT-03 (guarda: passa antes da mudança) candidato HLS sem hls cuja playlist é criptografada: recusa (HLS_NOT_RESOLVED, ENCRYPTED ou UNSUPPORTED), sem job nem segmentos', async () => {
    await start();
    const candidate = await observeHls(bg, o('/r/enc.m3u8'));
    expect(candidate.hls).toBeUndefined();

    const response = await startDownload(bg, candidate.id);

    expect(response.ok).toBe(false);
    expect(['HLS_NOT_RESOLVED', 'ENCRYPTED', 'UNSUPPORTED']).toContain(
      (response as { error: string }).error,
    );
    expectNoWork();
  });

  it('SPEC-0012:IT-03 (guarda: passa antes da mudança) master não resolvida com a variante escolhida criptografada: nunca vira job', async () => {
    await start({
      '/r/lo-bad2.m3u8': body(media(['#EXT-X-KEY:METHOD=NONE,URI="x"'])),
      '/r/m-bad2.m3u8': body(master('hi.m3u8', 'lo-bad2.m3u8')),
    });
    const candidate = await observeHls(bg, o('/r/m-bad2.m3u8'));

    const response = await startDownload(bg, candidate.id, 1);

    expect(response.ok).toBe(false);
    expectNoWork();
  });
});

describe('(e) a guarda temporária de HLS foi removida', () => {
  it('SPEC-0012:IT-03 HLS VOD limpo e resolvido inicia um job; não resolvido, criptografado e ao vivo continuam sem job', async () => {
    await start();
    const tab = await bg.newTab();
    const clean = await observeAndResolve(bg, o('/hls/clip/master.m3u8'), tab);
    const unresolved = await observeHls(bg, o('/r/clean-master.m3u8'), tab);
    const encrypted = await observeAndResolve(bg, o('/r/enc.m3u8'), tab);
    const live = await observeAndResolve(bg, o('/r/live.m3u8'), tab);
    expect(clean.candidate.support).toBe('downloadable');

    const ok = await startDownload(bg, clean.candidate.id);
    const notResolved = await startDownload(bg, unresolved.id);
    const enc = await startDownload(bg, encrypted.candidate.id);
    const lv = await startDownload(bg, live.candidate.id);

    expect(ok).toMatchObject({ ok: true });
    expect(typeof (ok as { jobId?: unknown }).jobId).toBe('string');
    expect(notResolved.ok).toBe(false);
    expect(enc).toEqual({ ok: false, error: 'ENCRYPTED' });
    expect(lv).toEqual({ ok: false, error: 'LIVE' });
    expect(offscreen.starts()).toHaveLength(1);
  });

  it('SPEC-0012:IT-03 (guarda: passa antes da mudança) MP4 direto da rede continua baixando com downloads.download e a URL original', async () => {
    await start();
    bg.download.mockResolvedValue(31);
    const tab = await bg.newTab();
    const url = o('/media/video.mp4');
    await bg.network.respond({
      url,
      tabId: tab,
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': '5000000' },
    });
    const candidate = await detectCandidate(bg, tab, url);

    expect(await bg.send({ type: 'download', candidateId: candidate.id })).toEqual({
      ok: true,
      downloadId: 31,
    });
    expect((bg.download.mock.calls[0]?.[0] as { url: string }).url).toBe(url);
  });
});

describe('caminho da playlist para o offscreen: só http(s) listado na playlist', () => {
  it('SPEC-0012:IT-03 (guarda: passa antes da mudança) segmentos com file:, data:, javascript: e ftp: nunca chegam ao offscreen (recusa ou lista só com http(s))', async () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:2',
      '#EXTINF:2.0,',
      's0.mpegts',
      '#EXTINF:2.0,',
      'file:///etc/passwd',
      '#EXTINF:2.0,',
      'javascript:alert(1)',
      '#EXTINF:2.0,',
      'data:video/mp2t;base64,AAAA',
      '#EXTINF:2.0,',
      'ftp://host.test/x.ts',
      '#EXT-X-ENDLIST',
      '',
    ].join('\n');
    await start({ '/r/odd.m3u8': body(playlist) });
    const { candidate } = await observeAndResolve(bg, o('/r/odd.m3u8'));

    await startDownload(bg, candidate.id);

    for (const command of offscreen.starts()) {
      expect(command.urls.every((u) => /^https?:\/\//.test(u))).toBe(true);
      expect(command.initUrl === undefined || /^https?:\/\//.test(command.initUrl)).toBe(true);
    }
  });

  it('SPEC-0012:IT-03 as URLs entregues ao offscreen são exatamente as da playlist da variante escolhida, absolutas e http(s)', async () => {
    await start();
    const { candidate } = await observeAndResolve(bg, o('/hls/clip/master.m3u8'));

    await startJob(bg, candidate.id, 1);

    const [command] = offscreen.starts();
    expect(command?.urls).toEqual([0, 1, 2].map((i) => o(`/hls/clip/v180-${String(i)}.mpegts`)));
    expect(command?.initUrl).toBeUndefined();
  });
});

describe('limite de 1,5 GiB e conteúdo criptografado dentro do segmento', () => {
  /** Responde só os cabeçalhos (Content-Length grande) e segura a conexão até o cliente abortar. */
  const declaring =
    (bytes: number): Handler =>
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'video/mp2t', 'content-length': String(bytes) });
      res.flushHeaders();
    };

  it('SPEC-0012:IT-03 segmento que declara 2 GiB -> job error TOO_LARGE, sem arquivo', async () => {
    await start(
      {
        '/r/big.m3u8': body(media([], { prefix: 'big' })),
        '/r/big0.mpegts': declaring(2 * GIB),
        '/r/big1.mpegts': declaring(2 * GIB),
        '/r/m-big.m3u8': body(master('big.m3u8', 'lo-clean.m3u8')),
      },
      'real',
    );
    const { candidate } = await observeAndResolve(bg, o('/r/m-big.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    const failed = await waitForJob(bg, jobId, (j) => j.state === 'error');

    expect(failed.error).toBe('TOO_LARGE');
    expect(bg.download).not.toHaveBeenCalled();
    expect(offscreen.createdBlobUrls).toEqual([]);
  });

  it('SPEC-0012:IT-03 vários segmentos cujo total declarado passa de 1,5 GiB (3 × 600 MiB) -> TOO_LARGE', async () => {
    const mib = 1024 ** 2;
    await start(
      {
        '/r/sum.m3u8': body(
          '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\nsum0.mpegts\n#EXTINF:2.0,\nsum1.mpegts\n#EXTINF:2.0,\nsum2.mpegts\n#EXT-X-ENDLIST\n',
        ),
        '/r/sum0.mpegts': declaring(600 * mib),
        '/r/sum1.mpegts': declaring(600 * mib),
        '/r/sum2.mpegts': declaring(600 * mib),
      },
      'real',
    );
    const { candidate } = await observeAndResolve(bg, o('/r/sum.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    const failed = await waitForJob(bg, jobId, (j) => j.state === 'error');

    expect(failed.error).toBe('TOO_LARGE');
    expect(bg.download).not.toHaveBeenCalled();
  });

  it('SPEC-0012:IT-03 (f) init fMP4 com caixa sinf/schm: job error ENCRYPTED ou UNSUPPORTED_CODEC, nada é entregue ao chrome.downloads', async () => {
    await start(
      {
        '/r/enc-init.m3u8': body(
          '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:2\n#EXT-X-MAP:URI="enc-init.mp4"\n#EXTINF:2.0,\nf0.m4s\n#EXTINF:2.0,\nf1.m4s\n#EXT-X-ENDLIST\n',
        ),
        '/r/enc-init.mp4': fileHandler(withEncryptionBox(clipFile('fmp4/init.mp4')), 'video/mp4'),
        '/r/f0.m4s': fileHandler(clipFile('fmp4/f-0.m4s'), 'video/mp4'),
        '/r/f1.m4s': fileHandler(clipFile('fmp4/f-1.m4s'), 'video/mp4'),
      },
      'real',
    );
    const { candidate } = await observeAndResolve(bg, o('/r/enc-init.m3u8'));
    expect(candidate).toMatchObject({ protection: 'none', support: 'downloadable' });

    const { jobId } = await startJob(bg, candidate.id);
    const failed = await waitForJob(bg, jobId, (j) => j.state === 'error');

    expect(['ENCRYPTED', 'UNSUPPORTED_CODEC']).toContain(failed.error);
    expect(bg.download).not.toHaveBeenCalled();
    expect(offscreen.createdBlobUrls).toEqual([]);
  });

  it('SPEC-0012:IT-03 segmentos sem H.264/AAC (MPEG-2/MP2): job error UNSUPPORTED_CODEC', async () => {
    await start(
      {
        '/r/mpeg2.m3u8': body(
          '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:1.0,\nother.mpegts\n#EXT-X-ENDLIST\n',
        ),
        '/r/other.mpegts': fileHandler(clipFile('other-codec.mpegts'), 'video/mp2t'),
      },
      'real',
    );
    const { candidate } = await observeAndResolve(bg, o('/r/mpeg2.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    const failed = await waitForJob(bg, jobId, (j) => j.state === 'error');

    expect(failed.error).toBe('UNSUPPORTED_CODEC');
    expect(bg.download).not.toHaveBeenCalled();
  });
});
