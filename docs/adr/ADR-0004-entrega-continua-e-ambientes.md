---
id: ADR-0004
title: Entrega contínua e ambientes
status: accepted
origin: decision
date: 2026-09-30
pillars: [entrega]
baseline: entrega@2026.09
decision_makers: [Thomas]
consulted: []
informed: []
supersedes:
superseded_by:
enforced_by: "workflow release.yml e deploy_staging/deploy_production do sdd-config — SPEC-0006"
---

# ADR-0004 — Entrega contínua e ambientes

<!-- ADR de base do pilar "Entrega contínua e ambientes" (catálogo SDD 2026.09). Fixa REGRAS verificáveis; a tecnologia é escolha do projeto (campos com chaves duplas). Ajuste as regras ao produto — remover uma regra exige registrar o motivo em Consequências — ou dispense o pilar em sdd-config.yml (pillars.waived). Só vira accepted com aprovação humana (H1). -->

## Contexto e Problema
Sem caminho automatizado até produção, o produto fica 'pronto' sem nunca chegar ao usuário, e cada deploy vira evento de risco. O "deploy" de uma extensão é publicar um zip: na Chrome Web Store (build `public`) e como artefato de release no GitHub (build `local`). A loja revisa cada versão e não aceita downgrade.

## Direcionadores da Decisão
- Uma única origem para os dois builds
- Publicação na loja sem passo manual de upload
- Rollback apesar de a loja não aceitar versão menor

## Opções Consideradas
- **A.** GitHub Actions + Chrome Web Store API (upload/publish) + GitHub Releases
- **B.** Upload manual pelo painel da loja

## Resultado da Decisão
**Opção escolhida:** "A. GitHub Actions + Chrome Web Store API + GitHub Releases", porque mesma plataforma do CI e do repositório, sem custo em repo público, e publicação reproduzível a partir de tag.

**Regras (verificáveis):**
- Um único pipeline leva do commit à produção; nada é publicado fora dele.
- A branch principal está sempre em estado publicável.
- Staging é atualizado automaticamente a cada merge: build de pré-release (`local` como artefato do workflow) com E2E contra os zips gerados; a release candidata (tag `vX.Y.Z-rc.N`) é submetida à loja com `publishType=STAGED_PUBLISH` (API v2: aprovada na revisão e mantida em staging, sem publicar) e os zips vão para uma GitHub Release prerelease. (Nota 2026-09-30: a v1.1 com `trustedTesters` foi arquivada; ver SPEC-0006 Emenda 1.)
- Produção exige confirmação humana por release; estratégia (direta, flag, canário, blue-green) definida por spec.
- Rollback em um passo, ensaiado: republicar o código da tag anterior com versão maior (`X.Y.Z+1`), pois a loja não aceita downgrade; preferências em `chrome.storage` compatíveis com a versão anterior.
- Métricas DORA acompanhadas: frequência de deploy, tempo de entrega, taxa de falha, tempo de recuperação.

### Consequências
- **Boa**, porque toda versão publicada vem de uma tag e de um pipeline verde
- **Ruim**, porque depende de credenciais OAuth da API da loja (segredos do GitHub) e da revisão da loja, que pode levar dias

### Confirmação (G3)
Pipeline GitHub Actions (`.github/workflows/release.yml`); `deploy_staging`, `deploy_production` e `smoke_test` no sdd-config (G6).

## Prós e Contras das Opções
| Critério (peso) | Actions + API | Manual |
|---|---|---|
| Reprodutibilidade (5) | 5 | 1 |
| Esforço por release (3) | 5 | 2 |
| Configuração inicial (2) | 3 | 5 |
| **Total ponderado** | **46** | **21** |

## Mais Informações
Referências neutras: DORA (Accelerate), Twelve-Factor App. Chrome Web Store API — https://developer.chrome.com/docs/webstore/using-api (não verificado nesta data; confirmar versão da API em SPEC-0006).
