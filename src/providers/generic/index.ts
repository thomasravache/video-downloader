import type { PageSnapshot, Provider, VideoCandidate } from '../../core/contracts';

/** Converte o retrato da página em candidatos (um por URL distinta, sem duplicar `currentSrc`). */
export function extractCandidates(_snapshot: PageSnapshot, _tabId: number): VideoCandidate[] {
  throw new Error('NotImplemented');
}

const provider: Provider = {
  id: 'generic',
  flavors: ['public', 'local'],
  matches: () => true,
  detect: () => {
    throw new Error('NotImplemented');
  },
};

export default provider;
