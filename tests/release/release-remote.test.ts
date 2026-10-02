/**
 * SPEC-0006:IT-02 — exige o GitHub real (release.yml executado numa tag de teste); PULADO localmente.
 *
 * Como o Arquiteto executa no G5/G6 (com `gh` autenticado), depois de empurrar a tag de teste num
 * fork/branch de teste e de o workflow `release` passar pelos jobs até o `webstore`:
 *   SDD_REMOTE_RELEASE_TAG=v0.0.0-rc.1 \
 *   [SDD_REMOTE_RELEASE_REPO=<dono>/<repo do fork>]   # padrão: thomasravache/video-downloader \
 *   pnpm exec vitest run tests/release/release-remote.test.ts
 * Sem SDD_REMOTE_RELEASE_TAG os testes são pulados. Evidência do G5/G6: link da execução (`gh run view`).
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const TAG = process.env['SDD_REMOTE_RELEASE_TAG'];
const REPO = process.env['SDD_REMOTE_RELEASE_REPO'] ?? 'thomasravache/video-downloader';

function gh(args: string[]): unknown {
  const r = spawnSync('gh', args, { encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Error(`gh ${args.join(' ')} falhou: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

describe('SPEC-0006:IT-02 release remota', () => {
  it.skipIf(!TAG)('SPEC-0006:IT-02 Release é prerelease (rc) e traz os dois zips', () => {
    const version = (TAG ?? '').replace(/^v/, '');
    const rel = gh([
      'release',
      'view',
      TAG ?? '',
      '--repo',
      REPO,
      '--json',
      'assets,isPrerelease',
    ]) as {
      isPrerelease: boolean;
      assets: { name: string }[];
    };
    expect(rel.isPrerelease).toBe(/-rc\.\d+$/.test(version));
    const names = rel.assets.map((a) => a.name);
    expect(names).toContain(`extension-public-${version}.zip`);
    expect(names).toContain(`extension-local-${version}.zip`);
  });

  it.skipIf(!TAG)('SPEC-0006:IT-02 job webstore aguarda aprovação do environment', () => {
    const runs = gh([
      'run',
      'list',
      '--repo',
      REPO,
      '--workflow',
      'release.yml',
      '--limit',
      '30',
      '--json',
      'databaseId,headBranch,status,conclusion,url',
    ]) as { databaseId: number; headBranch: string; status: string; url: string }[];
    const run = runs.find((r) => r.headBranch === TAG);
    expect(run, `nenhuma execução de release.yml para ${TAG ?? ''}`).toBeDefined();

    const view = gh(['run', 'view', String(run?.databaseId), '--repo', REPO, '--json', 'jobs']) as {
      jobs: { name: string; status: string; conclusion: string }[];
    };
    const webstore = view.jobs.find((j) => j.name === 'webstore');
    expect(webstore, 'job webstore ausente').toBeDefined();
    expect(['waiting', 'pending']).toContain(webstore?.status);
    // Jobs anteriores concluídos com sucesso: nada pulado/falho antes da aprovação.
    for (const name of ['verify-version', 'build', 'flavor-guard', 'smoke', 'github-release']) {
      expect(view.jobs.find((j) => j.name === name)?.conclusion, name).toBe('success');
    }
  });
});
