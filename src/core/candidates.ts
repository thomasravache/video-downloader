import type { VideoCandidate } from './contracts';

export interface CandidateStore {
  /** Substitui os candidatos da aba. */
  replaceTab(tabId: number, candidates: VideoCandidate[]): void;
  forTab(tabId: number): VideoCandidate[];
  find(candidateId: string): VideoCandidate | undefined;
  /** Substitui o candidato guardado (mesmo id), p.ex. com o `HlsInfo` resolvido. */
  update(candidate: VideoCandidate): void;
  /** Descarta o estado da aba (aba fechada). */
  removeTab(tabId: number): void;
}

/** Hash estável (cyrb53) de (tabId, mediaUrl), em hexadecimal. */
export function candidateId(tabId: number, mediaUrl: string): string {
  const text = `${String(tabId)}|${mediaUrl}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** Agregador em memória, por aba; o estado some quando a aba fecha (ou o service worker dorme). */
export function createCandidateStore(): CandidateStore {
  const byTab = new Map<number, VideoCandidate[]>();
  const byId = new Map<string, VideoCandidate>();

  function removeTab(tabId: number): void {
    for (const candidate of byTab.get(tabId) ?? []) {
      byId.delete(candidate.id);
    }
    byTab.delete(tabId);
  }

  return {
    replaceTab(tabId, candidates) {
      removeTab(tabId);
      byTab.set(tabId, [...candidates]);
      for (const candidate of candidates) {
        byId.set(candidate.id, candidate);
      }
    },
    forTab: (tabId) => [...(byTab.get(tabId) ?? [])],
    find: (candidateId) => byId.get(candidateId),
    update(candidate) {
      if (!byId.has(candidate.id)) {
        return;
      }
      byId.set(candidate.id, candidate);
      const list = byTab.get(candidate.tabId);
      const at = list?.findIndex((c) => c.id === candidate.id) ?? -1;
      if (list && at >= 0) {
        list[at] = candidate;
      }
    },
    removeTab,
  };
}
