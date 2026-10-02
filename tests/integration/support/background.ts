/**
 * Harness do background real para os testes de integração (SPEC-0005:IT-01..IT-05).
 *
 * O fake de `browser.*` do WXT não implementa `downloads` nem `scripting` e entrega `sender = {}`
 * em `runtime.sendMessage`; por isso as mensagens são disparadas direto em `runtime.onMessage`
 * com o `sender.id` desejado, e `downloads.download`/`scripting.executeScript` são stubs.
 *
 * Contrato assumido do background (entrypoints/background.ts):
 *  - `browser.scripting.executeScript(...)` devolve `[{ result: PageSnapshot }]` (o retrato da página);
 *    quando rejeita, a resposta de `detect` é `{ ok: false, error: 'RESTRICTED_PAGE' }`;
 *  - `browser.downloads.download({ url, filename })` resolve com o `downloadId`;
 *  - `browser.tabs.onRemoved` descarta os candidatos da aba.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { vi } from 'vitest';
import type { MockInstance } from 'vitest';
import background from '../../../entrypoints/background';
import type { PageSnapshot, VideoSnapshot, VideoCandidate } from '../../../src/core/contracts';

export const NO_RESPONSE = Symbol('NO_RESPONSE');

export function video(overrides: Partial<VideoSnapshot> = {}): VideoSnapshot {
  return {
    src: null,
    currentSrc: '',
    sources: [],
    hasMediaKeys: false,
    encrypted: false,
    ...overrides,
  };
}

export function page(videos: VideoSnapshot[], overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    pageUrl: 'https://site.example.test/aula',
    pageTitle: 'Aula 1: Intro',
    videos,
    ...overrides,
  };
}

export interface BackgroundHarness {
  /** Dispara `runtime.onMessage` como se viesse de `senderId` (padrão: a própria extensão). */
  send(message: unknown, senderId?: string): Promise<unknown>;
  executeScript: MockInstance;
  download: MockInstance;
  /** Cria uma aba no fake e devolve o id. */
  newTab(url?: string): Promise<number>;
  /** `detect` para uma página e devolve os candidatos (falha o teste se não ok). */
  detect(snapshot: PageSnapshot): Promise<{ tabId: number; candidates: VideoCandidate[] }>;
  ownId: string;
}

export function startBackground(): BackgroundHarness {
  fakeBrowser.reset();
  vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({
    manifest_version: 3,
    name: 'Video Downloader',
    version: '0.0.0-test',
  });
  const executeScript = vi
    .spyOn(fakeBrowser.scripting as unknown as Record<string, () => unknown>, 'executeScript')
    .mockResolvedValue([]);
  const download = vi
    .spyOn(fakeBrowser.downloads as unknown as Record<string, () => unknown>, 'download')
    .mockResolvedValue(1);

  background.main();

  const ownId = fakeBrowser.runtime.id;

  async function send(message: unknown, senderId: string = ownId): Promise<unknown> {
    let respond: (value: unknown) => void = () => undefined;
    const responded = new Promise<unknown>((resolve) => {
      respond = resolve;
    });
    const listenerResults: unknown[] = await (
      fakeBrowser.runtime.onMessage as unknown as {
        trigger(...args: unknown[]): Promise<unknown[]>;
      }
    ).trigger(message, { id: senderId }, respond);
    // Listener no estilo polyfill: devolve uma Promise com a resposta.
    const promised = listenerResults.find((r) => r instanceof Promise);
    if (promised) {
      return promised;
    }
    const timeout = new Promise<symbol>((resolve) =>
      setTimeout(() => {
        resolve(NO_RESPONSE);
      }, 1500),
    );
    return Promise.race([responded, timeout]);
  }

  async function newTab(url = 'https://site.example.test/aula'): Promise<number> {
    const tab = await fakeBrowser.tabs.create({ url });
    if (tab.id === undefined) {
      throw new Error('fake tabs.create sem id');
    }
    return tab.id;
  }

  async function detect(snapshot: PageSnapshot) {
    const tabId = await newTab(snapshot.pageUrl);
    executeScript.mockResolvedValue([{ result: snapshot }]);
    const response = (await send({ type: 'detect', tabId })) as {
      ok: boolean;
      candidates?: VideoCandidate[];
    };
    if (!response.ok || !response.candidates) {
      throw new Error(`detect falhou: ${String(response.ok)} ${JSON.stringify(response)}`);
    }
    return { tabId, candidates: response.candidates };
  }

  return { send, executeScript, download, newTab, detect, ownId };
}
