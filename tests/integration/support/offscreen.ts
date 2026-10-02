/**
 * Offscreen document SIMULADO para os testes de integração do SPEC-0012 (não é teste).
 *
 * Protocolo background <-> offscreen (tipos em src/core/hls-download/protocol.ts):
 *  - o background fala com o offscreen por `browser.runtime.sendMessage({ target: 'offscreen', ... })`:
 *      { type:'start', jobId, urls, initUrl?, fmp4 }   -> o offscreen responde { ok: true } e trabalha
 *      { type:'cancel', jobId }                         -> interrompe o job (sem novas requisições)
 *      { type:'revoke', jobId, blobUrl }                -> `URL.revokeObjectURL(blobUrl)`
 *    Aqui `runtime.sendMessage` é interceptado: mensagens com `target:'offscreen'` vão para esta
 *    simulação; o fake do WXT entrega `sender = {}` e não distingue destinatários.
 *  - o offscreen fala com o background por mensagens { target:'background', jobId, event }
 *    (OffscreenEvent: progress | assembling | ready{blobUrl,bytes} | failed{error}), entregues ao
 *    `runtime.onMessage` do background com `sender.id` = id da extensão. O background deve responder
 *    (sendResponse ou Promise) depois de processar; sem resposta a entrega espera até 200 ms.
 *
 * Modos:
 *  - 'real' (padrão): cada `start` roda o `runOffscreenJob` de PRODUÇÃO (entrypoints/offscreen/run-job)
 *    com o `fetch` do Node, esperas imediatas e a blob URL real do Node (`URL.createObjectURL`);
 *  - 'manual': o `start` só é registrado (em `commands`); o teste dirige os eventos com `emit`.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { vi } from 'vitest';
import { runOffscreenJob } from '../../../entrypoints/offscreen/run-job';
import type {
  OffscreenCommand,
  OffscreenEvent,
  OffscreenStart,
} from '../../../src/core/hls-download';
import type { BackgroundHarness } from './background';

export interface SimulatedOffscreen {
  /** Todos os comandos recebidos do background, em ordem. */
  commands: OffscreenCommand[];
  /** `start` recebidos. */
  starts(): OffscreenStart[];
  /** Blob URLs criadas por jobs `real` (para conferir revogação). */
  createdBlobUrls: string[];
  /** Blob URLs revogadas por `revoke`. */
  revoked: string[];
  /** Entrega um evento ao background e espera ele processar. */
  emit(jobId: string, event: OffscreenEvent): Promise<void>;
  /** Espera as entregas pendentes dos jobs `real`. */
  idle(): Promise<void>;
}

export interface SimulateOptions {
  mode?: 'real' | 'manual';
  /** `fetch` usado pelos jobs reais (padrão: o global do Node). */
  fetch?: typeof fetch;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function simulateOffscreen(
  bg: BackgroundHarness,
  options: SimulateOptions = {},
): SimulatedOffscreen {
  const mode = options.mode ?? 'real';
  const commands: OffscreenCommand[] = [];
  const createdBlobUrls: string[] = [];
  const revoked: string[] = [];
  const controllers = new Map<string, AbortController>();
  let queue: Promise<void> = Promise.resolve();
  const running = new Set<Promise<void>>();

  const onMessage = fakeBrowser.runtime.onMessage as unknown as {
    trigger(...args: unknown[]): Promise<unknown[]>;
  };

  async function deliver(jobId: string, event: OffscreenEvent): Promise<void> {
    let respond: (value: unknown) => void = () => undefined;
    const responded = new Promise<unknown>((resolve) => {
      respond = resolve;
    });
    const results = await onMessage.trigger(
      { target: 'background', jobId, event },
      { id: bg.ownId, url: `chrome-extension://${bg.ownId}/offscreen.html` },
      respond,
    );
    const promised = results.find((r) => r instanceof Promise) as Promise<unknown> | undefined;
    if (promised) {
      await promised;
    } else if (results.includes(true)) {
      await Promise.race([responded, delay(200)]);
    }
  }

  function emit(jobId: string, event: OffscreenEvent): Promise<void> {
    // Entregas em série: o background vê os eventos na ordem em que o offscreen os emitiu.
    queue = queue.then(() => deliver(jobId, event));
    return queue;
  }

  function handle(message: unknown): Promise<unknown> {
    const command = message as OffscreenCommand;
    commands.push(command);
    switch (command.type) {
      case 'start': {
        if (mode === 'manual') {
          return Promise.resolve({ ok: true });
        }
        const controller = new AbortController();
        controllers.set(command.jobId, controller);
        const job = runOffscreenJob(command, {
          fetch: options.fetch ?? globalThis.fetch,
          signal: controller.signal,
          sleep: () => Promise.resolve(),
          emit: (event) => {
            if (event.type === 'ready') {
              createdBlobUrls.push(event.blobUrl);
            }
            void emit(command.jobId, event);
          },
        }).catch(() => undefined);
        running.add(job);
        void job.finally(() => running.delete(job));
        return Promise.resolve({ ok: true });
      }
      case 'cancel':
        controllers.get(command.jobId)?.abort();
        return Promise.resolve({ ok: true });
      case 'revoke':
        URL.revokeObjectURL(command.blobUrl);
        revoked.push(command.blobUrl);
        return Promise.resolve({ ok: true });
    }
  }

  vi.spyOn(
    fakeBrowser.runtime as unknown as Record<string, () => unknown>,
    'sendMessage',
  ).mockImplementation(((message: unknown) => {
    const target = (message as { target?: unknown } | null)?.target;
    return target === 'offscreen' ? handle(message) : Promise.resolve(undefined);
  }) as () => unknown);

  return {
    commands,
    starts: () => commands.filter((c): c is OffscreenStart => c.type === 'start'),
    createdBlobUrls,
    revoked,
    emit,
    async idle() {
      await Promise.all([...running]);
      await queue;
    },
  };
}
