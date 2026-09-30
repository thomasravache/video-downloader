import type { VideoCandidate } from './contracts';

export interface CandidateStore {
  /** Substitui os candidatos da aba. */
  replaceTab(tabId: number, candidates: VideoCandidate[]): void;
  forTab(tabId: number): VideoCandidate[];
  find(candidateId: string): VideoCandidate | undefined;
  /** Descarta o estado da aba (aba fechada). */
  removeTab(tabId: number): void;
}

export function createCandidateStore(): CandidateStore {
  throw new Error('NotImplemented');
}
