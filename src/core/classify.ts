import type { VideoCandidate } from './contracts';

export interface ClassifyInput {
  mediaUrl: string;
  hasMediaKeys: boolean;
  encrypted: boolean;
}

export type Classification = Pick<VideoCandidate, 'protection' | 'support'>;

/**
 * DRM é apenas marcado: `mediaKeys` definido ou evento `encrypted` => `drm`.
 * Só URLs http(s) são baixáveis; `blob:` (MediaSource) e demais esquemas são streams não suportados.
 */
export function classify(input: ClassifyInput): Classification {
  return {
    protection: input.hasMediaKeys || input.encrypted ? 'drm' : 'none',
    support: /^https?:\/\//i.test(input.mediaUrl) ? 'downloadable' : 'unsupported-stream',
  };
}
