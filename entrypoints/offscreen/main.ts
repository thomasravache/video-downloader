import type { OffscreenEvent } from '../../src/core/hls-download';
import { createCommandHandler, isCommand } from './commands';
import { runOffscreenJob } from './run-job';

/**
 * Documento offscreen (razão BLOBS, ADR-0013): baixa os segmentos, monta o MP4 e cria a blob URL.
 * Só fala com o background por `runtime` e só aceita comandos do contexto da própria extensão
 * (nunca de content script: esses trazem `sender.tab`).
 */
function emit(jobId: string, event: OffscreenEvent): void {
  browser.runtime.sendMessage({ target: 'background', jobId, event }).catch(() => undefined);
}

const handle = createCommandHandler({
  run: (start, signal) =>
    runOffscreenJob(start, {
      fetch: (input, init) => fetch(input, init),
      signal,
      emit: (event) => {
        emit(start.jobId, event);
      },
    }).catch(() => {
      emit(start.jobId, { type: 'failed', error: 'ASSEMBLY_FAILED' });
    }),
  revoke: (blobUrl) => {
    URL.revokeObjectURL(blobUrl);
  },
});

browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  // Mensagens para outros destinos (popup/background) não são deste documento: sem resposta.
  if (sender.id !== browser.runtime.id || sender.tab !== undefined || !isCommand(message)) {
    return false;
  }
  handle(message);
  sendResponse({ ok: true });
  return false;
});
