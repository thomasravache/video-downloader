import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupCandidates } from '../../src/core/candidates';
import type { VideoCandidate } from '../../src/core/contracts';

describe('caracterização de popup e seletores (CH-01)', () => {
  it('SPEC-0022:CH-01 (guarda: passa antes da mudança) preserva seletores do popup e integridade de candidatos', () => {
    const htmlPath = resolve(__dirname, '../../entrypoints/popup/index.html');
    const html = readFileSync(htmlPath, 'utf-8');

    expect(html).toContain('id="title"');
    expect(html).toContain('id="access"');
    expect(html).toContain('id="content"');
    expect(html).toContain('id="copy-diagnostics"');
    expect(html).toContain('data-testid="copy-diagnostics"');
    expect(html).toContain('id="footer-status"');

    const candidate: VideoCandidate = {
      id: 'c-1',
      providerId: 'generic',
      tabId: 1,
      pageUrl: 'https://site.example.test/aula',
      mediaUrl: 'https://cdn.example.test/aula.mp4',
      protection: 'none',
      support: 'downloadable',
      frameId: 0,
      frameUrl: '',
      kind: 'file',
      source: 'dom',
      title: 'Aula',
    };

    const groups = groupCandidates([candidate]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.primary.id).toBe('c-1');
  });
});
