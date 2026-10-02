import type { OffscreenCommand, OffscreenEvent } from '../../src/core/hls-download';
import { runOffscreenJob } from './run-job';

/**
 * Documento offscreen (razão BLOBS, ADR-0013): baixa os segmentos, monta o MP4 e cria a blob URL.
 * Só fala com o background por `runtime` e só aceita comandos da própria extensão.
 */
const controllers = new Map<string, AbortController>();

function isCommand(message: unknown): message is OffscreenCommand {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const { target, type, jobId } = message as Record<string, unknown>;
  return (
    target === 'offscreen' &&
    typeof jobId === 'string' &&
    (type === 'start' || type === 'cancel' || type === 'revoke')
  );
}

function emit(jobId: string, event: OffscreenEvent): void {
  browser.runtime.sendMessage({ target: 'background', jobId, event }).catch(() => undefined);
}

browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  // Mensagens para outros destinos (popup/background) não são deste documento: sem resposta.
  if (sender.id !== browser.runtime.id || !isCommand(message)) {
    return false;
  }
  switch (message.type) {
    case 'start': {
      const controller = new AbortController();
      controllers.set(message.jobId, controller);
      void runOffscreenJob(message, {
        fetch: (input, init) => fetch(input, init),
        signal: controller.signal,
        emit: (event) => {
          emit(message.jobId, event);
        },
      })
        .catch(() => {
          emit(message.jobId, { type: 'failed', error: 'ASSEMBLY_FAILED' });
        })
        .finally(() => {
          controllers.delete(message.jobId);
        });
      break;
    }
    case 'cancel':
      controllers.get(message.jobId)?.abort();
      break;
    case 'revoke':
      URL.revokeObjectURL(message.blobUrl);
      break;
  }
  sendResponse({ ok: true });
  return false;
});
