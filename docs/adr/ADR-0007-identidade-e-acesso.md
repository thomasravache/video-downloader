---
id: ADR-0007
title: Identidade e acesso
status: accepted
origin: decision
date: 2026-09-30
pillars: [seguranca-acesso]
baseline: seguranca-acesso@2026.09
decision_makers: [Thomas]
consulted: []
informed: []
supersedes:
superseded_by:
enforced_by: "teste de integração sobre o manifest.json gerado (sem <all_urls>, sem CSP relaxada) — SPEC-0005/SPEC-0006"
---

# ADR-0007 — Identidade e acesso

<!-- ADR de base do pilar "Identidade e acesso" (catálogo SDD 2026.09). Fixa REGRAS verificáveis; a tecnologia é escolha do projeto (campos com chaves duplas). Ajuste as regras ao produto — remover uma regra exige registrar o motivo em Consequências — ou dispense o pilar em sdd-config.yml (pillars.waived). Só vira accepted com aprovação humana (H1). -->

## Contexto e Problema
Autenticação e autorização improvisadas em cada tela ou endpoint geram brechas difíceis de achar depois. A extensão não tem usuários nem login próprios; "identidade e acesso" aqui são as **permissões do Chrome** que ela pede (host permissions, downloads, webRequest) e, no roadmap, o OAuth do Google Drive via `chrome.identity`. Permissão ampla é o maior risco de segurança e de rejeição na loja.

## Direcionadores da Decisão
- Permissões mínimas (política da Web Store)
- Sem código remoto (MV3)
- OAuth do Drive só quando o épico existir

## Opções Consideradas
- **A.** `activeTab` + `optional_host_permissions` pedidos em runtime por site, `downloads`, `storage`; `webRequest` só no build que precisar
- **B.** `<all_urls>` fixo no manifesto

## Resultado da Decisão
**Opção escolhida:** "A. Permissões mínimas com opcionais em runtime", porque reduz o alerta de instalação e o escopo de revisão da loja; acesso a um site só quando o usuário aciona.

**Regras (verificáveis):**
- Autenticação: a extensão não autentica usuários nem armazena senhas/cookies; o OAuth futuro do Google Drive usa `chrome.identity` com escopo `drive.file` e token nunca persistido fora do cache do Chrome.
- Autorização negada por padrão; cada permissão é explícita.
- Menor privilégio para usuários, serviços e credenciais de CI.
- Tokens (só no épico Drive) com expiração gerida por `chrome.identity` e revogação pelo usuário.
- Manifesto sem `<all_urls>` em `host_permissions`; CSP padrão do MV3 sem `unsafe-eval`; nenhum script remoto.
- Mensagens entre contextos validadas (origem = a própria extensão; payload validado pelo schema do contrato).
- O plano de testes de cada spec com regra de acesso inclui o caso de acesso negado (ex.: permissão de site recusada; mensagem de origem externa rejeitada).
- Os riscos do OWASP Top 10 aplicáveis são checados na revisão (G4).

### Consequências
- **Boa**, porque a extensão só enxerga a aba em que o usuário clicou
- **Ruim**, porque detecção automática em segundo plano (sem clique) fica limitada até o usuário conceder o site

### Confirmação (G3)
Testes de autorização (acesso negado) nas specs; checklist de segurança no G4.

## Prós e Contras das Opções
| Critério (peso) | Mínimas + opcionais | `<all_urls>` |
|---|---|---|
| Aprovação na loja (5) | 5 | 2 |
| Segurança (5) | 5 | 2 |
| Experiência (detecção automática) (3) | 3 | 5 |
| **Total ponderado** | **59** | **35** |

## Mais Informações
Referências neutras: OWASP ASVS, OWASP Top 10. Chrome — Declare permissions / activeTab / optional permissions: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions (não verificado nesta data). Política da Web Store: permissões mínimas (consultado 2026-09-30).
