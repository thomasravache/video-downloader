---
id: SPEC-0007
title: Endurecer seleção de flavor e tipar FLAVOR
tier: lite
type: fix
user_facing: false
status: proposed
created: 2026-09-30
parent: SPEC-0001
depends_on: [SPEC-0002]
consumes_contract: []
touches: [wxt.config.ts, src/env.d.ts, tests/tooling/**]
adrs: [ADR-0011]
external: []
size: S
approved_by:
approved_at:
---

# SPEC-0007 — Endurecer seleção de flavor e tipar FLAVOR

<!-- Tier lite: bug fix ou mudança pequena, um módulo, sem mudança de contrato público, tamanho S. type: fix | feature | refactor. user_facing: true se o defeito aparece numa jornada do usuário (o teste de regressão deveria ser E2E). Se qualquer condição falhar, use o tier full. Substitua todos os marcadores com chaves duplas. -->

## 1. Problema
`FLAVOR=public wxt build --mode flavor-local` (ou o inverso) constrói silenciosamente um output cujo nome e sufixo de locale vêm de `FLAVOR`, mas cujo modo WXT diz outra coisa; a combinação deveria falhar. Além disso `import.meta.env.FLAVOR` não tem tipo declarado, embora o contrato da SPEC-0002 prometa `'public' | 'local'`. Como ADR-0011 depende do flavor correto para manter providers `local` fora do build da loja, uma discordância silenciosa é risco de publicação (mitigado a jusante pelo flavor-guard da SPEC-0006, mas deve falhar na origem). Achados minor do Reviewer da SPEC-0002.

## 2. Causa Raiz
`flavorFromEnv` em `wxt.config.ts` usa `process.env.FLAVOR ?? mode` sem comparar as duas fontes; e não existe `src/env.d.ts` com `ImportMetaEnv`.

## 3. Mudança Proposta
`flavorFromEnv` lança `FLAVOR inválido` quando `FLAVOR` e um modo conhecido (`public` ou `flavor-local`) divergem; novo `src/env.d.ts` tipando `ImportMetaEnv.FLAVOR`. NÃO muda scripts, nomes de modo nem o contrato de saída.

**Padrão seguido:** `wxt.config.ts` (`resolveFlavor`/`flavorFromEnv`) e `tests/tooling/flavor.test.ts` da SPEC-0002.

**Rollback:** revert do commit.

**Outras ocorrências:** Nenhuma

## 4. Plano de Testes (TDD)
<!-- Mínimo: um teste de regressão que reproduz o problema e FALHA antes da correção, no nível em que o defeito aparece (IT para fronteiras de I/O, E2E para jornadas de usuário). Código sem cobertura: primeiro CH-xx fixando o comportamento atual. Tag no código: `SPEC-0007:<ID>`. Categoria sem teste: "N/A — motivo" SEM ID. -->
- Caracterização: N/A — área já coberta pelos testes da SPEC-0002.
- **UT-01** — Dado `FLAVOR=public` e modo `flavor-local` (e o inverso), quando `flavorFromEnv` é chamado, então lança erro contendo "FLAVOR inválido"; com valores coerentes ou só o modo, retorna o flavor.
- **IT-01** — Com `pnpm typecheck`, um arquivo temporário que atribui `import.meta.env.FLAVOR` a `'public' | 'local'` compila e um que o atribui a `number` falha.

## 5. Questões em Aberto
<!-- Dúvidas que impedem fechar a spec, respondidas ANTES do H1. Aberta: `- [ ] pergunta (quem responde)`. Respondida: `- [x] pergunta — resposta (quem, data)`. Com alguma aberta o G0 reprova. Sem dúvidas: escreva "Nenhuma". Dúvida que surge depois da aprovação vira impedimento (seção Registro de Impedimentos). -->
Nenhuma

## 6. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado".

## 7. Checklist de Implementação
<!-- Preenchido na fase PLAN, após a aprovação. -->

## 8. Registro de Gates
<!-- Status: PENDING | PASS | FAIL | N/A. PASS e N/A exigem evidência. -->
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — 042e44f (árvore suja) | 2026-09-30 |
| G1 Red | PENDING | | |
| G2 Green | PENDING | | |
| G3 Arquitetura | PENDING | | |
| G4 Review | PENDING | | |
| G5 Integração & CI | PENDING | | |
| H2 Integração aprovada | PENDING | | |
| G6 Deploy | PENDING | | |
| G7 Pronto & Docs | PENDING | | |

## 9. Registro de Impedimentos
<!-- Toda parada é registrada pelo Architect com `spec_graph.py impede` e fechada com `resolve` — não edite à mão. Tipos: spec (spec errada/incompleta → resolve com Emenda) | decisão (só o humano decide → resposta ou ADR) | trabalho (falta algo que exige código → SPEC-NNNN nova) | externo (acesso, ambiente, terceiro → ação tomada) | falha (3 FAILs seguidos no mesmo gate → diagnóstico e decisão). Com impedimento aberto a spec aparece como parada no INDEX e não pode ser fechada. -->
| ID | Aberto em | Fase/Gate | Tipo | Descrição | Tentativas | Responsável | Resolução | Fechado em |
|---|---|---|---|---|---|---|---|---|

## 10. Relatório de Entrega
<!-- Preenchido no CLOSE (G7). Para status implemented o validate exige tudo preenchido, todo teste do plano com PASS + evidência e a Definição de Pronto marcada. -->

### O que foi entregue

### Como foi feito

### Prova de Correção
<!-- type fix: teste de regressão falhou antes (commit red + saída) e passa depois (commit green + execução). Outros tipos: "N/A". -->

### Verificação
| Teste | Comportamento | Resultado | Evidência |
|---|---|---|---|

### Definição de Pronto
- [ ] Teste de regressão falhou antes e passa depois da correção
- [ ] Suíte completa, arquitetura e CI verdes (G2, G3, G5)
- [ ] Review independente sem achados blocker/major (G4)
- [ ] Padrão existente mantido
- [ ] Disponível no ambiente-alvo via pipeline (G6)
- [ ] Documentação/CHANGELOG atualizados quando aplicável (G7)
- [ ] Outras ocorrências registradas como novas specs (ou nenhuma)

### Deploy

### Pendências

## 11. Emendas
<!-- Mudança em spec aprovada: uma linha por emenda, aprovada pelo humano. -->
| Versão | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
