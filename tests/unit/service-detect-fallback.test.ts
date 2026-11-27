/**
 * Contrato usado (SPEC-0024:CH-01, UT-01, UT-02), src/core/service.ts:
 *   createService({ ..., providers, scripting, network: NetworkStore, diagnostics }).handle({ type: 'detect', tabId })
 *   Coleta no DOM falhou em todos os providers (`scripting.collectVideos` rejeita):
 *     rede da aba com candidatos -> { ok: true, candidates: <rede>, access } + log `detect.provider_failed`
 *     rede vazia                 -> { ok: false, error: 'RESTRICTED_PAGE' }   (como hoje)
 *   Página com `<video src>` direto -> candidato `file` do DOM (como hoje).
 */
import { describe, expect, it } from 'vitest';
import type { DetectResponse } from '../../src/core/contracts';
import { HLS_TYPE, SELF, pageWithVideo, response, setupService } from './support/detect-service';

const MP4 = 'https://cdn.example.test/v/aula.mp4';
const HLS = 'https://cdn.example.test/hls/master.m3u8';

async function detect(service: ReturnType<typeof setupService>['service'], tabId = 1) {
  return (await service.handle({ type: 'detect', tabId }, { id: SELF })) as DetectResponse;
}

describe('detect: caracterização (antes da SPEC-0024)', () => {
  it('SPEC-0024:CH-01 (guarda: passa antes da mudança) coleta que falha com a rede vazia devolve RESTRICTED_PAGE', async () => {
    const { service, collectVideos } = setupService();
    collectVideos.mockRejectedValue(new Error('Frame with ID 0 was removed.'));

    expect(await detect(service)).toEqual({ ok: false, error: 'RESTRICTED_PAGE' });
  });

  it('SPEC-0024:CH-01 (guarda: passa antes da mudança) página com <video src> direto devolve um candidato file do DOM', async () => {
    const { service, collectVideos } = setupService();
    collectVideos.mockResolvedValue([{ frameId: 0, snapshot: pageWithVideo(MP4) }]);

    const result = await detect(service);

    expect(result.ok).toBe(true);
    const candidates = result.ok ? result.candidates : [];
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      mediaUrl: MP4,
      kind: 'file',
      source: 'dom',
      support: 'downloadable',
    });
  });
});

describe('detect: falha parcial do DOM não esconde a rede (D1)', () => {
  it('SPEC-0024:UT-01 coleta que lança erro com um HLS na rede da aba devolve ok com o HLS e registra detect.provider_failed', async () => {
    const { service, collectVideos, diagnostics } = setupService();
    collectVideos.mockRejectedValue(new Error('Frame with ID 3 is showing error page'));
    await service.onNetworkResponse(
      response({ url: HLS, tabId: 1, contentType: HLS_TYPE, contentLength: 700 }),
    );

    const result = await detect(service);

    expect(result).toMatchObject({ ok: true, access: { blockedOrigins: [] } });
    const candidates = result.ok ? result.candidates : [];
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ mediaUrl: HLS, kind: 'hls', source: 'network' });
    const events = diagnostics.snapshot().map((entry) => entry.event);
    expect(events).toContain('detect.provider_failed');
    expect(events).not.toContain('detect.restricted');
  });

  it('SPEC-0024:UT-02 (guarda: passa antes da mudança) coleta que lança erro com a rede da aba vazia (só outra aba tem captura) devolve RESTRICTED_PAGE', async () => {
    const { service, collectVideos } = setupService();
    collectVideos.mockRejectedValue(new Error('Cannot access contents of the page'));
    await service.onNetworkResponse(
      response({ url: HLS, tabId: 2, contentType: HLS_TYPE, contentLength: 700 }),
    );

    expect(await detect(service, 1)).toEqual({ ok: false, error: 'RESTRICTED_PAGE' });
  });
});
