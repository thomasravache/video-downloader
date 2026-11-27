import type { DetectResponse } from '../../src/core/contracts';

/** SPEC-0024 (D4): intervalo da consulta `network-revision` com o popup aberto. */
export const REVISION_POLL_MS = 1_000;
/** SPEC-0024 (D4): com a lista vazia, o `detect` é refeito neste intervalo... */
export const EMPTY_RETRY_MS = 3_000;
/** ...por até este tempo desde a abertura do popup. */
export const EMPTY_RETRY_WINDOW_MS = 30_000;
/** SPEC-0024 (D2): `detect` sem resposta neste tempo vira erro com "Tentar de novo". */
export const DETECT_TIMEOUT_MS = 10_000;

export interface RedetectView {
  /**
   * Desenha a resposta de `detect`. `preserve`: ids de cartões já na tela que ficam intactos (seleção de
   * qualidade e de áudio dos que continuam na lista, e cartões com job de download em andamento).
   */
  render(response: DetectResponse | undefined, preserve: ReadonlySet<string>): void;
  /** Estado de erro: `popupDetectFailed` com o botão `detect-retry`, cujo clique chama `retry`. */
  showFailed(retry: () => void): void;
}

export interface RedetectDeps {
  /** `sendMessage({ type: 'detect', tabId })`: pode rejeitar ou nunca responder. */
  detect(): Promise<DetectResponse | undefined>;
  /** `sendMessage({ type: 'network-revision', tabId })` -> `revision`; falha é ignorada. */
  revision(): Promise<number | undefined>;
  view: RedetectView;
  /** Ids dos candidatos com job de download em andamento. */
  busy(): ReadonlySet<string>;
  /** Diagnóstico do popup (`popup.detect_failed`). */
  log(event: string, fields?: Record<string, unknown>): void;
}

export interface RedetectController {
  /** Primeira detecção e início do acompanhamento (revisão a cada 1 s; lista vazia: a cada 3 s por até 30 s). */
  start(): Promise<void>;
  /** "Procurar de novo" / "Tentar de novo": refaz o `detect` na hora. */
  redetect(): Promise<void>;
  /** Para todos os timers. */
  stop(): void;
}

/** `promise` ou rejeição depois de `ms` (o `sendMessage` pode nunca responder). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Controlador de re-detecção do popup (SPEC-0024 D2, D4). Mesmo padrão do polling de job do popup, sem
 * tocar no DOM: o popup liga `detect`/`revision` ao `sendMessage` e `view` ao DOM.
 */
export function createRedetectController(deps: RedetectDeps): RedetectController {
  const openedAt = Date.now();
  /** Ids dos cartões desenhados pela última resposta. */
  let rendered = new Set<string>();
  let lastRevision: number | undefined;
  let detecting = false;
  let polling = false;
  let revisionTimer: ReturnType<typeof setInterval> | undefined;
  let emptyTimer: ReturnType<typeof setInterval> | undefined;

  /** Sem lista ainda: vazia ou página restrita (o DOM pode ainda não ter carregado) — vale a re-tentativa. */
  const isEmpty = (response: DetectResponse | undefined): boolean =>
    response?.ok === true
      ? response.candidates.length === 0
      : response?.error === 'RESTRICTED_PAGE';

  function stopEmptyRetry(): void {
    clearInterval(emptyTimer);
    emptyTimer = undefined;
  }

  /** Lista vazia: `detect` a cada 3 s, por até 30 s desde a abertura do popup. */
  function startEmptyRetry(): void {
    if (emptyTimer !== undefined || Date.now() - openedAt >= EMPTY_RETRY_WINDOW_MS) {
      return;
    }
    emptyTimer = setInterval(() => {
      if (Date.now() - openedAt > EMPTY_RETRY_WINDOW_MS) {
        stopEmptyRetry();
        return;
      }
      if (!detecting) {
        void run();
      }
    }, EMPTY_RETRY_MS);
  }

  let inFlight: Promise<void> | undefined;
  let rerun: Promise<void> | undefined;

  /**
   * Um `detect` por vez. Pedidos feitos com um em andamento (botão, "Tentar de novo", acesso concedido) não se
   * perdem: viram exatamente um `detect` a mais, depois do atual.
   */
  function run(): Promise<void> {
    if (inFlight === undefined) {
      inFlight = detectOnce().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    }
    rerun ??= inFlight.then(() => {
      rerun = undefined;
      return run();
    });
    return rerun;
  }

  async function detectOnce(): Promise<void> {
    detecting = true;
    let response: DetectResponse | undefined;
    try {
      response = await withTimeout(deps.detect(), DETECT_TIMEOUT_MS);
    } catch (error) {
      deps.log('popup.detect_failed', {
        reason: error instanceof Error && error.message === 'timeout' ? 'timeout' : 'rejected',
      });
      deps.view.showFailed(() => {
        void run();
      });
      return;
    } finally {
      detecting = false;
    }
    const ids = new Set(response?.ok === true ? response.candidates.map((c) => c.id) : []);
    const preserve = new Set([...rendered].filter((id) => ids.has(id)));
    for (const id of deps.busy()) {
      preserve.add(id);
    }
    deps.view.render(response, preserve);
    rendered = ids;
    if (isEmpty(response)) {
      startEmptyRetry();
    } else {
      stopEmptyRetry();
    }
  }

  async function pollRevision(): Promise<void> {
    if (polling || detecting) {
      return;
    }
    polling = true;
    try {
      const revision = await deps.revision().catch(() => undefined);
      if (revision !== undefined && revision !== lastRevision) {
        lastRevision = revision;
        await run();
      }
    } finally {
      polling = false;
    }
  }

  return {
    async start() {
      lastRevision = await deps.revision().catch(() => undefined);
      revisionTimer ??= setInterval(() => {
        void pollRevision();
      }, REVISION_POLL_MS);
      await run();
    },
    redetect: run,
    stop() {
      clearInterval(revisionTimer);
      revisionTimer = undefined;
      stopEmptyRetry();
    },
  };
}
