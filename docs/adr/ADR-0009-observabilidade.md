---
id: ADR-0009
title: Observabilidade
status: accepted
origin: decision
date: 2026-09-30
pillars: [observabilidade]
baseline: observabilidade@2026.09
decision_makers: [Thomas]
consulted: []
informed: []
supersedes:
superseded_by:
enforced_by: "teste de integração do logger (ID de correlação, sem URLs completas com query) — SPEC-0005"
---

# ADR-0009 — Observabilidade

<!-- ADR de base do pilar "Observabilidade" (catálogo SDD 2026.09). Fixa REGRAS verificáveis; a tecnologia é escolha do projeto (campos com chaves duplas). Ajuste as regras ao produto — remover uma regra exige registrar o motivo em Consequências — ou dispense o pilar em sdd-config.yml (pillars.waived). Só vira accepted com aprovação humana (H1). -->

## Contexto e Problema
Sem sinais e metas definidos, problemas em produção são descobertos pelo usuário e o rollback vira decisão no escuro. Não há servidor: não existem requisições, traces distribuídos nem health check de serviço. Coletar telemetria remota contradiz ADR-0006 (nenhum dado sai do navegador). A observabilidade possível é local e o sinal de produção vem da loja (avaliações, relatórios de erro) e dos issues do GitHub.

## Direcionadores da Decisão
- Zero telemetria remota
- Diagnóstico reproduzível quando o usuário reporta falha
- Sinal de saúde da release na loja

## Opções Consideradas
- **A.** Log estruturado local (ring buffer em `chrome.storage.session`) com ID de correlação por detecção/download + botão "copiar diagnóstico" no popup + painel de erros do Developer Dashboard da loja
- **B.** Telemetria remota opt-in (ex.: Sentry)

## Resultado da Decisão
**Opção escolhida:** "A. Log estruturado local + diagnóstico exportável pelo usuário", porque dá contexto para reproduzir defeitos sem enviar dados a terceiros.

**Regras (verificáveis):**
- Logs estruturados com ID de correlação que atravessa as chamadas.
- Métricas: contadores locais por provider (detecções, downloads iniciados/concluídos/falhos) visíveis no diagnóstico; sem envio remoto.
- Traces distribuídos: substituído pelo ID de correlação que atravessa content script → background → popup → download (os "processos" da extensão).
- Health check: smoke E2E contra o zip gerado em cada release (a extensão carrega, o service worker responde a `ping`).
- SLI da jornada `baixar-video-direto`: taxa de sucesso do E2E nos fixtures do CI = 100%; SLO de produção medido por issues abertos por release (removida a meta de orçamento de erro remoto: sem telemetria, ver Consequências).
- Alertas: notificação do GitHub para issues com label `bug` e para falha do workflow de release; responsável: Thomas; runbook em `docs/runbook.md`.
- Cada Plano de Rollout define o limite numérico que dispara rollback durante a observação do deploy.
- Nenhum dado pessoal ou segredo em logs, métricas ou traces.

### Consequências
- **Boa**, porque privacidade total e mensagem simples na política da loja
- **Ruim**, porque só sabemos de falhas quando o usuário reporta
- **Regras adaptadas:** métricas por serviço, traces distribuídos, health check de serviço e orçamento de erro remoto foram substituídos por equivalentes locais porque não há servidor e ADR-0006 proíbe enviar dados do usuário

### Confirmação (G3)
Instrumentação com logger próprio em `src/core/diagnostics` (JSON estruturado, ring buffer de 500 entradas); teste de integração do health check; limite de rollback verificado no G6.

## Prós e Contras das Opções
| Critério (peso) | Log local + diagnóstico | Telemetria opt-in |
|---|---|---|
| Privacidade/política da loja (5) | 5 | 2 |
| Visibilidade de falhas (3) | 2 | 5 |
| Custo (2) | 5 | 3 |
| **Total ponderado** | **41** | **31** |

## Mais Informações
Referências neutras: OpenTelemetry (padrão aberto de instrumentação); Google SRE (SLI, SLO, orçamento de erro). Chrome Web Store Developer Dashboard — relatórios e avaliações (não verificado nesta data). `chrome.storage.session` — https://developer.chrome.com/docs/extensions/reference/api/storage (não verificado nesta data).
