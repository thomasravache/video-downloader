/**
 * Contrato usado (SPEC-0005:IT-01..IT-03 sobre as portas): src/core/service.ts
 *   createService({ extensionId, providers, scripting, downloads, tabs, permissions, diagnostics })
 *   (SPEC-0009: `scripting.collectVideos` devolve FrameSnapshot[]; `permissions` é PermissionsPort;
 *   `detect` responde também `access: { blockedOrigins }`)
 *     -> { handle(message, sender), onTabRemoved(tabId) }
 */
import { describe, expect, it, vi } from 'vitest';
import type { PageSnapshot, Provider } from '../../src/core/contracts';
import { createDiagnostics } from '../../src/core/diagnostics';
import { NetworkStore } from '../../src/core/network';
import { createService } from '../../src/core/service';
import generic from '../../src/providers/generic';

const SELF = 'self';
const MEDIA = 'https://cdn.example.test/a.mp4';
const snapshot: PageSnapshot = {
  pageUrl: 'https://site.example.test/aula',
  pageTitle: 'Aula',
  videos: [{ src: MEDIA, currentSrc: MEDIA, sources: [], hasMediaKeys: false, encrypted: false }],
  crossOriginFrames: [],
};

function setup(providers: Provider[] = [generic]) {
  const collectVideos = vi.fn().mockResolvedValue([{ frameId: 0, snapshot }]);
  const download = vi.fn().mockResolvedValue(9);
  const service = createService({
    extensionId: SELF,
    providers,
    scripting: { collectVideos },
    downloads: { download },
    tabs: { getUrl: () => Promise.resolve(snapshot.pageUrl) },
    permissions: {
      contains: () => Promise.resolve(false),
      request: () => Promise.resolve(false),
    },
    diagnostics: createDiagnostics(),
  });
  return { service, collectVideos, download };
}

describe('service', () => {
  it('SPEC-0005:IT-01 detect + download usam a URL original e o nome sanitizado', async () => {
    const { service, download } = setup();
    const detected = await service.handle({ type: 'detect', tabId: 1 }, { id: SELF });
    const candidateId = detected.ok && 'candidates' in detected ? detected.candidates[0]?.id : '';

    const response = await service.handle({ type: 'download', candidateId }, { id: SELF });

    expect(response).toEqual({ ok: true, downloadId: 9 });
    expect(download).toHaveBeenCalledWith({ url: MEDIA, filename: 'Aula.mp4' });
  });

  it('SPEC-0005:IT-02 detect sem nenhum provider casando devolve lista vazia', async () => {
    const never: Provider = { ...generic, id: 'never', matches: () => false };
    const { service } = setup([never]);

    expect(await service.handle({ type: 'detect', tabId: 1 }, { id: SELF })).toEqual({
      ok: true,
      candidates: [],
      access: { blockedOrigins: [] },
    });
  });

  it('SPEC-0005:IT-02 um provider que falha não esconde os candidatos dos demais', async () => {
    const broken: Provider = {
      ...generic,
      id: 'broken',
      detect: () => Promise.reject(new Error('quebrou')),
    };
    const { service } = setup([broken, generic]);

    const response = await service.handle({ type: 'detect', tabId: 1 }, { id: SELF });

    expect(response).toMatchObject({ ok: true });
    expect(response.ok && 'candidates' in response ? response.candidates : []).toHaveLength(1);
  });

  it('SPEC-0005:IT-02 todos os providers falhando é RESTRICTED_PAGE', async () => {
    const { service, collectVideos } = setup();
    collectVideos.mockRejectedValue(new Error('Cannot access a chrome:// URL'));

    expect(await service.handle({ type: 'detect', tabId: 1 }, { id: SELF })).toEqual({
      ok: false,
      error: 'RESTRICTED_PAGE',
    });
  });

  it('SPEC-0005:IT-03 sender de outra extensão recebe INVALID_MESSAGE sem tocar nas portas', async () => {
    const { service, collectVideos, download } = setup();

    expect(await service.handle({ type: 'detect', tabId: 1 }, { id: 'other' })).toEqual({
      ok: false,
      error: 'INVALID_MESSAGE',
    });
    expect(collectVideos).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('SPEC-0005:UT-06 onTabRemoved descarta os candidatos da aba', async () => {
    const { service } = setup();
    const detected = await service.handle({ type: 'detect', tabId: 1 }, { id: SELF });
    const candidateId = detected.ok && 'candidates' in detected ? detected.candidates[0]?.id : '';

    service.onTabRemoved(1);

    expect(await service.handle({ type: 'download', candidateId }, { id: SELF })).toEqual({
      ok: false,
      error: 'CANDIDATE_NOT_FOUND',
    });
  });

  it('SPEC-0018:UT-05 candidato criado no onNetworkResponse contem o titulo da aba ativa', async () => {
    const data = new Map<string, unknown>();
    const network = new NetworkStore({
      get: (key) => Promise.resolve(data.get(key)),
      set: (key, value) => {
        data.set(key, value);
        return Promise.resolve();
      },
      remove: (key) => {
        data.delete(key);
        return Promise.resolve();
      },
      keys: () => Promise.resolve([...data.keys()]),
    });
    const service = createService({
      extensionId: SELF,
      providers: [],
      scripting: { collectVideos: () => Promise.resolve([]) },
      downloads: { download: () => Promise.resolve(1) },
      tabs: {
        getUrl: () => Promise.resolve('https://site.example.test/aula'),
        getTitle: () => Promise.resolve('Aula Magna de Pilotagem'),
      },
      permissions: {
        contains: () => Promise.resolve(false),
        request: () => Promise.resolve(false),
      },
      diagnostics: createDiagnostics(),
      network,
    });

    await service.onNetworkResponse({
      url: 'https://cdn.example.test/hls/master.m3u8',
      method: 'GET',
      statusCode: 200,
      tabId: 1,
      frameId: 0,
      contentType: 'application/vnd.apple.mpegurl',
      tabTitle: 'Aula Magna de Pilotagem',
    });

    const candidates = await network.forTab(1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.title).toBe('Aula Magna de Pilotagem');
  });
});
