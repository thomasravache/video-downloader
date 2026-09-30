/**
 * SPEC-0004:IT-01 — exige o repositório real no GitHub; é PULADO localmente.
 *
 * Como o Arquiteto executa no G5 (com `gh` autenticado), depois que os checks terminarem
 * (`gh pr checks <n> --repo thomasravache/video-downloader --watch`):
 *   SDD_REMOTE_PR=<n° do PR verde> \
 *   SDD_REMOTE_PR_FAILING=<n° do PR com teste unitário quebrado> \
 *   pnpm exec vitest run tests/ci/remote-checks.test.ts
 * Sem SDD_REMOTE_PR o teste é pulado; sem SDD_REMOTE_PR_FAILING só o caso do PR verde roda.
 *
 * Nomes: `gh pr checks --json name,state,workflow` devolve `name` (job) e `workflow` separados;
 * o nome do contrato é `${workflow} / ${name}`. Entradas legadas com `workflow` vazio
 * (ex.: "CodeQL" do default setup) são ignoradas.
 */
import { describe, expect, it } from 'vitest';
import { run } from './helpers';

const REPO = 'thomasravache/video-downloader';
const REQUIRED_CHECKS = [
  'ci / quality',
  'ci / build (public)',
  'ci / build (local)',
  'ci / test',
  'ci / arch',
  'ci / e2e (public)',
  'ci / e2e (local)',
  'ci / security',
  'codeql / analyze',
  'sdd / sdd',
];

interface Check {
  name: string;
  workflow: string;
  state: string;
  /** Nome renderizado do contrato: `${workflow} / ${name}`. */
  full: string;
}

function prChecks(pr: string): Check[] {
  const r = run('gh', ['pr', 'checks', pr, '--repo', REPO, '--json', 'name,state,workflow']);
  // `gh pr checks` sai com 8 quando há checks pendentes e com 1 quando algum falhou; o JSON vem mesmo assim.
  expect(r.error, 'gh não executou').toBeUndefined();
  const stdout = r.out.trim();
  const raw = JSON.parse(stdout.slice(stdout.indexOf('['), stdout.lastIndexOf(']') + 1)) as Omit<
    Check,
    'full'
  >[];
  return raw
    .filter((c) => c.workflow !== '')
    .map((c) => ({ ...c, full: `${c.workflow} / ${c.name}` }));
}

describe('checks obrigatórios no PR real', () => {
  const pr = process.env['SDD_REMOTE_PR'];
  const failingPr = process.env['SDD_REMOTE_PR_FAILING'];

  it.skipIf(!pr)('SPEC-0004:IT-01 PR verde tem todos os checks do contrato', () => {
    const checks = prChecks(pr ?? '');
    const names = checks.map((c) => c.full);
    for (const required of REQUIRED_CHECKS) {
      expect(names, `check obrigatório ausente: ${required}`).toContain(required);
    }
    const notGreen = checks.filter(
      (c) => REQUIRED_CHECKS.includes(c.full) && c.state !== 'SUCCESS',
    );
    expect(notGreen, 'checks do PR verde não estão SUCCESS').toEqual([]);
  });

  it.skipIf(!pr || !failingPr)(
    'SPEC-0004:IT-01 PR com teste quebrado: `ci / test` falha e o PR não é mergeável',
    () => {
      const number = failingPr ?? '';
      const checks = prChecks(number);
      const test = checks.find((c) => c.full === 'ci / test');
      expect(test?.state, '`ci / test` deveria estar em FAILURE').toBe('FAILURE');

      const v = run('gh', ['pr', 'view', number, '--repo', REPO, '--json', 'mergeStateStatus']);
      const { mergeStateStatus } = JSON.parse(v.out.trim().slice(v.out.indexOf('{'))) as {
        mergeStateStatus: string;
      };
      // BLOCKED é o esperado: o ruleset da `main` exige `ci / test` e ele falhou. BEHIND/DIRTY
      // também impedem o merge (branch desatualizada / conflito); CLEAN ou UNSTABLE/HAS_HOOKS
      // significariam que o merge passaria apesar do teste vermelho.
      expect(['BLOCKED', 'BEHIND', 'DIRTY']).toContain(mergeStateStatus);
    },
  );
});
