/**
 * Harness do background real para os testes de integração (SPEC-0005:IT-01..IT-05).
 *
 * O fake de `browser.*` do WXT não implementa `downloads` nem `scripting` e entrega `sender = {}`
 * em `runtime.sendMessage`; por isso as mensagens são disparadas direto em `runtime.onMessage`
 * com o `sender.id` desejado, e `downloads.download`/`scripting.executeScript` são stubs.
 *
 * Contrato assumido do background (entrypoints/background.ts):
 *  - `browser.scripting.executeScript({ target: { tabId, allFrames: true }, func })` devolve um
 *    item por frame com acesso, `[{ frameId, result: PageSnapshot }]` (SPEC-0009); itens sem
 *    `result` válido (frame que falhou) são ignorados; quando rejeita, ou quando nenhum frame
 *    responde, a resposta de `detect` é `{ ok: false, error: 'RESTRICTED_PAGE' }`;
 *  - `browser.permissions.contains({ origins: [origem + '/*'] })` diz se a origem já tem permissão
 *    (stub `contains`; padrão: nenhuma origem concedida);
 *  - `browser.downloads.download({ url, filename })` resolve com o `downloadId`;
 *  - `browser.tabs.onRemoved` descarta os candidatos da aba;
 *  - (SPEC-0010) `browser.webRequest.onResponseStarted.addListener(cb, { urls }, ['responseHeaders'])` e
 *    `onBeforeRequest.addListener(cb, { urls, types: ['main_frame'] })`: o fake do WXT não implementa
 *    `webRequest`, então o harness o substitui por eventos que CAPTURAM os listeners; `network.*`
 *    chama os listeners capturados. `restart()` simula a suspensão do service worker: remove os
 *    listeners e chama `background.main()` de novo SEM resetar o fake (storage.session é mantido).
 *  - (SPEC-0012) o fake do WXT também não implementa `downloads.onChanged`, `offscreen.*` nem
 *    `runtime.getContexts`: o harness os substitui. `downloads.onChanged` captura listeners e
 *    `downloadEvents.complete(id)` / `.interrupt(id)` os dispara com `{ id, state: { current } }`;
 *    `offscreen.createDocument/closeDocument/hasDocument` e `runtime.getContexts` simulam o limite de
 *    UM documento por perfil (createDocument com um aberto rejeita, como no Chrome) e expõem
 *    `bg.offscreen.isOpen()`. `restart()` não fecha o documento offscreen (só o service worker some).
 *    O comportamento do documento (executar o job) é de tests/integration/support/offscreen.ts.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { expect, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import background from '../../../entrypoints/background';
import { installDnr } from './dnr';
import type { DnrHarness } from './dnr';
import type {
  DetectResponse,
  FrameSnapshot,
  PageSnapshot,
  VideoCandidate,
  VideoSnapshot,
} from '../../../src/core/contracts';

export const NO_RESPONSE = Symbol('NO_RESPONSE');

interface Registration {
  callback: (details: Record<string, unknown>) => unknown;
  filter: { urls?: string[]; types?: string[] } | undefined;
  extraInfoSpec: string[] | undefined;
}

/** Evento de `webRequest` que captura os listeners registrados pelo background. */
export interface CapturedEvent {
  registrations: Registration[];
  emit(details: Record<string, unknown>): Promise<void>;
}

