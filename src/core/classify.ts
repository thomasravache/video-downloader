import type { VideoCandidate } from './contracts';

export interface ClassifyInput {
  mediaUrl: string;
  hasMediaKeys: boolean;
  encrypted: boolean;
}

export type Classification = Pick<VideoCandidate, 'protection' | 'support'>;

export function classify(_input: ClassifyInput): Classification {
  throw new Error('NotImplemented');
}
