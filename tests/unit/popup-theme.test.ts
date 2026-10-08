import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('tema dark do popup (UT-04)', () => {
  it('SPEC-0022:UT-04 style.css declara paleta dark com tokens da marca ClipDrop e variáveis acessíveis', () => {
    const cssPath = resolve(__dirname, '../../entrypoints/popup/style.css');
    const css = readFileSync(cssPath, 'utf-8');

    expect(css).toMatch(/color-scheme:\s*dark/i);
    expect(css).toMatch(/--bg:\s*#0f1117/i);
    expect(css).toMatch(/--surface:\s*#1a1d24/i);
    expect(css).toMatch(/--surface-hover:\s*#222732/i);
    expect(css).toMatch(/--border:\s*#262a34/i);
    expect(css).toMatch(/--fg:\s*#f8fafc/i);
    expect(css).toMatch(/--muted:\s*#94a3b8/i);
    expect(css).toMatch(/--accent:\s*#6366f1/i);
    expect(css).toMatch(/--accent-hover:\s*#4f46e5/i);
    expect(css).toMatch(/--accent-fg:\s*#ffffff/i);
    expect(css).toMatch(/--success:\s*#10b981/i);
    expect(css).toMatch(/--warn:\s*#f59e0b/i);
  });
});
