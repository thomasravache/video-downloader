---
id: SPEC-0004
title: Pipeline de CI no GitHub Actions
tier: full
type: foundation
user_facing: false
status: in-progress
created: 2026-09-30
parent: SPEC-0001
depends_on: [SPEC-0002]
consumes_contract: []
contract_version: 1
touches: [.github/workflows/ci.yml, .github/workflows/codeql.yml, .github/workflows/sdd.yml, .github/dependabot.yml, .gitleaks.toml, tests/ci/**]
adrs: [ADR-0010, ADR-0004, ADR-0005, ADR-0006, ADR-0008]
external: []
size: S
approved_by: thomas
approved_at: 2026-09-30
---

# SPEC-0004 — Pipeline de CI no GitHub Actions

## 1. Visão Geral
Todo push e PR roda, no GitHub Actions: instalação com lockfile congelado, `format:check`, `lint`, `typecheck`, build dos modos `public` e `local`, unitário, integração, arquitetura, E2E (matriz `public`/`local`), `pnpm audit`, gitleaks, CodeQL e o job SDD (`validate --exclude-drafts` + `pr-check`). Os jobs viram checks obrigatórios no ruleset da `main`.

## 2. Motivação & Escopo
**Motivação:** "main sempre verde e publicável" (ADR-0004) e "nada entra sem CI" (ADR-0005) só valem se o CI for obrigatório.

**Objetivos (dentro do escopo):**
- `ci.yml` com jobs `quality` (format/lint/typecheck), `build` (matriz flavor, zips como artefato), `test` (unit + integration + coverage), `arch`, `e2e` (matriz flavor, Chromium Playwright com cache), `security` (`pnpm audit --audit-level=high` + gitleaks).
- `codeql.yml` (javascript-typescript) e `sdd.yml` (via `vendor --ci github`).
- `dependabot.yml` semanal para npm e github-actions.
- Checks obrigatórios adicionados ao ruleset da `main`; `ci` no sdd-config = `gh pr checks --watch`.
- Relatório Playwright e lcov como artefatos.

**Não-objetivos (fora do escopo):**
- Publicação/release (SPEC-0006).
- Comandos de teste em si (SPEC-0003) — o CI só os chama pelos scripts do contrato de SPEC-0002.

## 3. Dependências
- **Implementações necessárias:** SPEC-0002 — scripts do package.json e repositório no GitHub.
- **Contratos consumidos:** N/A — usa os nomes de script definidos em SPEC-0002 (se SPEC-0003 ainda não estiver na main, os jobs de teste falham pelo stub, o que é o comportamento correto).
- **Pré-requisitos externos:** GitHub Actions habilitado no repositório público; permissão de admin para o ruleset.

## 4. Decisão Arquitetural
**Contexto:** Projeto novo; ADR-0004 (entrega), ADR-0005 (fluxo), ADR-0006 (segredos), ADR-0008 (dependências).

**Decisão:** workflows separados por responsabilidade (`ci`, `codeql`, `sdd`), jobs com `permissions: contents: read` por padrão, actions fixadas por SHA.

**Justificativa:** menor privilégio para tokens do CI (ADR-0007) e supply chain das actions sob controle (ADR-0008).

**Desvio do padrão existente:** Nenhum.

**Alternativas descartadas:** um único job sequencial (lento, sem paralelismo); GitLab CI/CircleCI (repositório está no GitHub).

**ADRs:** ADR-0010, ADR-0004, ADR-0005, ADR-0006, ADR-0008.

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** pipeline de PR < 10 min (p95 das últimas 10 execuções) — medido no histórico do Actions.
- **Segurança:** `GITHUB_TOKEN` com leitura por padrão; actions fixadas por SHA; gitleaks bloqueia merge — IT-02, IT-03.
- **Privacidade e dados pessoais:** N/A — sem dados.
- **Disponibilidade e resiliência:** sem `continue-on-error` em jobs obrigatórios; sem retry automático de testes (ADR-0002).
- **Acessibilidade (UI):** N/A
- **Custo:** N/A — Actions gratuito para repositório público.

## 6. Artefato A — Contrato
**Interface:** `checks obrigatórios do PR`

```text
Gatilhos: pull_request (main), push (main)
Checks obrigatórios no ruleset da main:
  ci / quality · ci / build (public) · ci / build (local) · ci / test · ci / arch
  ci / e2e (public) · ci / e2e (local) · ci / security · codeql / analyze · sdd / sdd
Artefatos: extension-public, extension-local (saída de .output/chrome-mv3-<flavor>), playwright-report-<flavor> (só em falha); coverage-lcov passa a ser artefato da SPEC-0003 (ver Emendas)
Falha de qualquer check → PR não pode ser mergeado.
```

**Design:** N/A — sem interface.

**Arquivos/módulos afetados:** ver `touches` no frontmatter.

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| PR válido | todos os comandos passam | todos os checks verdes, zips publicados como artefato | IT-01 |
| Teste falhando | PR com teste vermelho | check `test` vermelho, merge bloqueado | IT-01 |
| Segredo commitado | PR com string de chave fictícia | check `security` vermelho | IT-02 |
| Workflow inseguro | action sem SHA ou `permissions: write-all` | teste de lint dos workflows falha | UT-01, IT-03 |

## 7. Artefato B — Plano de Testes (TDD)
### 7.1 Testes de Caracterização
- N/A — projeto novo.

### 7.2 Testes Unitários
- **UT-01** — Dado cada arquivo em `.github/workflows/`, quando o teste de política o analisa (YAML), então toda `uses:` está fixada por SHA de 40 caracteres e nenhum job declara `permissions: write-all`.

### 7.3 Testes de Integração
- **IT-01** — Num PR de teste no repositório real: com a branch verde todos os checks passam; com um commit que quebra um teste unitário o check `ci / test` falha e o GitHub marca o PR como não mergeável (evidência: links das duas execuções).
- **IT-02** — `gitleaks detect` com a config do repositório sobre um arquivo temporário contendo um token no formato de chave de API fictícia sai com código ≠ 0; sem ele, 0.
- **IT-03** — `actionlint` sobre `.github/workflows/` sai com código 0.

### 7.4 Testes de Contrato
- N/A — nenhuma spec consome contrato versionado desta.

### 7.5 Testes E2E
- N/A — user_facing: false.

### 7.6 Outros
- N/A

**Dublês e dados de teste:** token fictício gerado no teste (nunca real).

**Ambiente de execução:** UT-01, IT-02 e IT-03 localmente e no CI (`tests/ci/`); IT-01 no GitHub Actions do repositório.

## 8. Plano de Rollout
- **Estratégia:** deploy direto; checks tornados obrigatórios só depois de passarem uma vez na `main`.
- **Dados/schema:** N/A
- **Compatibilidade:** N/A
- **Observabilidade:** notificação do GitHub em falha de workflow na `main` (ADR-0009).
- **Rollback:** revert do merge commit e remoção temporária do check obrigatório no ruleset (decisão do Thomas).
- **Etapas de migração/coexistência:** N/A

## 9. Questões em Aberto
Nenhuma

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
<!-- Preenchido na fase PLAN. -->

**Fase 1: Política dos workflows**
- [ ] Red: escrever UT-01, IT-03, IT-02 com a tag `SPEC-0004:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 2: Checks obrigatórios**
- [ ] Red: PR de teste com teste vermelho bloqueado (IT-01, `SPEC-0004:IT-01`)
- [ ] Green: PR verde passa todos os checks; ruleset da `main` exige os checks (**com confirmação do Thomas**)

**Fase final: Integração, entrega e documentação**
- [ ] Review independente (G4)
- [ ] Integração + CI verde (G5) e aprovação (H2)
- [ ] Deploy: N/A — G6 = N/A apontando SPEC-0006
- [ ] Relatório de Entrega, docs raiz e CHANGELOG (G7)

## 12. Registro de Gates
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — ? | 2026-09-30 |
| G1 Red | PASS | verify G1: PASS; `pnpm exec vitest run tests/tooling tests/harness tests/ci` exit 1 (red: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/7]⎯) — 5bb3d63 | 2026-09-30 |
| G2 Green | PASS | build exit 0 (✔ Finished in 196 ms); test exit 0 (Duration  5.23s (tests 92%, import 4%, transform 3%)); lint exit 0 (✔ Finished in 127 ms) — 7f68699 | 2026-09-30 |
| G3 Arquitetura | N/A | sem arch_test até SPEC-0003 (dependency-cruiser); esta spec só adiciona workflows e configs, sem código de src/ | 2026-09-30 |
| G4 Review | PASS | verify G1+G4: PASS; revisão: reviewer-agent a7b7ce87: APPROVED @ 7f68699 (4 minor, 0 blocker/major; SHAs e sha256 do gitleaks verificados) — 7f68699 | 2026-09-30 |
| G5 Integração & CI | PASS | build exit 0 (✔ Finished in 182 ms); test exit 0 (Duration  18.75s (tests 98%, import 1%)); test_integration exit 0 (Duration  136ms (transform 59%, setup 24%, import 6%, tests 6%, worker 5%)); test_e2e exit 0 (3 passed (4.1s)); arch_test exit 0 (✔ no dependency violations found (3 modules, 0 dependencies cruised)); security_scan exit 0 ([90m6:13PM[0m [32mINF[0m [1mno leaks found[0m) — 6e656d2 | 2026-09-30 |
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
| 1 (texto) | 2026-09-30 | artefatos reais: `extension-<flavor>` e `playwright-report-<flavor>` (nome único por matriz); `coverage-lcov` transferido para a SPEC-0003 | `upload-artifact` v4+ rejeita nomes repetidos em matriz; não há script de cobertura até a SPEC-0003 | SPEC-0003 | pendente de ratificação do Thomas no H2 da onda 2 |
