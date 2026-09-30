# Video Downloader

Extensão do Chrome (Manifest V3) que detecta e baixa vídeos **sem DRM** das páginas visitadas.

> Esta extensão **nunca** contorna DRM nem proteções de conteúdo. Vídeos protegidos não são suportados e isso não vai mudar.

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

## Scripts

| Script                                                 | O que faz                                             |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `pnpm dev`                                             | Desenvolvimento (flavor local) com recarga automática |
| `pnpm build` / `build:public` / `build:local`          | Build de produção dos flavors                         |
| `pnpm lint`                                            | ESLint (typescript-eslint strict)                     |
| `pnpm format:check`                                    | Prettier em modo verificação                          |
| `pnpm typecheck`                                       | `tsc --noEmit` (strict)                               |
| `pnpm test` / `test:integration` / `test:e2e` / `arch` | Stubs que falham até a SPEC-0003                      |

Testes de tooling: `pnpm exec vitest run tests/tooling`.

## Fluxo de trabalho (SDD)

O projeto segue Spec-Driven Development: specs em `docs/specs/`, decisões em `docs/adr/`, mudanças por PR com Conventional Commits e `Refs: SPEC-NNNN`. Veja `CLAUDE.md` e `AGENTS.md`.

## Licença

[MIT](LICENSE) © 2026 Thomas Ravache
