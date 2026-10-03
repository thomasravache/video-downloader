/** Cálculo de progresso (SPEC-0012:UT-02). */

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

/** 100 só com todos os segmentos; antes disso, o piso de segmentos/total. */
export function percentOf(segmentsDone: number, segmentsTotal: number): number {
  if (segmentsTotal <= 0) {
    return 0;
  }
  if (segmentsDone >= segmentsTotal) {
    return 100;
  }
  return Math.max(0, Math.floor((segmentsDone / segmentsTotal) * 100));
}

export function createProgressTracker(segmentsTotal: number): ProgressTracker {
  const finished = new Set<number>();
  let bytesDone = 0;
  const snapshot = (): ProgressSnapshot => ({
    segmentsDone: finished.size,
    segmentsTotal,
    bytesDone,
    percent: percentOf(finished.size, segmentsTotal),
  });
  return {
    segmentDone(index, bytes = 0) {
      if (!finished.has(index)) {
        finished.add(index);
        bytesDone += bytes;
      }
      return snapshot();
    },
    snapshot,
  };
}
