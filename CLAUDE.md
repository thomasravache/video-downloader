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
- DRM de verdade (Widevine, PlayReady, FairPlay, EME/`MediaKeys`, `SAMPLE-AES`/CENC) nunca é contornado. Única exceção (ADR-0015): HLS `METHOD=AES-128` com a chave entregue por URI ao player da própria sessão do usuário, só no flavor `local` e nunca no `public`. Sem extrair chaves por outros meios, sem forjar ou reaproveitar tokens, sem persistir ou compartilhar chaves e tokens.
- Dependências novas exigem ADR (ADR-0008); versões fixadas (sem `^`/`~`).
