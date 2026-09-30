---
id: SPEC-0002
title: Repositório e tooling (WXT + TypeScript)
tier: full
type: foundation
user_facing: false
status: in-progress
created: 2026-09-30
parent: SPEC-0001
depends_on: []
consumes_contract: []
contract_version: 1
touches: [package.json, pnpm-lock.yaml, .npmrc, .nvmrc, tsconfig.json, wxt.config.ts, eslint.config.js, .prettierrc, .prettierignore, .editorconfig, .gitignore, LICENSE, README.md, CLAUDE.md, AGENTS.md, CHANGELOG.md, .githooks/**, tools/sdd/**, .github/pull_request_template.md, .github/CODEOWNERS, entrypoints/**, public/_locales/**, src/core/index.ts, tests/tooling/**]
adrs: [ADR-0010, ADR-0003, ADR-0005, ADR-0008]
external: []
size: S
approved_by: thomas
approved_at: 2026-09-30
---

# SPEC-0002 — Repositório e tooling (WXT + TypeScript)

## 1. Visão Geral
Cria o esqueleto do repositório: projeto WXT em TypeScript strict gerando uma extensão MV3 vazia que carrega no Chrome, nos modos `public` e `local`; lint, formatação e typecheck; convenções e enforcement SDD; repositório público no GitHub com licença MIT e ruleset da `main`.

## 2. Motivação & Escopo
**Motivação:** todas as outras specs precisam de um build reproduzível, comandos padronizados no `package.json` e da proteção da `main` antes de qualquer código de produto.

**Objetivos (dentro do escopo):**
- `pnpm` + Node LTS fixados (`.nvmrc`, `packageManager`); WXT, TypeScript strict, ESLint (typescript-eslint strict) e Prettier.
- `wxt.config.ts` com modos `public` e `local` expondo `import.meta.env.FLAVOR` e nome/versão do manifesto; entrypoints mínimos (background com `ping`, popup vazio com título i18n).
- `_locales/pt_BR` e `_locales/en` com `extName`/`extDescription`; `default_locale: pt_BR`.
- Scripts padronizados: `build`, `build:public`, `build:local`, `dev`, `lint`, `format:check`, `typecheck`, e stubs `test`, `test:integration`, `test:e2e`, `arch` (preenchidos por SPEC-0003) que falham com mensagem clara enquanto não existirem.
- `vendor --agents --pr-template github --hooks --changelog` (SDD), `LICENSE` MIT, README com como rodar/carregar a extensão.
- Repositório público no GitHub, ruleset da `main` (PR obrigatório, 1 revisão, sem force-push, merge commit) — checks obrigatórios adicionados por SPEC-0004.

**Não-objetivos (fora do escopo):**
- Testes de produto, CI e release (SPEC-0003, SPEC-0004, SPEC-0006).
- Qualquer lógica de detecção ou download (SPEC-0005).

## 3. Dependências
- **Implementações necessárias:** N/A
- **Contratos consumidos:** N/A
- **Pré-requisitos externos:** conta GitHub do Thomas com permissão para criar o repositório `thomasravache/video-downloader`; `gh` autenticado.

## 4. Decisão Arquitetural
**Contexto:** Projeto novo; padrão definido nos ADRs de fundação (ADR-0010 stack, ADR-0003 qualidade, ADR-0005 fluxo de mudança, ADR-0008 dependências).

**Decisão:** projeto WXT único na raiz (`entrypoints/`, `src/`, `public/`), `srcDir` padrão; modos WXT `public`/`local` como única forma de variar o build.

**Justificativa:** mantém o manifesto e as variantes em código versionado desde o primeiro commit, pré-requisito do ADR-0011.

**Desvio do padrão existente:** Nenhum.

**Alternativas descartadas:** monorepo com pacotes separados (`core`, `providers`) — complexidade desnecessária para um mantenedor; fronteiras garantidas por dependency-cruiser (ADR-0001).

**ADRs:** ADR-0010, ADR-0003, ADR-0005, ADR-0008.

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** N/A — só tooling.
- **Segurança:** nenhum segredo no repositório; `.gitignore` cobre `.env*`, `.output/`, `*.pem`, `*.crx` — verificado por IT-02.
- **Privacidade e dados pessoais:** N/A — sem dados.
- **Disponibilidade e resiliência:** N/A — sem runtime.
- **Acessibilidade (UI):** N/A — popup vazio; acessibilidade entra em SPEC-0005.
- **Custo:** N/A — GitHub gratuito para repositório público.

## 6. Artefato A — Contrato
**Interface:** `scripts do package.json` + `import.meta.env.FLAVOR` + `manifest.json gerado`

```text
Comandos (contrato consumido por SPEC-0003/0004/0006 e pelo sdd-config):
  pnpm build:public   → .output/chrome-mv3-public/  (manifest_version 3)
  pnpm build:local    → .output/chrome-mv3-local/
  pnpm build          → ambos
  pnpm lint | format:check | typecheck   → exit 0 limpo, ≠0 com achado
  pnpm test | test:integration | test:e2e | arch → stub: exit 1 "definido em SPEC-0003"

Ambiente de build:
  import.meta.env.FLAVOR: 'public' | 'local'   (modo inválido → build falha com mensagem)

manifest.json gerado:
  name: "__MSG_extName__", default_locale: "pt_BR", version: package.json#version
  local: name recebe sufixo " (local)" via _locales para distinguir na barra do Chrome
```

**Design:** N/A — sem interface.

**Arquivos/módulos afetados:** ver `touches` no frontmatter.

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| Build público | `pnpm build:public` | manifesto MV3 válido, FLAVOR=public, nome i18n | UT-01, IT-01 |
| Build local | `pnpm build:local` | manifesto MV3 válido, FLAVOR=local | UT-01, IT-01 |
| Modo inválido | `wxt build --mode foo` | build falha com "FLAVOR inválido" | UT-02 |
| Lint/tipos com erro | arquivo com `any` implícito | `lint`/`typecheck` exit ≠ 0 | IT-03 |
| Arquivos sensíveis | `.env`, `.output`, `*.pem` | ignorados pelo git | IT-02 |
| Stubs de teste | `pnpm test` antes de SPEC-0003 | exit 1 com mensagem clara | UT-03 |

## 7. Artefato B — Plano de Testes (TDD)
### 7.1 Testes de Caracterização
- N/A — projeto novo.

### 7.2 Testes Unitários
- **UT-01** — Dado o modo `public` ou `local`, quando a função de configuração do manifesto é chamada, então retorna `manifest_version: 3`, `default_locale: pt_BR` e o FLAVOR correspondente.
- **UT-02** — Dado um modo diferente de `public`/`local`, quando a configuração é resolvida, então lança erro "FLAVOR inválido".
- **UT-03** — Dado que SPEC-0003 não foi implementada, quando o script stub de teste roda, então sai com código 1 e mensagem citando SPEC-0003.

### 7.3 Testes de Integração
- **IT-01** — Rodando `pnpm build` de verdade, os dois diretórios de saída existem, o `manifest.json` de cada um é MV3 válido e `_locales/pt_BR` e `_locales/en` contêm `extName`.
- **IT-02** — Com `git check-ignore`, `.env`, `.env.local`, `.output/x`, `key.pem` e `a.crx` são ignorados.
- **IT-03** — Com um arquivo temporário contendo erro de tipo e de lint, `pnpm typecheck` e `pnpm lint` saem com código ≠ 0; sem ele, saem 0.

### 7.4 Testes de Contrato
- N/A — o contrato são os comandos do package.json, verificados por IT-01/IT-03; nenhuma spec consome contrato versionado desta.

### 7.5 Testes E2E
- N/A — user_facing: false.

### 7.6 Outros
- N/A

**Dublês e dados de teste:** N/A — ferramentas reais.

**Ambiente de execução:** local (Node LTS + pnpm); testes em `tests/tooling/` com Vitest mínimo instalado aqui (a config completa vem em SPEC-0003).

## 8. Plano de Rollout
- **Estratégia:** deploy direto (merge na `main`); nada é publicado.
- **Dados/schema:** N/A
- **Compatibilidade:** N/A
- **Observabilidade:** N/A — sem runtime.
- **Rollback:** revert do merge commit.
- **Etapas de migração/coexistência:** N/A

## 9. Questões em Aberto
- [x] Nome do repositório — `thomasravache/video-downloader`, público, MIT (Thomas, 2026-09-30)

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
<!-- Preenchido na fase PLAN. -->

**Fase 1: Configuração de build por flavor**
- [ ] Red: escrever UT-01, UT-02 com a tag `SPEC-0002:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 2: Scripts e stubs**
- [ ] Red: escrever UT-03, IT-01, IT-02, IT-03 com a tag `SPEC-0002:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 3: Repositório e enforcement (após G4, com confirmação do Thomas)**
- [ ] `vendor --agents --pr-template github --hooks --changelog`, LICENSE MIT, README
- [ ] Criar repositório público no GitHub e push (**só com autorização explícita**) e configurar o ruleset da `main`

**Fase final: Integração, entrega e documentação**
- [ ] Review independente (G4)
- [ ] Integração + CI verde (G5) e aprovação (H2)
- [ ] Deploy: N/A (nada publicado) — G6 = N/A apontando SPEC-0006
- [ ] Relatório de Entrega, docs raiz e CHANGELOG (G7)

## 12. Registro de Gates
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — ? | 2026-09-30 |
| G1 Red | PASS | verify G1: PASS; `pnpm exec vitest run tests/tooling` exit 1 (red: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[10/14]⎯) — afa083d | 2026-09-30 |
| G2 Green | PASS | build exit 0 (✔ Finished in 169 ms); test exit 0 (Duration  5.04s (tests 95%, import 3%, transform 1%)); lint exit 0 (✔ Finished in 158 ms) — d15a314 | 2026-09-30 |
| G3 Arquitetura | N/A | sem arch_test até SPEC-0003 (harness com dependency-cruiser); src/core é placeholder sem chrome.* | 2026-09-30 |
| G4 Review | PASS | verify G1+G4: PASS; revisão: reviewer-agent adc33f43: APPROVED @ d15a314 (6 minor, 0 blocker/major) — d15a314 | 2026-09-30 |
| G5 Integração & CI | PASS | build exit 0 (✔ Finished in 200 ms); test exit 0 (Duration  5.60s (tests 96%, import 3%, transform 1%)) — cfea88b | 2026-09-30 |
| H2 Integração aprovada | PASS | aprovado por thomas | 2026-09-30 |
| G6 Deploy | N/A | nada é publicado nesta spec; deploy/release entregues por SPEC-0006 | 2026-09-30 |
| G7 Pronto & Docs | PENDING | | |

## 13. Registro de Impedimentos
| ID | Aberto em | Fase/Gate | Tipo | Descrição | Tentativas | Responsável | Resolução | Fechado em |
|---|---|---|---|---|---|---|---|---|

## 14. Relatório de Entrega

### O que foi entregue
Esqueleto do repositório: projeto WXT em TypeScript strict que gera a extensão MV3 nos flavors `public` e `local` (`.output/chrome-mv3-{public,local}`), com i18n pt-BR/en, background respondendo `ping`, popup vazio com título traduzido, ESLint (typescript-eslint strict) + Prettier + typecheck, scripts padronizados (stubs de teste apontando SPEC-0003), licença MIT, README, CLAUDE.md, enforcement SDD vendorizado (`tools/sdd`, hooks em `.githooks`, template de PR, CODEOWNERS, CHANGELOG), repositório público `thomasravache/video-downloader` e ruleset da `main` (PR obrigatório, 1 revisão, merge commit, sem force-push, bypass de admin só via PR).

### Como foi feito
Ciclo TDD com três agentes distintos (Test-writer → Implementer → Reviewer). Desvios declarados e aceitos no G4: (1) o Vite 8 rejeita o nome de modo `local`; o flavor local é construído com `FLAVOR=local wxt build --mode flavor-local` e `FLAVOR` tem precedência (scripts com atribuição POSIX de ambiente, sem suporte a Windows); (2) TypeScript 6.0.3 em vez de 7.0.2 por causa da faixa de peer do typescript-eslint 8.71.0 (nota no ADR-0010); (3) `tests/tooling/` fora do Prettier e com 5 regras type-aware do ESLint desligadas, porque os testes red são imutáveis; arquivos vendorizados fora do Prettier. `@types/node` adicionado como tipo de desenvolvimento.

### Prova de Correção
N/A — type foundation.

### Verificação
| Teste | Comportamento | Resultado | Evidência |
|---|---|---|---|
| UT-01 | build por flavor devolve MV3/pt_BR/FLAVOR | PASS | vitest 14/14 passando em d15a314 (G2) e cfea88b (G5), `tests/tooling/flavor.test.ts` |
| UT-02 | modo inválido lança "FLAVOR inválido" | PASS | vitest 14/14 passando em d15a314 (G2) e cfea88b (G5), `tests/tooling/flavor.test.ts` |
| UT-03 | stub `pnpm test` sai 1 citando SPEC-0003 | PASS | vitest 14/14 passando em d15a314 (G2) e cfea88b (G5), `tests/tooling/stubs.test.ts` |
| IT-01 | `pnpm build` gera os dois outputs com locales | PASS | vitest 14/14 passando em d15a314 (G2) e cfea88b (G5), `tests/tooling/build.test.ts` |
| IT-02 | arquivos sensíveis ignorados pelo git | PASS | vitest 14/14 passando em d15a314 (G2) e cfea88b (G5), `tests/tooling/gitignore.test.ts` |
| IT-03 | typecheck/lint falham só com violação | PASS | vitest 14/14 passando em d15a314 (G2) e cfea88b (G5), `tests/tooling/lint-typecheck.test.ts` |

### Definição de Pronto
- [x] Todos os testes do plano passando e listados na Verificação
- [x] Todo comportamento do Mapa de Comportamentos coberto e verificado
- [x] Suíte completa, arquitetura e CI verdes no resultado integrado (G5) — suíte verde localmente em cfea88b; arquitetura e CI remoto N/A até SPEC-0003/SPEC-0004 (gates registrados como N/A/local)
- [x] Review independente sem achados blocker/major (G4)
- [x] Padrão arquitetural existente mantido, ou desvio coberto por ADR aprovado
- [x] Requisitos não-funcionais medidos com evidência (ou N/A justificado)
- [x] Disponível no ambiente-alvo via pipeline, com smoke/E2E passando no ambiente (G6) — N/A: nada é publicado nesta spec; release em SPEC-0006
- [x] Observabilidade e rollback prontos conforme o Plano de Rollout — N/A (sem runtime); rollback = revert do merge commit
- [x] Documentação raiz e CHANGELOG atualizados (G7)
- [x] Pendências registradas como novas specs (ou nenhuma)

### Deploy
N/A — nenhum artefato publicado. Repositório criado em https://github.com/thomasravache/video-downloader; ruleset `main-protection` ativo.

### Pendências
SPEC-0007 (lite): falha quando `FLAVOR` e o modo divergem e tipagem de `import.meta.env.FLAVOR`. Sem `!.env.example` no `.gitignore` (adicionar quando existir um `.env.example`). `buildManifest` ignora o parâmetro flavor até os flavors divergirem (SPEC-0005). Hooks do git não ativados (decisão do Thomas). Checks obrigatórios do ruleset entram com SPEC-0004.

## 15. Emendas
| Versão do contrato | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
