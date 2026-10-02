---
id: ADR-0012
title: "Permissões por flavor: acesso amplo no local, por site no público"
status: accepted
origin: user
date: 2026-10-02
pillars: [seguranca-acesso]
decision_makers: [Thomas]
consulted: []
informed: []
supersedes:
superseded_by:
enforced_by: "teste de integração sobre o manifest.json gerado de cada flavor (SPEC-0009:IT-05) + teste de que o bundle público não declara host_permissions"
---

# ADR-0012 — Permissões por flavor: acesso amplo no local, por site no público

## Contexto e Problema
O ADR-0007 fixou permissões mínimas (`activeTab`, sem `host_permissions`). Isso basta para o documento principal da aba, mas não para o que o produto precisa fazer: ver `<video>` dentro de iframes de **outro domínio** (comum em plataformas de curso) e observar requisições de rede (`webRequest`) para achar mídia que nunca aparece no DOM (players com MSE/`blob:`). Ambos exigem permissão de host. A política da Chrome Web Store exige "the narrowest permissions necessary" e permissão ampla sujeita o build público a revisão mais dura. A decisão do usuário (2026-10-02) foi: acesso amplo só no build local; por site e em tempo de uso no público.

## Direcionadores da Decisão
- Detecção completa (iframes, rede) no build `local`, sem fricção.
- Build `public` aprovável na loja: aviso de instalação leve, acesso concedido pelo usuário, site a site.
- Uma única base de código; a diferença é só o manifesto por flavor (ADR-0011).
- Permissões concedidas ficam sob controle do Chrome, e a extensão não as persiste.

## Opções Consideradas
- **A.** `local`: `host_permissions` para `http://*/*` e `https://*/*`; `public`: `optional_host_permissions` com os mesmos padrões, pedidas por origem via `permissions.request` com gesto do usuário.
- **B.** Os dois builds com `host_permissions` amplo.
- **C.** Os dois builds só com `activeTab`, aceitando não ver iframes de outro domínio nem a rede.

## Resultado da Decisão
**Opção escolhida:** "A", por escolha do usuário (origin: user), que mantém a detecção completa onde a loja não está em jogo e o menor privilégio onde está.

**Regras (verificáveis):**
- Manifesto `local`: `host_permissions: ["http://*/*", "https://*/*"]`; sem `optional_host_permissions`.
- Manifesto `public`: sem `host_permissions`; `optional_host_permissions: ["http://*/*", "https://*/*"]`; a extensão só pede origens que a própria página principal referencia como iframe, nunca `*` inteiro.
- Pedido de permissão apenas por gesto do usuário (clique no popup), com a lista de origens à vista.
- A extensão não armazena as permissões concedidas nem as origens fora de `storage.session`.
- `activeTab`, `scripting`, `downloads`, `storage` permanecem; novas permissões (`webRequest`, `offscreen`) só entram com a spec que as usa.
- Esta regra refina a de host permissions do ADR-0007; o resto do ADR-0007 continua valendo.

### Consequências
- **Boa**, porque o build local detecta vídeos em iframes e na rede sem passos extras.
- **Boa**, porque o build público mantém o aviso de instalação mínimo e o acesso é concedido por site.
- **Ruim**, porque o comportamento difere entre os flavors (o público pede acesso por site), o que exige testes e documentação nos dois.
- **Ruim**, porque o diálogo nativo de permissão não é automatizável: o fluxo de concessão é verificado manualmente no G6.

### Confirmação (G3)
Teste de integração sobre o `manifest.json` de cada build (SPEC-0009:IT-05) e o teste existente de que o público não tem `host_permissions` (SPEC-0005:IT-04, atualizado por SPEC-0009).

## Prós e Contras das Opções
| Critério (peso) | A. por flavor | B. amplo nos dois | C. só activeTab |
|---|---|---|---|
| Aprovação na loja (5) | 5 | 2 | 5 |
| Cobertura de detecção (5) | 5 | 5 | 1 |
| Privacidade/menor privilégio (4) | 4 | 2 | 5 |
| Simplicidade (2) | 3 | 5 | 5 |
| **Total ponderado** | **76** | **57** | **61** |

## Mais Informações
- Chrome Web Store Program Policies: "Request access to the narrowest permissions necessary to implement your Product's features" (consultado 2026-09-30).
- `optional_host_permissions` e `permissions.request` — https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions (a confirmar na SPEC-0009).
- `activeTab`: a documentação (consultada em 2026-10-02) não esclarece se cobre iframes de outro domínio; o desenho não depende disso.
