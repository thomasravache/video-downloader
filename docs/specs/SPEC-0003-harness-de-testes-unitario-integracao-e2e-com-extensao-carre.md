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
touches: [package.json, pnpm-lock.yaml, tests/tooling/stubs.test.ts, vitest.config.ts, vitest.workspace.ts, playwright.config.ts, .dependency-cruiser.cjs, tests/support/**, tests/harness/**, e2e/support/**, e2e/fixtures/**, e2e/harness.spec.ts]
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
- **Desempenho e escala:** suíte unitária < 10 s e E2E-exemplo < 60 s localmente — medido pela saída dos runners.
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
| E2E com extensão carregada | `pnpm test:e2e` | service worker responde `ping`; popup abre | IT-03 |
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
- **IT-03** — Com a extensão `public` carregada em Chromium, `serviceWorker.evaluate` responde ao `ping` e `openPopup()` renderiza o título i18n.
- **IT-04** — Com arquivos temporários violando cada regra do ADR-0001 (core→providers, provider→provider, popup→providers, core→`chrome`, ciclo), `pnpm arch` falha citando a regra; sem eles, passa.

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
- [ ] Red: escrever UT-01, IT-01 com a tag `SPEC-0003:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 2: Regras de arquitetura**
- [ ] Red: escrever IT-04 com a tag `SPEC-0003:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 3: Fixture E2E com extensão carregada**
- [ ] Red: escrever IT-02, IT-03 com a tag `SPEC-0003:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase final: Integração, entrega e documentação**
- [ ] Review independente (G4)
- [ ] Integração + CI verde (G5) e aprovação (H2)
- [ ] Deploy: N/A — G6 = N/A apontando SPEC-0006
- [ ] Relatório de Entrega, docs raiz e CHANGELOG (G7)

## 12. Registro de Gates
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — ? | 2026-09-30 |
| G1 Red | PENDING | | |
| G2 Green | PENDING | | |
| G3 Arquitetura | PENDING | | |
| G4 Review | PENDING | | |
| G5 Integração & CI | PENDING | | |
| H2 Integração aprovada | PENDING | | |
| G6 Deploy | PENDING | | |
| G7 Pronto & Docs | PENDING | | |

## 13. Registro de Impedimentos
| ID | Aberto em | Fase/Gate | Tipo | Descrição | Tentativas | Responsável | Resolução | Fechado em |
|---|---|---|---|---|---|---|---|---|

## 14. Relatório de Entrega

### O que foi entregue

### Como foi feito

### Prova de Correção

### Verificação
| Teste | Comportamento | Resultado | Evidência |
|---|---|---|---|

### Definição de Pronto
- [ ] Todos os testes do plano passando e listados na Verificação
- [ ] Todo comportamento do Mapa de Comportamentos coberto e verificado
- [ ] Suíte completa, arquitetura e CI verdes no resultado integrado (G5)
- [ ] Review independente sem achados blocker/major (G4)
- [ ] Padrão arquitetural existente mantido, ou desvio coberto por ADR aprovado
- [ ] Requisitos não-funcionais medidos com evidência (ou N/A justificado)
- [ ] Disponível no ambiente-alvo via pipeline, com smoke/E2E passando no ambiente (G6)
- [ ] Observabilidade e rollback prontos conforme o Plano de Rollout
- [ ] Documentação raiz e CHANGELOG atualizados (G7)
- [ ] Pendências registradas como novas specs (ou nenhuma)

### Deploy

### Pendências

## 15. Emendas
| Versão do contrato | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
| 1 (escopo) | 2026-09-30 | `touches` inclui `tests/tooling/stubs.test.ts`; objetivo de remover o stub test da SPEC-0002 | implementar `pnpm test` invalida o UT-03 da SPEC-0002 (stub) — sem isso a suíte quebra | SPEC-0002 (UT-03 aposentado; Verificação histórica preservada) | pendente de ratificação do Thomas no H2 da onda 2 |
