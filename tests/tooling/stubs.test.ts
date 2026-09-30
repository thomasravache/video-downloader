import { describe, expect, it } from 'vitest';
import { run } from './helpers';

describe('scripts stub', () => {
  it('SPEC-0002:UT-03 pnpm test sai com código 1 citando SPEC-0003', () => {
    const r = run('pnpm', ['test']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('SPEC-0003');
  });
});
