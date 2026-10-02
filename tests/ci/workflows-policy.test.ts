import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, codeLines, readWorkflow, workflowFiles } from './helpers';

const REQUIRED_WORKFLOWS = ['ci.yml', 'codeql.yml', 'sdd.yml'];
const SHA_REF = /^[0-9a-f]{40}$/;

describe('política dos workflows', () => {
  it('SPEC-0004:UT-01 os workflows esperados e o dependabot.yml existem', () => {
    const present = workflowFiles();
    for (const name of REQUIRED_WORKFLOWS) {
      expect(present, `.github/workflows/${name} ausente`).toContain(name);
    }
    expect(
      existsSync(join(ROOT, '.github', 'dependabot.yml')),
      '.github/dependabot.yml ausente',
    ).toBe(true);
  });

  it('SPEC-0004:UT-01 toda `uses:` remota está fixada por SHA de 40 caracteres', () => {
    const files = workflowFiles();
    expect(files.length, 'nenhum workflow em .github/workflows/').toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      for (const line of codeLines(readWorkflow(file))) {
        const m = /^\s*(?:-\s+)?uses:\s*(\S+)/.exec(line);
        if (!m) continue;
        const target = (m[1] ?? '').replace(/^['"]|['"]$/g, '');
        if (target.startsWith('./')) continue;
        const ref = target.split('@')[1] ?? '';
        if (!SHA_REF.test(ref)) offenders.push(`${file}: ${target}`);
      }
    }
    expect(offenders, `actions sem SHA de 40 hex: ${offenders.join(', ')}`).toEqual([]);
  });

  it('SPEC-0004:UT-01 nenhum workflow declara `permissions: write-all`', () => {
    const files = workflowFiles();
    expect(files.length, 'nenhum workflow em .github/workflows/').toBeGreaterThan(0);
    const offenders = files.filter((f) =>
      codeLines(readWorkflow(f)).some((l) =>
        /^\s*permissions:\s*['"]?write-all['"]?\s*(#.*)?$/.test(l),
      ),
    );
    expect(offenders, `write-all em: ${offenders.join(', ')}`).toEqual([]);
  });

  it('SPEC-0004:UT-01 ci.yml define os jobs quality, build, test, arch, e2e e security com matriz de flavor', () => {
    expect(workflowFiles(), 'ci.yml ausente').toContain('ci.yml');
    const text = readWorkflow('ci.yml');
    const lines = codeLines(text);

    const jobsIdx = lines.findIndex((l) => /^jobs:\s*$/.test(l));
    expect(jobsIdx, 'ci.yml sem seção `jobs:`').toBeGreaterThanOrEqual(0);

    // Seções de job: chaves com 2 espaços de indentação sob `jobs:`.
    const sections = new Map<string, string[]>();
    let current: string | undefined;
    for (const line of lines.slice(jobsIdx + 1)) {
      if (/^\S/.test(line)) break;
      const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
      if (m) {
        current = m[1];
        sections.set(current ?? '', []);
      } else if (current !== undefined) {
        sections.get(current)?.push(line);
      }
    }

    for (const job of ['quality', 'build', 'test', 'arch', 'e2e', 'security']) {
      expect(sections.has(job), `job \`${job}\` ausente em ci.yml`).toBe(true);
    }
    for (const job of ['build', 'e2e']) {
      const body = (sections.get(job) ?? []).join('\n');
      expect(body, `job ${job} sem matrix`).toMatch(/matrix:/);
      expect(body, `matrix de ${job} sem flavor`).toMatch(/flavor:/);
      expect(body, `matrix de ${job} sem public`).toMatch(/\bpublic\b/);
      expect(body, `matrix de ${job} sem local`).toMatch(/\blocal\b/);
    }
  });
});
