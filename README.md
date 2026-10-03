# Video Downloader

Extensão do Chrome (Manifest V3) que detecta e baixa vídeos das páginas visitadas (arquivos diretos e HLS).

> DRM (Widevine, PlayReady, FairPlay, EME) está fora de escopo. No build `local`, HLS com criptografia AES-128 é descriptografado com a chave entregue à sua própria sessão (ADR-0015); no build `public` esse tipo de vídeo aparece como protegido. Use apenas com conteúdo ao qual você tem acesso, para uso pessoal e offline, respeitando os termos da plataforma: a responsabilidade pelo uso é sua.

## Stack

TypeScript (strict) · [WXT](https://wxt.dev) · Vite · Vitest · ESLint + typescript-eslint · Prettier · pnpm.
Decisões em `docs/adr/`.

## Pré-requisitos

- Node.js LTS (veja `.nvmrc`; `engines: >=24`)
- pnpm 10 (`packageManager` no `package.json`; habilite com `corepack enable`)

## Como rodar

```sh
pnpm install
pnpm dev          # build local em modo watch, abre o Chrome com a extensão
pnpm build        # gera os dois flavors em .output/
```

### Carregar a extensão no Chrome

1. Rode `pnpm build`.
2. Abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha `.output/chrome-mv3-public` ou `.output/chrome-mv3-local`.

## Flavors: public vs local

| Flavor   | Saída                       | Conteúdo                                                                                        |
| -------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| `public` | `.output/chrome-mv3-public` | Versão da Chrome Web Store: apenas o detector genérico.                                         |
| `local`  | `.output/chrome-mv3-local`  | Uso pessoal: providers extras (plataformas de cursos, YouTube etc.). Nome com sufixo "(local)". |

O flavor é definido pela variável `FLAVOR` (`public` | `local`) e exposto como `import.meta.env.FLAVOR`.
(O Vite proíbe o nome de modo `local`, por isso os scripts usam `FLAVOR=... wxt --mode ...`.)

## Instalar o build local (sem Web Store)

1. Baixe `extension-local-<versão>.zip` em [Releases](https://github.com/thomasravache/video-downloader/releases) e descompacte.
2. Em `chrome://extensions`, ligue **Modo do desenvolvedor** e use **Carregar sem compactação** na pasta descompactada.
3. Abra uma página com um vídeo (MP4/WebM sem DRM) e clique no ícone da extensão.

## Limitações conhecidas

- DASH (`.mpd`) ainda não é suportado.
- HLS ao vivo não é suportado.
- Vídeos com DRM de verdade (Widevine, PlayReady, FairPlay) são identificados como protegidos e não são baixados.

## Scripts

| Script                                        | O que faz                                             |
| --------------------------------------------- | ----------------------------------------------------- |
| `pnpm dev`                                    | Desenvolvimento (flavor local) com recarga automática |
| `pnpm build` / `build:public` / `build:local` | Build de produção dos flavors                         |
| `pnpm lint`                                   | ESLint (typescript-eslint strict)                     |
| `pnpm format:check`                           | Prettier em modo verificação                          |
| `pnpm typecheck`                              | `tsc --noEmit` (strict)                               |
| `pnpm test`                                   | Testes unitários e de tooling (Vitest)                |
| `pnpm test:integration`                       | Testes de integração (Vitest + fake do browser)       |
| `pnpm test:e2e [--flavor public\|local]`      | E2E com a extensão carregada (Playwright)             |
| `pnpm arch`                                   | Regras de arquitetura (dependency-cruiser)            |
| `pnpm coverage`                               | Cobertura (Vitest + lcov)                             |

A CI (GitHub Actions) roda qualidade, build dos dois flavors, testes, arquitetura, E2E, varredura de segredos e CodeQL em todo PR.

## Fluxo de trabalho (SDD)

O projeto segue Spec-Driven Development: specs em `docs/specs/`, decisões em `docs/adr/`, mudanças por PR com Conventional Commits e `Refs: SPEC-NNNN`. Veja `CLAUDE.md` e `AGENTS.md`.

## Licença

[MIT](LICENSE) © 2026 Thomas Ravache
