/**
 * Contrato usado (SPEC-0012:UT-02) — src/core/hls-download/progress.ts:
 *   createProgressTracker(segmentsTotal) -> { segmentDone(index, bytes?) , snapshot() }
 *   ProgressSnapshot = { segmentsDone, segmentsTotal, bytesDone, percent }
 *   - conclusões em qualquer ordem; `bytes` omitido = tamanho desconhecido (soma 0);
 *   - percent 0–100, monotônico, 100 só com todos os segmentos; segmentsDone/bytesDone somam;
 *   - concluir de novo o mesmo índice não conta duas vezes.
 */
import { describe, expect, it } from 'vitest';
import { createProgressTracker } from '../../src/core/hls-download';

describe('createProgressTracker: progresso de segmentos', () => {
  it('SPEC-0012:UT-02 começa em 0% e sem bytes', () => {
    const tracker = createProgressTracker(5);

    expect(tracker.snapshot()).toEqual({
      segmentsDone: 0,
      segmentsTotal: 5,
      bytesDone: 0,
      percent: 0,
    });
  });

  it('SPEC-0012:UT-02 conclusões fora de ordem: percent monotônico, segmentsDone e bytesDone corretos', () => {
    const tracker = createProgressTracker(4);
    const order = [3, 0, 2, 1];
    const percents: number[] = [];
    const sizes = [1000, 2000, undefined, 500];

    order.forEach((index, step) => {
      const snap = tracker.segmentDone(index, sizes[step]);
      percents.push(snap.percent);
      expect(snap.segmentsDone).toBe(step + 1);
      expect(snap.segmentsTotal).toBe(4);
    });

    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(percents.at(-1)).toBe(100);
    expect(percents.every((p) => p >= 0 && p <= 100)).toBe(true);
    expect(tracker.snapshot().bytesDone).toBe(3500);
  });

  it('SPEC-0012:UT-02 percent acompanha segmentos concluídos / total (tolerância de 1 ponto)', () => {
    const tracker = createProgressTracker(30);

    for (let i = 0; i < 12; i++) {
      tracker.segmentDone(29 - i);
    }

    const snap = tracker.snapshot();
    expect(snap.segmentsDone).toBe(12);
    expect(Math.abs(snap.percent - 40)).toBeLessThanOrEqual(1);
  });

  it('SPEC-0012:UT-02 tamanhos desconhecidos (sem bytes) não quebram o percentual nem os bytes', () => {
    const tracker = createProgressTracker(2);

    tracker.segmentDone(1);
    const snap = tracker.segmentDone(0);

    expect(snap).toEqual({ segmentsDone: 2, segmentsTotal: 2, bytesDone: 0, percent: 100 });
  });

  it('SPEC-0012:UT-02 concluir duas vezes o mesmo índice não conta duas vezes', () => {
    const tracker = createProgressTracker(3);

    tracker.segmentDone(1, 10);
    const snap = tracker.segmentDone(1, 10);

    expect(snap.segmentsDone).toBe(1);
    expect(snap.bytesDone).toBe(10);
    expect(snap.percent).toBeLessThan(100);
  });

  it('SPEC-0012:UT-02 nunca passa de 100% nem fica 100% antes do último segmento', () => {
    const tracker = createProgressTracker(1000);

    for (let i = 0; i < 999; i++) {
      expect(tracker.segmentDone(i, 1).percent).toBeLessThan(100);
    }
    expect(tracker.segmentDone(999, 1).percent).toBe(100);
  });
});
