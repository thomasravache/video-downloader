/** Execução de um job no offscreen (SPEC-0012); sem `chrome.*`: tudo entra por `deps`. Assinatura apenas. */
import type { OffscreenEvent, OffscreenStart } from '../../src/core/hls-download';

export interface OffscreenJobDeps {
  fetch: typeof fetch;
  /** Entrega progresso/resultado ao background. */
  emit: (event: OffscreenEvent) => void;
  signal: AbortSignal;
  /** Padrão: espera real; os testes injetam uma espera imediata. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Baixa os segmentos (`runSegments`: concorrência 4, 3 retentativas), monta (`assembleTs`/`assembleFmp4`),
 * cria a blob URL (`URL.createObjectURL`) e emite `ready`; em falha emite `failed` com o `JobError`.
 * Cancelamento (`signal`): resolve sem emitir `ready`/`failed`, sem novas requisições.
 */
export function runOffscreenJob(_request: OffscreenStart, _deps: OffscreenJobDeps): Promise<void> {
  return Promise.reject(new Error('NotImplemented'));
}
