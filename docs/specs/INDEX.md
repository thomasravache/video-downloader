# Índice de Specs

> Gerado por `spec_graph.py index` em 2026-09-30 — não edite manualmente.

## Saúde

- Validação (G0): **1 erro(s), 3 aviso(s)** — rode `spec_graph.py validate`
- Specs: proposed 1, approved 4, implemented 1
- Impedimentos: **0 aberto(s)**, 0 resolvido(s)

## Cobertura de Pilares

Perfil: **padrao**

| Pilar | Situação | Detalhe |
|---|---|---|
| Arquitetura e fronteiras | coberto | ADR-0001, ADR-0011 |
| Estratégia de testes | coberto | ADR-0002 |
| Qualidade de código | coberto | ADR-0003 |
| Entrega contínua e ambientes | coberto | ADR-0004 |
| Fluxo de mudança | coberto | ADR-0005 |
| Segredos e dados sensíveis | coberto | ADR-0006 |
| Identidade e acesso | coberto | ADR-0007 |
| Dependências e ciclo de vida da stack | coberto | ADR-0008 |
| Observabilidade | coberto | ADR-0009 |
| Resiliência e recuperação | dispensado | extensão 100% local, sem servidor nem dados persistentes de valor; retomada/falha de download tratada nas specs de feature |
| Dados e migrações | dispensado | sem banco; só preferências em chrome.storage — migração de schema de preferências coberta por teste na spec que introduzir a primeira mudança |
| Custo | dispensado | sem infraestrutura paga; único custo é a taxa única de US$ 5 do registro de desenvolvedor da Chrome Web Store (reavaliar no épico do Google Drive) |

## Jornadas Críticas

| Jornada | Situação | Specs |
|---|---|---|
| Usuário abre uma página com vídeo sem DRM, vê o vídeo no popup e baixa o arquivo | planejada | SPEC-0005 |

## Plano de Execução

**Em andamento:** —  
**Paradas por impedimento:** —  
**Próximo lote:** SPEC-0003, SPEC-0004

| Onda | Spec | Título | Tier/Tam. | Status | Prontidão | Observação |
|---|---|---|---|---|---|---|
| 1 | SPEC-0003 | Harness de testes (unitário, integração, E2E com extensão carregada, arquitetura) | full/M | approved | ✅ pronta |  |
| 1 | SPEC-0004 | Pipeline de CI no GitHub Actions | full/S | approved | ✅ pronta |  |
| 1 | SPEC-0007 | Endurecer seleção de flavor e tipar FLAVOR | lite/S | proposed | ⏳ aguardando aprovação (H1) |  |
| 2 | SPEC-0005 | Walking skeleton: detectar vídeo direto e baixar pelo popup | full/M | approved | ⛔ aguarda implementação de SPEC-0003; aguarda implementação de SPEC-0004 |  |
| 2 | SPEC-0006 | Pipeline de release e builds public/local | full/M | approved | ⛔ aguarda implementação de SPEC-0004 |  |

## Épicos

| Épico | Título | Status | Progresso |
|---|---|---|---|
| SPEC-0001 | Fundação da extensão de download de vídeos | approved | 1/6 implementadas |

## Grafo de Dependências

Seta contínua: depende da implementação. Seta tracejada: consome contrato.

```mermaid
flowchart LR
  subgraph E0001["SPEC-0001 · Fundação da extensão de download de vídeos"]
    S0002["SPEC-0002<br/>Repositório e tooling (WXT + TypeScript)"]:::implemented
    S0003["SPEC-0003<br/>Harness de testes (unitário, integração…"]:::approved
    S0004["SPEC-0004<br/>Pipeline de CI no GitHub Actions"]:::approved
    S0005["SPEC-0005<br/>Walking skeleton: detectar vídeo direto…"]:::approved
    S0006["SPEC-0006<br/>Pipeline de release e builds public/loc…"]:::approved
    S0007["SPEC-0007<br/>Endurecer seleção de flavor e tipar FLA…"]:::proposed
  end
  S0002 --> S0003
  S0002 --> S0004
  S0003 --> S0005
  S0004 --> S0005
  S0004 --> S0006
  S0005 -. contrato v1 .-> S0006
  S0002 --> S0007
  classDef proposed fill:#fef3c7,stroke:#d97706,color:#111
  classDef approved fill:#dbeafe,stroke:#2563eb,color:#111
  classDef inprogress fill:#ede9fe,stroke:#7c3aed,color:#111
  classDef implemented fill:#dcfce7,stroke:#16a34a,color:#111
  classDef deprecated fill:#f3f4f6,stroke:#9ca3af,color:#6b7280
```

## Todas as Specs

