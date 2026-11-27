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

/** Controlador de re-detecção do popup (SPEC-0024 D2, D4). */
export function createRedetectController(_deps: RedetectDeps): RedetectController {
  throw new Error('NotImplemented');
}
