/** Cálculo de progresso (SPEC-0012:UT-02). Assinatura apenas. */

export interface ProgressSnapshot {
  segmentsDone: number;
  segmentsTotal: number;
  bytesDone: number;
  /** 0–100, monotônico. */
  percent: number;
}

export interface ProgressTracker {
  /** Registra a conclusão do segmento `index` (em qualquer ordem); `bytes` desconhecido = 0. Idempotente por índice. */
  segmentDone(index: number, bytes?: number): ProgressSnapshot;
  snapshot(): ProgressSnapshot;
}

export function createProgressTracker(_segmentsTotal: number): ProgressTracker {
  throw new Error('NotImplemented');
}
