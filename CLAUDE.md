@AGENTS.md

# Video Downloader — convenções do projeto

## Comandos

- `pnpm install` · `pnpm dev` · `pnpm build` (gera `.output/chrome-mv3-{public,local}`)
- `pnpm lint && pnpm format:check && pnpm typecheck` (gate de qualidade)
- `pnpm test` · `pnpm test:integration` · `pnpm test:e2e [--flavor public|local]` · `pnpm arch` · `pnpm coverage`

## Convenções

- Commits: Conventional Commits `<type>(<scope>): <descrição>` (imperativo, minúsculo) com rodapé `Refs: SPEC-NNNN`.
- `CHANGELOG.md` segue Keep a Changelog; versões seguem SemVer.
- Mudanças entram na `main` só por PR (merge commit), nunca direto.
- Flavors: `public` (Chrome Web Store, somente detector genérico) e `local` (providers extras). Código de providers específicos de sites nunca entra no build `public` (ADR-0011).
- Nunca commitar segredos (`.env*`, `*.pem`, `*.crx`, tokens).
- Proteção de conteúdo (ADR-0015): o projeto descriptografa HLS `AES-128` com a chave entregue por URI à sessão do próprio usuário. DRM (Widevine, PlayReady, FairPlay, EME/`MediaKeys`, `SAMPLE-AES`/CENC) está fora de escopo. Chaves e tokens não são persistidos nem compartilhados.
- Dependências novas exigem ADR (ADR-0008); versões fixadas (sem `^`/`~`).
