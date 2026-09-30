/**
 * `pnpm test:e2e [--flavor public|local]`: traduz --flavor para o projeto do Playwright
 * (sem flag roda ambos). Demais argumentos vão direto ao `playwright test`.
 */
import { spawnSync } from 'node:child_process';

// Sem imports locais: o Node executa este arquivo direto (type stripping).
const FLAVORS = ['public', 'local'];

const args = process.argv.slice(2);
const passthrough: string[] = [];
const chosen: string[] = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i] ?? '';
  if (arg === '--flavor') {
    chosen.push(args[++i] ?? '');
  } else if (arg.startsWith('--flavor=')) {
    chosen.push(arg.slice('--flavor='.length));
  } else {
    passthrough.push(arg);
  }
}
for (const flavor of chosen) {
  if (!FLAVORS.includes(flavor)) {
    console.error(`--flavor inválido: "${flavor}" (use public ou local)`);
    process.exit(2);
  }
}
const projects = chosen.flatMap((f) => ['--project', f]);
const r = spawnSync('playwright', ['test', ...projects, ...passthrough], {
  stdio: 'inherit',
  shell: false,
});
process.exit(r.status ?? 1);