function capturedEvent(): CapturedEvent & Record<string, unknown> {
  const registrations: Registration[] = [];
  return {
    registrations,
    addListener: (
      callback: Registration['callback'],
      filter?: Registration['filter'],
      extraInfoSpec?: string[],
    ) => {
      registrations.push({ callback, filter, extraInfoSpec });
    },
    removeListener: (callback: Registration['callback']) => {
      const index = registrations.findIndex((r) => r.callback === callback);
      if (index >= 0) {
        registrations.splice(index, 1);
      }
    },
    hasListener: (callback: Registration['callback']) =>
      registrations.some((r) => r.callback === callback),
    async emit(details: Record<string, unknown>) {
      await Promise.all(registrations.map((r) => r.callback(details)));
      // Dá tempo a gravações assíncronas disparadas sem await pelo listener.
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
  };
}

export interface ResponseDetails {
  url: string;
  tabId: number;
  statusCode?: number;
  method?: string;
  frameId?: number;
  /** Cabeçalhos de resposta; a ordem/caixa das chaves é preservada. */
  headers?: Record<string, string>;
  /** SPEC-0016: `details.initiator` do `webRequest` (origem do frame que fez a requisição). */
  initiator?: string;
}

export interface NetworkHarness {
  responseStarted: CapturedEvent;
  beforeRequest: CapturedEvent;
  /** Dispara `onResponseStarted` com a forma de `WebResponseHeadersDetails`. */
  respond(details: ResponseDetails): Promise<void>;
  /** Dispara `onBeforeRequest` de uma navegação do frame principal da aba. */
  navigate(tabId: number, url: string): Promise<void>;
}

function installWebRequestStub(): { responseStarted: CapturedEvent; beforeRequest: CapturedEvent } {
  const responseStarted = capturedEvent();
  const beforeRequest = capturedEvent();
  Object.defineProperty(fakeBrowser, 'webRequest', {
    configurable: true,
    value: { onResponseStarted: responseStarted, onBeforeRequest: beforeRequest },
  });
  return { responseStarted, beforeRequest };
}

export interface OffscreenDocumentHarness {
  createDocument: MockInstance;
  closeDocument: MockInstance;
  /** Há um documento offscreen aberto (fake do limite de um por perfil). */
  isOpen(): boolean;
}

export interface DownloadEventsHarness {
  event: CapturedEvent;
  /** `downloads.onChanged` com o download `id` concluído. */
  complete(id: number): Promise<void>;
  /** `downloads.onChanged` com o download `id` interrompido. */
  interrupt(id: number): Promise<void>;
}

function installDownloadsChangedStub(): DownloadEventsHarness {
  const event = capturedEvent();
  Object.defineProperty(fakeBrowser.downloads, 'onChanged', { configurable: true, value: event });
  const change = (id: number, current: string) => event.emit({ id, state: { current } });
  return {
    event,
    complete: (id) => change(id, 'complete'),
    interrupt: (id) => change(id, 'interrupted'),
  };
}

function installOffscreenStub(): OffscreenDocumentHarness {
  let open = false;
  const createDocument = vi
    .spyOn(fakeBrowser.offscreen as unknown as Record<string, () => unknown>, 'createDocument')
    .mockImplementation(() => {
      if (open) {
        return Promise.reject(new Error('Only a single offscreen document may be created.'));
      }
      open = true;
      return Promise.resolve();
    });
  const closeDocument = vi
    .spyOn(fakeBrowser.offscreen as unknown as Record<string, () => unknown>, 'closeDocument')
    .mockImplementation(() => {
      if (!open) {
        return Promise.reject(new Error('No current offscreen document.'));
      }
      open = false;
      return Promise.resolve();
    });
  vi.spyOn(
    fakeBrowser.offscreen as unknown as Record<string, () => unknown>,
    'hasDocument',
  ).mockImplementation(() => Promise.resolve(open));
  Object.defineProperty(fakeBrowser.runtime, 'getContexts', {
    configurable: true,
    value: () =>
      Promise.resolve(
        open
          ? [
              {
                contextType: 'OFFSCREEN_DOCUMENT',
                documentUrl: `chrome-extension://${fakeBrowser.runtime.id}/offscreen.html`,
              },
            ]
          : [],
      ),
  });
  return { createDocument, closeDocument, isOpen: () => open };
}

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
    crossOriginFrames: [],
    ...overrides,
  };
}

/** Item de `executeScript` de um frame (a forma devolvida pelo Chrome com `allFrames`). */
export function injected(frame: FrameSnapshot): { frameId: number; result: PageSnapshot } {
  return { frameId: frame.frameId, result: frame.snapshot };
}

export interface BackgroundHarness {
  /** Dispara `runtime.onMessage` como se viesse de `senderId` (padrão: a própria extensão). */
  send(message: unknown, senderId?: string): Promise<unknown>;
  executeScript: MockInstance;
  /** `permissions.contains` (stub; padrão: false para toda origem). */
  contains: MockInstance;
  download: MockInstance;
  /** Cria uma aba no fake e devolve o id. */
  newTab(url?: string): Promise<number>;
  /** `detect` para uma página e devolve os candidatos (falha o teste se não ok). */
  detect(snapshot: PageSnapshot): Promise<{ tabId: number; candidates: VideoCandidate[] }>;
  /** `detect` com um retrato por frame (SPEC-0009); `tabUrl` padrão = pageUrl do frame 0. */
  detectFrames(
    frames: FrameSnapshot[],
    tabUrl?: string,
  ): Promise<{ tabId: number; response: DetectResponse }>;
  ownId: string;
  /** Eventos de `webRequest` (SPEC-0010). */
  network: NetworkHarness;
  /** Suspende e recria o background mantendo o mesmo `storage.session` (SPEC-0010:IT-02). */
  restart(): void;
  /** Documento offscreen simulado (SPEC-0012). */
  offscreen: OffscreenDocumentHarness;
  /** `downloads.onChanged` simulado (SPEC-0012). */
  downloadEvents: DownloadEventsHarness;
}

