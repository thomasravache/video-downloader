import { describe, expect, it } from 'vitest';
import { WORKFLOWS_DIR, run, workflowFiles } from './helpers';

describe('actionlint', () => {
  it('SPEC-0004:IT-03 actionlint sobre .github/workflows/ sai com 0 e há ao menos um workflow', () => {
    const files = workflowFiles();
    expect(files.length, 'nenhum workflow em .github/workflows/').toBeGreaterThan(0);
    const r = run('actionlint', ['-color=false', ...files.map((f) => `${WORKFLOWS_DIR}/${f}`)]);
    expect(r.error, 'actionlint não executou').toBeUndefined();
    expect(r.code, r.out).toBe(0);
  });
});