| ID | Título | Tier | Tipo | Status | Criada | Épico | Depende de | Consome contrato |
|---|---|---|---|---|---|---|---|---|
| [SPEC-0001](SPEC-0001-fundacao-da-extensao-de-download-de-videos.md) | Fundação da extensão de download de vídeos | epic | foundation | approved | 2026-09-30 | — | — | — |
| [SPEC-0002](SPEC-0002-repositorio-e-tooling-wxt-typescript.md) | Repositório e tooling (WXT + TypeScript) | full | foundation | implemented | 2026-09-30 | SPEC-0001 | — | — |
| [SPEC-0003](SPEC-0003-harness-de-testes-unitario-integracao-e2e-com-extensao-carre.md) | Harness de testes (unitário, integração, E2E com extensão carregada, arquitetura) | full | foundation | approved | 2026-09-30 | SPEC-0001 | SPEC-0002 | — |
| [SPEC-0004](SPEC-0004-pipeline-de-ci-no-github-actions.md) | Pipeline de CI no GitHub Actions | full | foundation | approved | 2026-09-30 | SPEC-0001 | SPEC-0002 | — |
| [SPEC-0005](SPEC-0005-walking-skeleton-detectar-video-direto-e-baixar-pelo-popup.md) | Walking skeleton: detectar vídeo direto e baixar pelo popup | full | foundation | approved | 2026-09-30 | SPEC-0001 | SPEC-0003, SPEC-0004 | — |
| [SPEC-0006](SPEC-0006-pipeline-de-release-e-builds-public-local.md) | Pipeline de release e builds public/local | full | foundation | approved | 2026-09-30 | SPEC-0001 | SPEC-0004 | SPEC-0005@1 |
| [SPEC-0007](SPEC-0007-endurecer-selecao-de-flavor-e-tipar-flavor.md) | Endurecer seleção de flavor e tipar FLAVOR | lite | fix | proposed | 2026-09-30 | SPEC-0001 | SPEC-0002 | — |

## ADRs

| ID | Título | Status | Garantido por (G3) |
|---|---|---|---|
| [ADR-0001](../adr/ADR-0001-arquitetura-e-fronteiras.md) | Arquitetura e fronteiras | accepted | dependency-cruiser (.dependency-cruiser.cjs) no CI — SPEC-0003 |
| [ADR-0002](../adr/ADR-0002-estrategia-de-testes.md) | Estratégia de testes | accepted | comandos test/test_integration/test_e2e do sdd-config no CI — SPEC-0003/SPEC-0004 |
| [ADR-0003](../adr/ADR-0003-qualidade-de-codigo.md) | Qualidade de código | accepted | lint + typecheck + CodeQL no CI — SPEC-0002/SPEC-0004 |
| [ADR-0004](../adr/ADR-0004-entrega-continua-e-ambientes.md) | Entrega contínua e ambientes | accepted | workflow release.yml e deploy_staging/deploy_production do sdd-config — SPEC-0006 |
| [ADR-0005](../adr/ADR-0005-fluxo-de-mudanca.md) | Fluxo de mudança | accepted | ruleset da main + job sdd (pr-check) — SPEC-0002/SPEC-0004 |
| [ADR-0006](../adr/ADR-0006-segredos-e-dados-sensiveis.md) | Segredos e dados sensíveis | accepted | gitleaks em security_scan no CI + teste de ausência de fetch para hosts externos — SPEC-0004/SPEC-0005 |
| [ADR-0007](../adr/ADR-0007-identidade-e-acesso.md) | Identidade e acesso | accepted | teste de integração sobre o manifest.json gerado (sem <all_urls>, sem CSP relaxada) — SPEC-0005/SPEC-0006 |
| [ADR-0008](../adr/ADR-0008-dependencias-e-ciclo-de-vida-da-stack.md) | Dependências e ciclo de vida da stack | accepted | pnpm audit --audit-level=high em security_scan no CI; dependabot.yml — SPEC-0004 |
| [ADR-0009](../adr/ADR-0009-observabilidade.md) | Observabilidade | accepted | teste de integração do logger (ID de correlação, sem URLs completas com query) — SPEC-0005 |
| [ADR-0010](../adr/ADR-0010-stack-da-extensao-typescript-wxt-manifest-v3.md) | Stack da extensão: TypeScript + WXT (Manifest V3) | accepted | typecheck (tsc --noEmit) e build WXT no CI (SPEC-0004); dependency-cruiser (ADR-0001) |
| [ADR-0011](../adr/ADR-0011-providers-por-site-e-builds-public-local.md) | Providers por site e builds public/local | accepted | dependency-cruiser (fronteiras) + teste sobre dist/public que falha se contiver provider local (SPEC-0006:IT-01) |
