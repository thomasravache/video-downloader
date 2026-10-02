/**
 * Contrato usado (SPEC-0005:IT-01, IT-02, UT-06 via wiring):
 *  - entrypoints/background.ts registra `runtime.onMessage` e responde conforme o contrato v1
 *    (src/core/contracts); ver tests/integration/support/background.ts para as portas stubadas.
 *  - `download` chama `browser.downloads.download({ url, filename })` com a URL ORIGINAL e o
 *    nome de `toFilename` (src/core/filename.ts).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, startBackground, video } from './support/background';
import type { BackgroundHarness } from './support/background';

const MEDIA = 'https://cdn.example.test/media/aula.mp4';

let bg: BackgroundHarness;

beforeEach(() => {
  bg = startBackground();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('background: detect e download', () => {
  it('SPEC-0005:IT-01 detect devolve o candidato da página-fixture', async () => {
    const { tabId, candidates } = await bg.detect(page([video({ src: MEDIA, currentSrc: MEDIA })]));

    expect(bg.executeScript).toHaveBeenCalled();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      tabId,
      mediaUrl: MEDIA,
      providerId: 'generic',
      protection: 'none',
      support: 'downloadable',
      title: 'Aula 1: Intro',
    });
    expect(candidates[0]?.id).toEqual(expect.any(String));
  });

  it('SPEC-0005:IT-01 download chama downloads.download com a URL original e o nome sanitizado', async () => {
    bg.download.mockResolvedValue(42);
    const { candidates } = await bg.detect(page([video({ src: MEDIA, currentSrc: MEDIA })]));

    const response = await bg.send({ type: 'download', candidateId: candidates[0]?.id });

    expect(response).toEqual({ ok: true, downloadId: 42 });
    expect(bg.download).toHaveBeenCalledTimes(1);
    const options = bg.download.mock.calls[0]?.[0] as { url: string; filename: string };
    expect(options.url).toBe(MEDIA);
    expect(options.filename).toMatch(/^Aula 1/);
    expect(options.filename).not.toMatch(/[/\\:*?"<>|]/);
    expect(options.filename.endsWith('.mp4')).toBe(true);
  });

  it('SPEC-0005:IT-02 download de vídeo com DRM responde PROTECTED e não baixa', async () => {
    const { candidates } = await bg.detect(
      page([video({ src: MEDIA, currentSrc: MEDIA, hasMediaKeys: true })]),
    );
    expect(candidates[0]?.protection).toBe('drm');

    const response = await bg.send({ type: 'download', candidateId: candidates[0]?.id });

    expect(response).toEqual({ ok: false, error: 'PROTECTED' });
    expect(bg.download).not.toHaveBeenCalled();
  });

  it('SPEC-0005:IT-02 download de stream blob: responde UNSUPPORTED e não baixa', async () => {
    const blob = 'blob:https://site.example.test/3f1c-uuid';
    const { candidates } = await bg.detect(page([video({ src: blob, currentSrc: blob })]));
    expect(candidates[0]?.support).toBe('unsupported-stream');

    const response = await bg.send({ type: 'download', candidateId: candidates[0]?.id });

    expect(response).toEqual({ ok: false, error: 'UNSUPPORTED' });
    expect(bg.download).not.toHaveBeenCalled();
  });

  it('SPEC-0005:IT-02 candidateId desconhecido responde CANDIDATE_NOT_FOUND', async () => {
    const response = await bg.send({ type: 'download', candidateId: 'nao-existe' });

    expect(response).toEqual({ ok: false, error: 'CANDIDATE_NOT_FOUND' });
    expect(bg.download).not.toHaveBeenCalled();
  });

  it('SPEC-0005:IT-02 downloads.download rejeitando responde DOWNLOAD_FAILED com o motivo', async () => {
    bg.download.mockRejectedValue(new Error('NETWORK_FAILED'));
    const { candidates } = await bg.detect(page([video({ src: MEDIA, currentSrc: MEDIA })]));

    const response = await bg.send({ type: 'download', candidateId: candidates[0]?.id });

    expect(response).toMatchObject({ ok: false, error: 'DOWNLOAD_FAILED' });
    expect((response as { reason: string }).reason).toContain('NETWORK_FAILED');
  });

  it('SPEC-0005:UT-06 ao fechar a aba o background descarta os candidatos dela', async () => {
    const { tabId, candidates } = await bg.detect(page([video({ src: MEDIA, currentSrc: MEDIA })]));

    await (
      fakeBrowser.tabs.onRemoved as unknown as { trigger(...args: unknown[]): Promise<unknown> }
    ).trigger(tabId, { windowId: 0, isWindowClosing: false });

    const response = await bg.send({ type: 'download', candidateId: candidates[0]?.id });
    expect(response).toEqual({ ok: false, error: 'CANDIDATE_NOT_FOUND' });
  });

  it('SPEC-0005:IT-02 detect em página que não permite scripts responde RESTRICTED_PAGE', async () => {
    const tabId = await bg.newTab('https://site.example.test/');
    bg.executeScript.mockRejectedValue(new Error('Cannot access a chrome:// URL'));

    const response = await bg.send({ type: 'detect', tabId });

    expect(response).toEqual({ ok: false, error: 'RESTRICTED_PAGE' });
  });
});
