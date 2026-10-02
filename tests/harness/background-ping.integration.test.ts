import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// O background real (não um dublê): o projeto `integration` deve rodar com o WxtVitest()
// (auto-imports de defineBackground/browser apontando para o fake de browser.*).
import background from '../../entrypoints/background';

describe('background com o fake de browser.* do WXT', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({
      manifest_version: 3,
      name: 'Video Downloader',
      version: '1.2.3',
    });
    background.main();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fakeBrowser.reset();
  });

  it('SPEC-0003:IT-01 mensagem {type:"ping"} recebe {type:"pong", version} do background real', async () => {
    const response: unknown = await fakeBrowser.runtime.sendMessage({ type: 'ping' });

    expect(response).toEqual({ type: 'pong', version: '1.2.3' });
  });
});
