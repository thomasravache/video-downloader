---
id: ADR-0001
title: Arquitetura e fronteiras
status: accepted
origin: decision
date: 2026-09-30
pillars: [arquitetura]
baseline: arquitetura@2026.09
decision_makers: [Thomas]
consulted: []
informed: []
supersedes:
superseded_by:
enforced_by: "dependency-cruiser (.dependency-cruiser.cjs) no CI — SPEC-0003"
---

# ADR-0001 — Arquitetura e fronteiras

<!-- ADR de base do pilar "Arquitetura e fronteiras" (catálogo SDD 2026.09). Fixa REGRAS verificáveis; a tecnologia é escolha do projeto (campos com chaves duplas). Ajuste as regras ao produto — remover uma regra exige registrar o motivo em Consequências — ou dispense o pilar em sdd-config.yml (pillars.waived). Só vira accepted com aprovação humana (H1). -->

## Contexto e Problema
Sem fronteiras explícitas e verificadas, módulos se acoplam aos poucos e cada mudança passa a exigir mexer em tudo. Extensão MV3 com vários contextos (content script, service worker, popup, futuro offscreen) e providers por site (ADR-0011); sem fronteiras, código de YouTube ou de um site vaza para o núcleo e para o build público.

## Direcionadores da Decisão
- Build `public` nunca pode conter provider `local` (ADR-0011)
- Adicionar site novo sem mexer no núcleo
- Mantenedor único: estrutura previsível, parecida com módulos .NET

## Opções Consideradas
- **A.** dependency-cruiser (regras de import sobre o grafo TypeScript)
- **B.** eslint-plugin-boundaries (regras de import no lint)

## Resultado da Decisão
**Opção escolhida:** "A. dependency-cruiser", porque valida o grafo inteiro (inclusive ciclos), roda como teste independente do lint e gera relatório legível no CI.

**Regras (verificáveis):**
- Cada módulo expõe um contrato público; os demais só dependem desse contrato.
- As dependências proibidas entre camadas e módulos estão listadas abaixo e são verificadas por teste de arquitetura no CI.
- Não há ciclos de dependência entre módulos.
- Mudar uma fronteira exige um ADR novo (que substitui este).
- Módulos: `src/core/**` (contratos e regras, sem `chrome.*`), `src/providers/<site>/**` (só importam `core`), `entrypoints/**` (popup, background, content — popup não importa providers).

### Consequências
- **Boa**, porque as fronteiras core/providers/entrypoints são verificadas em todo PR
- **Ruim**, porque mais uma ferramenta e um arquivo de regras para manter

### Confirmação (G3)
Teste de arquitetura dependency-cruiser em `.dependency-cruiser.cjs` (comando `pnpm arch`), rodando no CI (G3).

## Prós e Contras das Opções
| Critério (peso) | dependency-cruiser | eslint-plugin-boundaries |
|---|---|---|
| Detecta ciclos e regras de grafo (5) | 5 | 3 |
| Maturidade/manutenção (3) | 5 | 4 |
| Integração com TS/WXT (3) | 4 | 4 |
| **Total ponderado** | **52** | **39** |

## Mais Informações
Referências neutras: C4 model (diagramas de contexto e contêiner). dependency-cruiser — versão a fixar em SPEC-0003 (npm, verificar na instalação); eslint-plugin-boundaries — não verificado.
