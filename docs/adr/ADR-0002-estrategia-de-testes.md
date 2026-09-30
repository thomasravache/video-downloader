---
id: ADR-0002
title: Estratégia de testes
status: accepted
origin: decision
date: 2026-09-30
pillars: [testes]
baseline: testes@2026.09
decision_makers: [Thomas]
consulted: []
informed: []
supersedes:
superseded_by:
enforced_by: "comandos test/test_integration/test_e2e do sdd-config no CI — SPEC-0003/SPEC-0004"
---

# ADR-0002 — Estratégia de testes

<!-- ADR de base do pilar "Estratégia de testes" (catálogo SDD 2026.09). Fixa REGRAS verificáveis; a tecnologia é escolha do projeto (campos com chaves duplas). Ajuste as regras ao produto — remover uma regra exige registrar o motivo em Consequências — ou dispense o pilar em sdd-config.yml (pillars.waived). Só vira accepted com aprovação humana (H1). -->

## Contexto e Problema
Sem estratégia explícita, os testes ficam desbalanceados (muitos E2E instáveis ou nenhum teste de integração real) e o CI deixa de ser confiável. Extensão sem backend: o risco está na integração com APIs do Chrome (downloads, mensagens, webRequest) e no comportamento em páginas reais. Mocks de `chrome.*` sozinhos escondem erros do MV3.

## Direcionadores da Decisão
- Testar com a extensão carregada num Chromium real
- Feedback rápido para o núcleo de detecção
- CI gratuito (repo público)

## Opções Consideradas
- **A.** Vitest (unitário + integração com fake de `browser.*` do WXT e páginas de teste servidas localmente) + Playwright com `--load-extension` (E2E)
- **B.** Jest + Puppeteer

## Resultado da Decisão
**Opção escolhida:** "A. Vitest + Playwright", porque Vitest é nativo do Vite/WXT e Playwright suporta extensões MV3 em Chromium persistente, incluindo acesso ao service worker.

**Regras (verificáveis):**
- Níveis e obrigatoriedade conforme a skill: unitário, integração com dependências reais, contrato entre specs e E2E das jornadas de usuário.
- A suíte completa roda no CI em toda solicitação de mudança.
- "Integração com dependências reais" aqui = Chromium real com a extensão carregada ou páginas de teste servidas por servidor HTTP local (fixtures em `e2e/fixtures/`); nunca sites de terceiros no CI.
- E2E roda para os dois builds (`public` e `local`).
- As jornadas críticas estão em `critical_journeys` no sdd-config e cada uma tem ao menos um E2E.
- Teste instável é defeito: vai para quarentena por no máximo 7 dias com spec aberta para corrigir; nunca retry-até-passar.
- Cobertura das linhas alteradas ≥ 80% quando a medição estiver configurada.

### Consequências
- **Boa**, porque E2E exercita o fluxo real página → popup → arquivo em disco
- **Ruim**, porque E2E de extensão exige Chromium com contexto persistente (sem headless antigo), mais lento no CI

### Confirmação (G3)
Comandos `test`, `test_integration`, `test_e2e` e `coverage` do sdd-config, executados pelo `gate --run` e pelo CI.

## Prós e Contras das Opções
| Critério (peso) | Vitest + Playwright | Jest + Puppeteer |
|---|---|---|
| Integração com Vite/WXT (4) | 5 | 2 |
| Suporte a extensão MV3 (5) | 5 | 4 |
| Velocidade (3) | 5 | 3 |
| **Total ponderado** | **60** | **37** |

## Mais Informações
Referências neutras: Pirâmide de testes; references/testing.md da skill. vitest 5.0.3 e @playwright/test 1.63.0 (npm, 2026-09-30). Playwright — Chrome extensions: https://playwright.dev/docs/chrome-extensions (a confirmar em SPEC-0003).
