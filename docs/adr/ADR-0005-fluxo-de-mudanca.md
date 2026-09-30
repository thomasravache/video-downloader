---
id: ADR-0005
title: Fluxo de mudança
status: accepted
origin: decision
date: 2026-09-30
pillars: [fluxo-mudanca]
baseline: fluxo-mudanca@2026.09
decision_makers: [Thomas]
consulted: []
informed: []
supersedes:
superseded_by:
enforced_by: "ruleset da main + job sdd (pr-check) — SPEC-0002/SPEC-0004"
---

# ADR-0005 — Fluxo de mudança

<!-- ADR de base do pilar "Fluxo de mudança" (catálogo SDD 2026.09). Fixa REGRAS verificáveis; a tecnologia é escolha do projeto (campos com chaves duplas). Ajuste as regras ao produto — remover uma regra exige registrar o motivo em Consequências — ou dispense o pilar em sdd-config.yml (pillars.waived). Só vira accepted com aprovação humana (H1). -->

## Contexto e Problema
Push direto e merges locais tiram a revisão e os checks do caminho, e a rastreabilidade entre spec, código e deploy se perde. Repositório público no GitHub com um mantenedor (Thomas) e agentes de IA escrevendo código; a revisão humana é a última barreira.

## Direcionadores da Decisão
- change_flow: pr com merge commit
- Mantenedor único não pode ser bloqueado por falta de segundo revisor
- CI e job SDD obrigatórios

## Opções Consideradas
- **A.** Branch protection/rulesets do GitHub com checks obrigatórios e 1 revisão (o mantenedor revisa PRs abertos pelos agentes)
- **B.** Commit direto na main

## Resultado da Decisão
**Opção escolhida:** "A. Rulesets do GitHub com PR obrigatório", porque garante que nada chega à main sem CI verde e revisão, conforme decidido em 2026-09-30.

**Regras (verificáveis):**
- Toda mudança entra na branch principal por solicitação de mudança (PR, MR ou equivalente).
- Checks obrigatórios (build, testes, `sdd`) e pelo menos 1 revisão humana antes do merge.
- Sem push direto nem force-push na branch principal, inclusive para administradores.
- Merge com merge commit (sem squash), para as evidências dos gates continuarem válidas.
- Arquivos de controle (tools/sdd, sdd-config, ADRs, hooks, workflows) têm dono obrigatório na revisão.
- Correção urgente segue o mesmo caminho, com spec lite criada na hora e revisão acelerada.

### Consequências
- **Boa**, porque histórico auditável e gates com evidência preservada (merge commit)
- **Ruim**, porque PRs do próprio mantenedor precisam de bypass de revisão documentado ou de revisão por agente independente (registrada no G4)

### Confirmação (G3)
Proteção de branch em GitHub (ruleset da branch `main`); `change_flow: pr` no sdd-config; `vendor --codeowners`; `validate` aponta desvios.

## Prós e Contras das Opções
| Critério (peso) | Ruleset + PR | Commit direto |
|---|---|---|
| Segurança da main (5) | 5 | 1 |
| Velocidade (2) | 3 | 5 |
| **Total ponderado** | **31** | **15** |

## Mais Informações
Referências neutras: Práticas de trunk-based development. GitHub rulesets — https://docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets (não verificado nesta data).
