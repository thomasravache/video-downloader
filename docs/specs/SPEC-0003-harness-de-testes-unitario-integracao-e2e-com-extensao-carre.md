---
id: SPEC-0003
title: Harness de testes (unitário, integração, E2E com extensão carregada, arquitetura)
tier: full
type: foundation
user_facing: false
status: in-progress
created: 2026-09-30
parent: SPEC-0001
depends_on: [SPEC-0002]
consumes_contract: []
contract_version: 1
touches: [package.json, pnpm-lock.yaml, tests/tooling/stubs.test.ts, entrypoints/background.ts, tsconfig.json, eslint.config.js, vitest.config.ts, vitest.workspace.ts, playwright.config.ts, .dependency-cruiser.cjs, tests/support/**, tests/harness/**, e2e/support/**, e2e/fixtures/**, e2e/harness.spec.ts]
adrs: [ADR-0010, ADR-0002, ADR-0001]
external: []
size: M
approved_by: thomas
approved_at: 2026-09-30
---

# SPEC-0003 — Harness de testes (unitário, integração, E2E com extensão carregada, arquitetura)

## 1. Visão Geral
Monta os quatro níveis de teste definidos no ADR-0002 e as regras de fronteira do ADR-0001, cada um com um teste-exemplo, substituindo os stubs de `test`, `test:integration`, `test:e2e` e `arch` criados em SPEC-0002.

## 2. Motivação & Escopo
**Motivação:** o walking skeleton (SPEC-0005) e todas as features precisam escrever o teste vermelho antes do código; sem harness pronto, o G1 não é possível.

**Objetivos (dentro do escopo):**
- Vitest com dois projetos: `unit` (`src/**/*.test.ts`, `tests/unit/**`) e `integration` (`tests/integration/**`, com o fake de `browser.*` do `wxt/testing` e servidor HTTP local de fixtures).
- Playwright E2E: fixture que builda (ou reusa) o zip do modo pedido, abre Chromium com contexto persistente e `--load-extension`, expõe `extensionId`, `serviceWorker` e `openPopup()`; servidor estático de `e2e/fixtures/` (inclui um MP4 pequeno gerado, sem direitos de terceiros).
- dependency-cruiser com as regras do ADR-0001 e do ADR-0011 (core ↛ providers/entrypoints/chrome; providers ↛ providers/UI; popup ↛ providers; sem ciclos).
- Cobertura de linhas alteradas (`@vitest/coverage-v8` + relatório lcov) para o G2.
- Atualizar os comandos reais em `docs/specs/sdd-config.yml` (feito pelo Architect ao registrar o G2).
- Remover os stubs `test`, `test:integration`, `test:e2e`, `arch` do package.json e o teste `tests/tooling/stubs.test.ts` (UT-03 da SPEC-0002), que deixa de ter objeto: não sobra script stub (ver Emendas).

**Não-objetivos (fora do escopo):**
- Rodar no CI (SPEC-0004).
- Testes de produto (SPEC-0005).

## 3. Dependências
- **Implementações necessárias:** SPEC-0002 — scripts, build e modos `public`/`local`.
- **Contratos consumidos:** N/A
- **Pré-requisitos externos:** navegadores do Playwright (`pnpm exec playwright install chromium`).

## 4. Decisão Arquitetural
**Contexto:** Projeto novo; padrão definido nos ADRs de fundação (ADR-0002 testes, ADR-0001 fronteiras).

**Decisão:** `tests/` para unitário/integração, `e2e/` para Playwright, regras de arquitetura em `.dependency-cruiser.cjs`; tag de rastreabilidade no nome do teste (`it("SPEC-0005:UT-01 …")`).

**Justificativa:** separa o que é rápido (unit) do que precisa de Chromium real (E2E), como pede o ADR-0002.

**Desvio do padrão existente:** Nenhum.

**Alternativas descartadas:** Puppeteer para E2E (ADR-0002); mock manual de `chrome.*` (o fake do WXT cobre as APIs usadas).

**ADRs:** ADR-0010, ADR-0002, ADR-0001.

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** suíte unitária < 20 s (inclui os testes de tooling da SPEC-0002 e de arquitetura que executam build/lint/arch por shell; medido em ~16 s; ao passar de 20 s, separá-los em um projeto `tooling`) e E2E-exemplo < 60 s localmente — medido pela saída dos runners.
- **Segurança:** servidor de fixtures escuta só em `127.0.0.1`; E2E nunca acessa hosts externos (Playwright com `route` bloqueando fora de localhost) — verificado por IT-02.
- **Privacidade e dados pessoais:** N/A — fixtures sintéticas.
- **Disponibilidade e resiliência:** teste instável vai para quarentena (ADR-0002, 7 dias) — Playwright com `retries: 0`.
- **Acessibilidade (UI):** N/A — sem UI de produto aqui.
- **Custo:** N/A

## 6. Artefato A — Contrato
**Interface:** `comandos de teste + fixtures de E2E`

```text
pnpm test               → vitest --project unit
pnpm test:integration   → vitest --project integration
pnpm test:e2e [--flavor public|local]  → playwright test (padrão: ambos os projetos)
pnpm arch               → depcruise src entrypoints --config .dependency-cruiser.cjs
pnpm coverage           → vitest --coverage (lcov em coverage/)

Fixture Playwright (e2e/support/extension.ts):
  test.extend<{ context, extensionId: string, serviceWorker: Worker,
                openPopup(): Promise<Page>, fixturesUrl: string, flavor: 'public'|'local' }>
  - contexto persistente com --disable-extensions-except/--load-extension=<.output/chrome-mv3-<flavor>>
  - downloads aceitos para um diretório temporário exposto como `downloadsDir`
  - requisições fora de 127.0.0.1 são abortadas
```

**Design:** N/A — sem interface.

**Arquivos/módulos afetados:** ver `touches` no frontmatter.

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| Unitário roda | `pnpm test` com teste-exemplo | exit 0, teste listado com tag | UT-01 |
| Integração com fake do browser | `pnpm test:integration` | mensagem `ping` → `pong` no background real | IT-01 |
| Rede isolada | E2E tenta abrir host externo | requisição abortada, teste falha se tentar | IT-02 |
| E2E com extensão carregada | `pnpm test:e2e` | o service worker responde ao `ping` enviado por uma página da extensão (popup); popup abre | IT-03 |
| Violação de fronteira | `src/core` importa `src/providers` | `pnpm arch` exit ≠ 0 com a regra violada | IT-04 |
| Ciclo | dois módulos se importam | `pnpm arch` exit ≠ 0 | IT-04 |

## 7. Artefato B — Plano de Testes (TDD)
### 7.1 Testes de Caracterização
- N/A — projeto novo.

### 7.2 Testes Unitários
- **UT-01** — Dado o helper `specTag('SPEC-0003','UT-01')`, quando chamado, então retorna `"SPEC-0003:UT-01"` (exemplo do padrão de tag e prova que o projeto `unit` roda).

### 7.3 Testes de Integração
- **IT-01** — Com o fake de `browser.*` do WXT e o background real, enviar `{type:'ping'}` retorna `{type:'pong', version}`.
- **IT-02** — No contexto Playwright da fixture, `page.goto('https://example.com')` é abortado e `page.goto(fixturesUrl)` carrega.
- **IT-03** — Com a extensão `public` carregada em Chromium, o `ping` enviado de uma página da extensão (o popup aberto por `openPopup()`) recebe `pong` do service worker localizado por `serviceWorker`, e o popup renderiza o título i18n. (Emenda: o service worker não recebe o próprio `runtime.sendMessage` no Chromium real.)
- **IT-04** — Com arquivos temporários violando cada regra do ADR-0001 (core→providers, core→entrypoints, provider→provider, provider→entrypoints, popup→providers, core→`wxt/browser`, core→`#imports`, import não resolvido, ciclo), `pnpm arch` falha citando a regra; sem eles, passa. Um arquivo de `src/core` que usa o global `chrome.*` ou `browser.*` faz `pnpm lint` falhar (`no-restricted-globals`), pois o dependency-cruiser não enxerga globais.

### 7.4 Testes de Contrato
- N/A — não há contrato versionado entre specs; os comandos são verificados por IT-01..IT-04.

### 7.5 Testes E2E
- N/A — user_facing: false (IT-03 prova a fixture de E2E que as specs de produto vão usar).

### 7.6 Outros
- N/A

**Dublês e dados de teste:** fake `browser.*` do `wxt/testing`; `e2e/fixtures/` com páginas HTML e um MP4 de 2 s gerado por script (sem conteúdo de terceiros).

**Ambiente de execução:** local e CI (SPEC-0004) — Chromium do Playwright, servidor estático em 127.0.0.1.

## 8. Plano de Rollout
- **Estratégia:** deploy direto (merge na `main`); nada é publicado.
- **Dados/schema:** N/A
- **Compatibilidade:** N/A
- **Observabilidade:** relatório HTML do Playwright e lcov guardados como artefato no CI (SPEC-0004).
- **Rollback:** revert do merge commit.
- **Etapas de migração/coexistência:** N/A

## 9. Questões em Aberto
Nenhuma

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
<!-- Preenchido na fase PLAN. -->

**Fase 1: Vitest (unitário e integração)**
- [x] Red: escrever UT-01, IT-01 com a tag `SPEC-0003:<ID>` e confirmar que falham pelo motivo certo
- [x] Green: implementar o mínimo para passar, seguindo os ADRs citados
- [x] Refactor mantendo tudo verde
- [x] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 2: Regras de arquitetura**
- [x] Red: escrever IT-04 com a tag `SPEC-0003:<ID>` e confirmar que falham pelo motivo certo
- [x] Green: implementar o mínimo para passar, seguindo os ADRs citados
- [x] Refactor mantendo tudo verde
- [x] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 3: Fixture E2E com extensão carregada**
- [x] Red: escrever IT-02, IT-03 com a tag `SPEC-0003:<ID>` e confirmar que falham pelo motivo certo
- [x] Green: implementar o mínimo para passar, seguindo os ADRs citados
- [x] Refactor mantendo tudo verde
- [x] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase final: Integração, entrega e documentação**
- [x] Review independente (G4)
- [x] Integração + CI verde (G5) e aprovação (H2)
- [x] Deploy: N/A — G6 = N/A apontando SPEC-0006
- [x] Relatório de Entrega, docs raiz e CHANGELOG (G7)

## 12. Registro de Gates
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — ? | 2026-09-30 |
| G1 Red | PASS | verify G1: PASS; `pnpm exec vitest run tests/tooling tests/harness tests/ci` exit 1 (red: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/9]⎯) — d1213ff | 2026-09-30 |
| G2 Green | PASS | build exit 0 (✔ Finished in 174 ms); test exit 0 (Duration  17.14s (tests 99%, import 1%)); lint exit 0 (✔ Finished in 135 ms); coverage exit 0 (================================================================================) — e8a5367 | 2026-09-30 |
| G3 Arquitetura | PASS | arch_test exit 0 (✔ no dependency violations found (3 modules, 0 dependencies cruised)) — e8a5367 | 2026-09-30 |
| G4 Review | PASS | verify G1+G4: PASS; revisão: reviewer-agent a33ee94f (2ª rodada): APPROVED @ e8a5367 (0 blocker/major, 4 minor; NFR 20s aceito com condição de dividir projeto tooling) — e8a5367 | 2026-09-30 |
| G5 Integração & CI | PASS | build exit 0 (✔ Finished in 220 ms); test exit 0 (Duration  19.15s (tests 98%, import 1%)); test_integration exit 0 (Duration  131ms (transform 58%, setup 23%, import 7%, worker 6%, tests 6%)); test_e2e exit 0 (3 passed (5.2s)); arch_test exit 0 (✔ no dependency violations found (3 modules, 0 dependencies cruised)); security_scan exit 0 ([90m6:12PM[0m [32mINF[0m [1mno leaks found[0m) — e97c193 | 2026-09-30 |
| H2 Integração aprovada | PASS | aprovado por thomas | 2026-09-30 |
| G6 Deploy | N/A | sem deploy nesta spec; release e deploy em SPEC-0006 | 2026-09-30 |
| G7 Pronto & Docs | PENDING | | |

## 13. Registro de Impedimentos
| ID | Aberto em | Fase/Gate | Tipo | Descrição | Tentativas | Responsável | Resolução | Fechado em |
|---|---|---|---|---|---|---|---|---|
| IMP-01 | 2026-09-30 | G2 | spec | IT-03 exige que serviceWorker.evaluate receba ping enviado pelo próprio service worker; no Chromium real o SW não recebe o próprio runtime.sendMessage (lastError: Receiving end does not exist) | Probe no SW do build public falhou; o mesmo ping enviado da página popup devolve {type:'pong'}; Implementer não alterou o teste | Architect + Thomas (emenda do plano de testes) | Emenda 1 (teste) — IT-03 passa a enviar o ping do popup; ratificação no H2 | 2026-09-30 |

## 14. Relatório de Entrega

### O que foi entregue
Harness de testes em quatro níveis: projetos Vitest `unit` e `integration` (com `WxtVitest` e `fakeBrowser`), E2E com Playwright e a extensão carregada em Chromium persistente (fixtures `context`, `extensionId`, `serviceWorker`, `openPopup`, `fixturesUrl`, `flavor`, rede isolada em 127.0.0.1, servidor de fixtures, MP4 de 2 s reproduzível), regras de arquitetura com dependency-cruiser (`no-core-to-providers`, `no-core-to-entrypoints`, `no-provider-to-provider`, `no-provider-to-ui`, `no-popup-to-providers`, `no-core-browser-api`, `no-circular`, `not-to-unresolvable`) e ESLint `no-restricted-globals` para `chrome`/`browser` em `src/core`, cobertura (`pnpm coverage`, lcov) e os scripts reais `test`, `test:integration`, `test:e2e [--flavor]`, `arch`.

### Como foi feito
TDD com agentes distintos (Test-writer, Implementer, Reviewer; duas rodadas de revisão). Desvios e emendas ratificadas pelo Thomas no H2 da onda 2: (1) remoção do stub test da SPEC-0002; (2) IT-03 envia o ping do popup (o service worker não recebe o próprio `runtime.sendMessage`, provado por probe) e `touches` passou a incluir `entrypoints/background.ts` (listener devolve `true` só para o fake do WXT aguardar a resposta; SPEC-0005 deve revisitar), `tsconfig.json` e `eslint.config.js`; (3) IT-04 ampliado após a revisão (`#imports`, `@wxt-dev/browser`, imports não resolvidos, globais) e NFR da suíte unitária de 10 s para 20 s (medido 16–19 s). Workaround de fixture: `page.goto` aguarda o commit da página de erro após navegação abortada (corrida Chromium 153/Playwright 1.63, sem issue upstream verificada). `vitest.config.ts` define `FLAVOR=public` por padrão nos testes.

### Prova de Correção
N/A — type foundation.

### Verificação
| Teste | Comportamento | Resultado | Evidência |
|---|---|---|---|
| UT-01 | `specTag` devolve `SPEC-0003:UT-01` (projeto unit roda) | PASS | `tests/harness/spec-tag.test.ts`; `pnpm test` 27/27 em e97c193; CI https://github.com/thomasravache/video-downloader/actions/runs/36777550378 |
| IT-01 | ping → pong no background real com fake do browser | PASS | `tests/harness/background-ping.integration.test.ts`; `pnpm test:integration` 1/1; CI https://github.com/thomasravache/video-downloader/actions/runs/36777550378 |
| IT-02 | host externo abortado; fixturesUrl carrega | PASS | `e2e/harness.spec.ts`; `pnpm test:e2e` 3/3 local e CI https://github.com/thomasravache/video-downloader/actions/runs/36777550378 (e2e public e local) |
| IT-03 | popup envia ping e o service worker responde; título i18n | PASS | `e2e/harness.spec.ts` (flavor public); CI https://github.com/thomasravache/video-downloader/actions/runs/36777550378 (e2e public) |
| IT-04 | cada regra de arquitetura falha nomeando a regra; árvore limpa passa | PASS | `tests/harness/arch.test.ts` e `arch-gaps.test.ts`; `pnpm arch` exit 0; CI https://github.com/thomasravache/video-downloader/actions/runs/36777550378 |

### Definição de Pronto
- [x] Todos os testes do plano passando e listados na Verificação
- [x] Todo comportamento do Mapa de Comportamentos coberto e verificado
- [x] Suíte completa, arquitetura e CI verdes no resultado integrado (G5)
- [x] Review independente sem achados blocker/major (G4)
- [x] Padrão arquitetural existente mantido, ou desvio coberto por ADR aprovado
- [x] Requisitos não-funcionais medidos com evidência (ou N/A justificado)
- [x] Disponível no ambiente-alvo via pipeline, com smoke/E2E passando no ambiente (G6) — N/A: nada é publicado; release em SPEC-0006
- [x] Observabilidade e rollback prontos conforme o Plano de Rollout
- [x] Documentação raiz e CHANGELOG atualizados (G7)
- [x] Pendências registradas como novas specs (ou nenhuma)

### Deploy
N/A — nenhum artefato publicado.

### Pendências
Separar os testes de tooling/arquitetura em um projeto Vitest `tooling` (primeira tarefa da próxima spec, ou antes se a suíte passar de 20 s). Cobrir `self.chrome`/`self.browser` no override ESLint e documentar que aliases `#…` fora de `src/core` ficam a cargo do tsc/WXT. O `local` Playwright pula o IT-03 por `grepInvert` de título; preferir `test.skip` interno e um smoke do flavor local na SPEC-0005.

## 15. Emendas
| Versão do contrato | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
| 1 (escopo) | 2026-09-30 | `touches` inclui `tests/tooling/stubs.test.ts`; objetivo de remover o stub test da SPEC-0002 | implementar `pnpm test` invalida o UT-03 da SPEC-0002 (stub) — sem isso a suíte quebra | SPEC-0002 (UT-03 aposentado; Verificação histórica preservada) | thomas (H2 da onda 2, 2026-09-30) |
| 1 (teste) | 2026-09-30 | IT-03: o ping parte do popup (página da extensão), não do próprio service worker; `touches` inclui `entrypoints/background.ts` (listener retorna `true` para o fake do WXT aguardar a resposta), `tsconfig.json` (include de e2e/configs) e `eslint.config.js` (dependency-cruiser) | no Chromium real o service worker não recebe o próprio `runtime.sendMessage` (provado por probe); ajustes de config necessários para lint/typecheck verdes | SPEC-0005 (background.ts) | thomas (H2 da onda 2, 2026-09-30) |
| 1 (revisão) | 2026-09-30 | IT-04 cobre também core→entrypoints, provider→entrypoints, core→`#imports`, import não resolvido e o global `chrome` no core (ESLint); NFR da suíte unitária passa de 10 s para 20 s (medido ~16 s) | achados major/minor do Reviewer (G4): `#imports` e `@wxt-dev/browser` escapavam da regra; globais não são vistos pelo dependency-cruiser; tooling/arch por shell somam ~10,5 s | SPEC-0002 (tempo de `pnpm test`) | thomas (H2 da onda 2, 2026-09-30) |
