---
id: ADR-0006
title: Segredos e dados sensíveis
status: accepted
origin: decision
date: 2026-09-30
pillars: [segredos-dados]
baseline: segredos-dados@2026.09
decision_makers: [Thomas]
consulted: []
informed: []
supersedes:
superseded_by:
enforced_by: "gitleaks em security_scan no CI + teste de ausência de fetch para hosts externos — SPEC-0004/SPEC-0005"
---

# ADR-0006 — Segredos e dados sensíveis

<!-- ADR de base do pilar "Segredos e dados sensíveis" (catálogo SDD 2026.09). Fixa REGRAS verificáveis; a tecnologia é escolha do projeto (campos com chaves duplas). Ajuste as regras ao produto — remover uma regra exige registrar o motivo em Consequências — ou dispense o pilar em sdd-config.yml (pillars.waived). Só vira accepted com aprovação humana (H1). -->

## Contexto e Problema
Credencial em código ou log e dado pessoal sem controle são as falhas de segurança e de conformidade mais comuns. Repositório público (MIT): qualquer credencial commitada vaza na hora. A extensão vê URLs de páginas e de mídia do usuário — dado pessoal que nunca pode sair do navegador. A publicação na loja exige política de privacidade.

## Direcionadores da Decisão
- Nenhuma telemetria ou envio de dados
- Credenciais da API da loja só no CI
- Política de privacidade exigida pela Web Store

## Opções Consideradas
- **A.** GitHub Actions secrets (environment `production` com aprovação) + gitleaks no CI
- **B.** Secrets em arquivo .env local não versionado para publicar manualmente

## Resultado da Decisão
**Opção escolhida:** "A. GitHub Actions secrets por environment + gitleaks", porque as únicas credenciais (OAuth da Chrome Web Store API) só são usadas pelo pipeline de release.

**Regras (verificáveis):**
- Nenhum segredo no repositório; varredura de segredos no CI bloqueia o merge.
- Segredos ficam em GitHub Actions secrets, no environment `webstore` (aprovação obrigatória), separados por ambiente, com acesso mínimo.
- Rotação de credenciais a cada 12 meses e imediata em caso de vazamento.
- Dados pessoais classificados, com base legal, finalidade e prazo de retenção registrados: URLs de páginas/mídia ficam só em memória por aba (descartadas ao fechar a aba); nada é enviado a servidor; política de privacidade publicada declara isso.
- Dados pessoais e segredos nunca aparecem em logs (mascaramento verificado por teste).
- Criptografia em trânsito: a extensão só baixa pela URL original do site (HTTPS quando o site oferece); em repouso: N/A — não armazena dados do usuário além de preferências.

### Consequências
- **Boa**, porque segredos nunca tocam a máquina do agente nem o repositório
- **Ruim**, porque publicação depende do pipeline estar funcionando

### Confirmação (G3)
Varredura de segredos em `security_scan`; teste de mascaramento de logs no plano de testes.

## Prós e Contras das Opções
| Critério (peso) | Actions secrets + gitleaks | .env local |
|---|---|---|
| Risco de vazamento (5) | 5 | 2 |
| Simplicidade (2) | 4 | 5 |
| **Total ponderado** | **33** | **20** |

## Mais Informações
Referências neutras: OWASP ASVS; LGPD/GDPR. gitleaks — https://github.com/gitleaks/gitleaks (versão a fixar em SPEC-0004, não verificado nesta data). Política da Web Store sobre dados do usuário (consultado 2026-09-30).
