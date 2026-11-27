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
import { SELF, pageWithVideo, setupService } from './support/detect-service';

const MP4 = 'https://cdn.example.test/v/aula.mp4';

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