export interface StartOptions {
  /**
   * SPEC-0016: instala o fake de `browser.declarativeNetRequest` (e faz o `fetch` do Node aplicar as regras
   * de `modifyHeaders`) ANTES de `main()`, como o flavor local tem a API. Sem isso o background roda sem a API
   * (flavor public).
   */
  dnr?: boolean;
}

export function startBackground(options: StartOptions & { dnr: true }): BackgroundHarness & {
  dnr: DnrHarness;
};
export function startBackground(options?: StartOptions): BackgroundHarness;
export function startBackground(options: StartOptions = {}): BackgroundHarness {
  (globalThis as Record<string, unknown>)['expect'] = expect;
  fakeBrowser.reset();
  vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({
    manifest_version: 3,
    name: 'Video Downloader',
    version: '0.0.0-test',
  });
  const executeScript = vi
    .spyOn(fakeBrowser.scripting as unknown as Record<string, () => unknown>, 'executeScript')
    .mockResolvedValue([]);
  const contains = vi
    .spyOn(fakeBrowser.permissions as unknown as Record<string, () => unknown>, 'contains')
    .mockResolvedValue(false);
  const download = vi
    .spyOn(fakeBrowser.downloads as unknown as Record<string, () => unknown>, 'download')
    .mockResolvedValue(1);

  const stub = installWebRequestStub();
  const downloadEvents = installDownloadsChangedStub();
  const offscreen = installOffscreenStub();
  const dnr = options.dnr === true ? installDnr() : undefined;
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
    executeScript.mockResolvedValue([injected({ frameId: 0, snapshot })]);
    const response = (await send({ type: 'detect', tabId })) as {
      ok: boolean;
      candidates?: VideoCandidate[];
    };
    if (!response.ok || !response.candidates) {
      throw new Error(`detect falhou: ${String(response.ok)} ${JSON.stringify(response)}`);
    }
    return { tabId, candidates: response.candidates };
  }

  async function detectFrames(frames: FrameSnapshot[], tabUrl?: string) {
    const tabId = await newTab(tabUrl ?? frames[0]?.snapshot.pageUrl);
    executeScript.mockResolvedValue(frames.map(injected));
    const response = (await send({ type: 'detect', tabId })) as DetectResponse;
    return { tabId, response };
  }

  const network: NetworkHarness = {
    ...stub,
    async respond({
      url,
      tabId,
      statusCode = 200,
      method = 'GET',
      frameId = 0,
      headers = {},
      initiator,
    }) {
      await stub.responseStarted.emit({
        ...(initiator !== undefined && { initiator }),
        url,
        tabId,
        statusCode,
        method,
        frameId,
        type: 'xmlhttprequest',
        requestId: String(Math.random()),
        timeStamp: Date.now(),
        responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
      });
    },
    async navigate(tabId, url) {
      await stub.beforeRequest.emit({
        url,
        tabId,
        frameId: 0,
        method: 'GET',
        type: 'main_frame',
        requestId: String(Math.random()),
        timeStamp: Date.now(),
      });
    },
  };

  function restart(): void {
    // Service worker suspenso: os listeners somem; o storage.session do navegador permanece.
    fakeBrowser.runtime.onMessage.removeAllListeners();
    fakeBrowser.tabs.onRemoved.removeAllListeners();
    stub.responseStarted.registrations.length = 0;
    stub.beforeRequest.registrations.length = 0;
    downloadEvents.event.registrations.length = 0;
    background.main();
  }

  return {
    ...(dnr !== undefined && { dnr }),
    send,
    executeScript,
    contains,
    download,
    newTab,
    detect,
    detectFrames,
    ownId,
    network,
    restart,
    offscreen,
    downloadEvents,
  };
}
