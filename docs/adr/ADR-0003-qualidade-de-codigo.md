---
id: ADR-0003
title: Qualidade de código
status: accepted
origin: decision
date: 2026-09-30
pillars: [qualidade-codigo]
baseline: qualidade-codigo@2026.09
decision_makers: [Thomas]
consulted: []
informed: []
supersedes:
superseded_by:
enforced_by: "lint + typecheck + CodeQL no CI — SPEC-0002/SPEC-0004"
---

# ADR-0003 — Qualidade de código

<!-- ADR de base do pilar "Qualidade de código" (catálogo SDD 2026.09). Fixa REGRAS verificáveis; a tecnologia é escolha do projeto (campos com chaves duplas). Ajuste as regras ao produto — remover uma regra exige registrar o motivo em Consequências — ou dispense o pilar em sdd-config.yml (pillars.waived). Só vira accepted com aprovação humana (H1). -->

## Contexto e Problema
Estilo e problemas triviais revisados à mão custam caro e geram inconsistência, principalmente quando parte do código é escrita por agentes. Mantenedor único vindo de C#: tipos estritos e lint automático substituem parte da revisão que um time faria.

## Direcionadores da Decisão
- Tipagem no modo mais estrito
- Formatação sem discussão
- SAST gratuito para repo público

## Opções Consideradas
- **A.** ESLint (typescript-eslint strict) + Prettier + tsc strict + CodeQL
- **B.** Biome (lint+format) + tsc strict + CodeQL

## Resultado da Decisão
**Opção escolhida:** "A. ESLint + Prettier + tsc strict + CodeQL", porque typescript-eslint tem regras type-aware mais completas e o ecossistema WXT/Vite documenta essa combinação; CodeQL é gratuito em repositório público.

**Regras (verificáveis):**
- Formatador com verificação automática no CI (falha se o código não estiver formatado).
- Linter com regras versionadas no repositório; zero avisos novos nas linhas alteradas.
- Checagem de tipos habilitada no modo mais estrito viável para a linguagem.
- Suprimir uma regra exige comentário com o motivo na própria linha; supressão sem motivo é achado do revisor.
- Análise estática de segurança (SAST) no CI.

### Consequências
- **Boa**, porque erros de tipo e de padrão pegos antes da revisão
- **Ruim**, porque duas ferramentas (ESLint e Prettier) em vez de uma

### Confirmação (G3)
Comando `lint` (e formatação/tipos) do sdd-config no CI e no G2; configuração em `eslint.config.js`, `.prettierrc`, `tsconfig.json` (`strict: true`, `noUncheckedIndexedAccess: true`) e `.github/workflows/codeql.yml`.

## Prós e Contras das Opções
| Critério (peso) | ESLint+Prettier | Biome |
|---|---|---|
| Regras type-aware (4) | 5 | 3 |
| Velocidade (2) | 3 | 5 |
| Ecossistema/documentação (3) | 5 | 4 |
| **Total ponderado** | **41** | **34** |

## Mais Informações
Referências neutras: Regras publicadas das próprias ferramentas escolhidas. Versões fixadas em SPEC-0002 (verificar no npm na instalação). CodeQL — https://docs.github.com/code-security/code-scanning (não verificado nesta data).
