@AGENTS.md

# Video Downloader — convenções do projeto

## Comandos

- `pnpm install` · `pnpm dev` · `pnpm build` (gera `.output/chrome-mv3-{public,local}`)
- `pnpm lint && pnpm format:check && pnpm typecheck` (gate de qualidade)
- `pnpm exec vitest run tests/tooling` (testes atuais; `pnpm test`/`arch` são stubs até a SPEC-0003)

## Convenções

- Commits: Conventional Commits `<type>(<scope>): <descrição>` (imperativo, minúsculo) com rodapé `Refs: SPEC-NNNN`.
- `CHANGELOG.md` segue Keep a Changelog; versões seguem SemVer.
- Mudanças entram na `main` só por PR (merge commit), nunca direto.
- Flavors: `public` (Chrome Web Store, somente detector genérico) e `local` (providers extras). Código de providers específicos de sites nunca entra no build `public` (ADR-0011).
- Nunca commitar segredos (`.env*`, `*.pem`, `*.crx`, tokens).
- Nunca implementar contorno de DRM ou de proteções de conteúdo.
- Dependências novas exigem ADR (ADR-0008); versões fixadas (sem `^`/`~`).
