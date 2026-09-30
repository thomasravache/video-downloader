---
id: ADR-0008
title: Dependências e ciclo de vida da stack
status: accepted
origin: decision
date: 2026-09-30
pillars: [dependencias]
baseline: dependencias@2026.09
decision_makers: [Thomas]
consulted: []
informed: []
supersedes:
superseded_by:
enforced_by: "pnpm audit --audit-level=high em security_scan no CI; dependabot.yml — SPEC-0004"
---

# ADR-0008 — Dependências e ciclo de vida da stack

<!-- ADR de base do pilar "Dependências e ciclo de vida da stack" (catálogo SDD 2026.09). Fixa REGRAS verificáveis; a tecnologia é escolha do projeto (campos com chaves duplas). Ajuste as regras ao produto — remover uma regra exige registrar o motivo em Consequências — ou dispense o pilar em sdd-config.yml (pillars.waived). Só vira accepted com aprovação humana (H1). -->

## Contexto e Problema
Dependências vulneráveis ou fora de suporte viram risco silencioso, e atualizar tudo de uma vez depois fica caro. WXT ainda é 0.x e o ecossistema de extensões muda com o Chrome; repositório público recebe alertas de segurança do GitHub gratuitamente.

## Direcionadores da Decisão
- Custo zero
- Atualizações pequenas e frequentes
- Lockfile determinístico

## Opções Consideradas
- **A.** Dependabot (version + security updates) + `pnpm audit` no CI
- **B.** Renovate

## Resultado da Decisão
**Opção escolhida:** "A. Dependabot + pnpm audit", porque nativo do GitHub, sem app extra para um repo pessoal.

**Regras (verificáveis):**
- Varredura de vulnerabilidades no CI; severidade crítica bloqueia o merge.
- Atualização de dependências automatizada (Dependabot, `.github/dependabot.yml`) com revisão, pelo menos semanal.
- Nenhuma dependência ou runtime fora de suporte (EOL); o calendário de fim de suporte é revisado a cada trimestre (Node LTS, WXT, Chrome MV3) e cada item vira spec.
- Arquivos de trava de versão (lockfiles) versionados.
- Licenças compatíveis com MIT (sem GPL no bundle distribuído).

### Consequências
- **Boa**, porque vulnerabilidades e versões novas chegam como PR com CI
- **Ruim**, porque menos flexível que o Renovate para agrupar atualizações

### Confirmação (G3)
`security_scan` no sdd-config e no CI; `verify` avisa manifesto alterado sem ADR.

## Prós e Contras das Opções
| Critério (peso) | Dependabot | Renovate |
|---|---|---|
| Configuração (3) | 5 | 3 |
| Flexibilidade (2) | 3 | 5 |
| Custo (3) | 5 | 5 |
| **Total ponderado** | **36** | **34** |

## Mais Informações
Referências neutras: SLSA, OpenSSF Scorecard. Dependabot — https://docs.github.com/code-security/dependabot (não verificado nesta data). pnpm — versão a fixar em SPEC-0002.
