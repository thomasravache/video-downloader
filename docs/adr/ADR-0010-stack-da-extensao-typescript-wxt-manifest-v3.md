---
id: ADR-0010
title: "Stack da extensão: TypeScript + WXT (Manifest V3)"
status: accepted
origin: decision
date: 2026-09-30
pillars: []
decision_makers: [Thomas]
consulted: []
informed: []
supersedes:
superseded_by:
enforced_by: "typecheck (tsc --noEmit) e build WXT no CI (SPEC-0004); dependency-cruiser (ADR-0001)"
---

# ADR-0010 — Stack da extensão: TypeScript + WXT (Manifest V3)

## Contexto e Problema
Precisamos de uma extensão do Chrome em Manifest V3 (único formato aceito pela Web Store) com vários contextos — content script, service worker, popup e, no roadmap, offscreen document — trocando mensagens tipadas, gerando **dois builds** (`public`/`local`) do mesmo código e testável com a extensão carregada num Chrome real. O mantenedor domina .NET e já trabalhou com TypeScript, e pediu a tecnologia mais compatível caso .NET complicasse.

## Direcionadores da Decisão
- Compatibilidade nativa com a plataforma de extensões (MV3, service worker, content scripts, `chrome.*`).
- Tipagem forte nos contratos entre contextos (familiar para quem vem de C#).
- Build por variante (`public`/`local`) e manifesto gerado por código.
- Manutenção ativa e ecossistema de testes (unitário + E2E com extensão carregada).
- Curva de aprendizado razoável para quem já usou TypeScript.

## Opções Consideradas
- **A. TypeScript + WXT** (framework de extensões sobre Vite)
- **B. TypeScript + Vite + @crxjs/vite-plugin**
- **C. TypeScript + Plasmo**
- **D. C# + Blazor WebAssembly (Blazor.BrowserExtension)**

## Resultado da Decisão
**Opção escolhida:** "A. TypeScript + WXT", porque gera o manifesto MV3 a partir de código (permite variar permissões e providers por build via modos/ambiente), organiza os contextos como `entrypoints/`, tem utilitários de teste com Vitest (`wxt/testing`, com fake de `browser.*`) e está em manutenção ativa. .NET (D) foi descartado: exige carregar o runtime WASM (vários MB) em cada contexto, não roda em content scripts de forma prática, complica o service worker efêmero do MV3 e aumenta o risco de revisão na loja.

Stack resultante: TypeScript (strict) · WXT · Vite · Vitest · Playwright (E2E com `--load-extension`) · dependency-cruiser · ESLint + Prettier · pnpm.

### Consequências
- **Boa**, porque contratos entre content script, background e popup são tipos compartilhados verificados em compilação.
- **Boa**, porque um único `wxt build --mode public|local` produz as variantes sem duplicar código.
- **Ruim**, porque o mantenedor sai do ecossistema .NET: mitigado por TS strict, estrutura por módulos (parecida com projetos/namespaces) e testes como documentação.
- **Ruim**, porque WXT ainda é 0.x (API pode mudar entre minors) — versão fixada e atualizada por PR (ADR-0008).

### Confirmação (G3)
CI executa `tsc --noEmit` (strict) e `wxt build` para os dois modos; dependency-cruiser (ADR-0001) garante as fronteiras. Uso de framework/bundler diferente exige ADR que substitua este.

## Prós e Contras das Opções
| Critério (peso) | A. WXT | B. Vite + CRXJS | C. Plasmo | D. Blazor |
|---|---|---|---|---|
| Aderência ao MV3 / contextos (5) | 5 | 4 | 4 | 2 |
| Builds por variante e manifesto por código (4) | 5 | 3 | 4 | 2 |
| Manutenção ativa (4) | 5 | 4 | 2 | 3 |
| Testes (unitário + E2E) (4) | 5 | 3 | 3 | 2 |
| Familiaridade do mantenedor (3) | 3 | 3 | 3 | 5 |
| Tamanho do bundle / desempenho (3) | 5 | 5 | 4 | 1 |
| Risco na revisão da loja (2) | 5 | 5 | 5 | 3 |
| **Total ponderado** | **118** | **98** | **89** | **60** |

## Mais Informações
Versões verificadas no registro npm em 2026-09-30 (`npm view`):
- wxt 0.21.4 (publicado/atualizado 2026-08-11) — ativo.
- vite 8.3.1 (2026-09-24); @crxjs/vite-plugin 3.0.0 (2026-09-24) — ativo.
- plasmo 0.90.5 — última atualização 2025-05-17 (sem manutenção há ~16 meses → penalizado).
- typescript 7.0.2 (2026-09-30); vitest 5.0.3 (2026-09-30); @playwright/test 1.63.0 (2026-09-30).
- Node.js local 26.3.1; CI usará a LTS ativa (confirmar em SPEC-0002).
- Chrome Web Store Program Policies — https://developer.chrome.com/docs/webstore/program-policies/policies (consultado 2026-09-30): MV3, permissões mínimas, política de privacidade obrigatória se houver dados do usuário.
- Blazor.BrowserExtension — não verificado em detalhe (descartado pelos direcionadores de tamanho e contexto).
