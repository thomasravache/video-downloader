---
id: SPEC-0023
title: Estabilizar detecção de vídeos e indicador da toolbar
tier: epic
type: feature
status: proposed
created: 2026-11-26
depends_on: []
adrs: [ADR-0001, ADR-0002, ADR-0007, ADR-0009, ADR-0012]
external: []
approved_by:
approved_at:
---

# SPEC-0023 — Estabilizar detecção de vídeos e indicador da toolbar (Épico)

## 1. Visão
A extensão funciona com a conta do dono, mas com outras contas logadas nos mesmos sites o vídeo não é detectado (flavor `local`, relato de 2026-11-26), e o ícone da toolbar tem bugs. Ao fim do épico, a detecção não depende do momento em que o popup é aberto, dos iframes da página, do Content-Type do servidor nem do service worker do site. O ícone da toolbar aparece sempre e mostra o mesmo número de vídeos que o popup lista.

## 2. Escopo
**Objetivos (dentro do escopo):**
- Corrigir os 10 defeitos de detecção achados na revisão (SPEC-0024).
- Corrigir os 8 defeitos do ícone e do indicador (SPEC-0025).
- Cobrir com testes os caminhos que a suíte atual (602 testes verdes) não exercita.

**Não-objetivos (fora do escopo):**
- Alinhar o popup e os ícones ao mockup "ClipDrop - Chrome Extension Popup" do Stitch: spec separada.
- Lógica específica de YouTube em `src/core/candidates.ts` (possível violação do ADR-0011) e typecheck só do flavor `public`: specs separadas.
- DASH, HLS ao vivo, DRM.

## 3. Arquitetura Alvo
**Contexto:** projeto existente; arquitetura do ADR-0001 (core puro em `src/core`, adaptadores do Chrome em `entrypoints/`) e do ADR-0010 (WXT, MV3). Nada muda de camada: o épico é de correção.

Fluxo ao final: `webRequest.onResponseStarted` → `classifyNetworkResponse` + `attributeTabs` (service worker) + `isManifestSegment` → `NetworkStore` (com `revision`) → `cardCount` → `ActionIndicator.updateForTab` (com geração). O popup faz `detect` (rede sempre incluída), depois consulta `network-revision` a cada 1 s e refaz o `detect` quando a revisão muda. A navegação real (`replacesDocument`) apaga a lista e reinicia a geração do indicador.

**Decisões (ADRs):** N/A — nenhuma decisão nova; aplica ADR-0001, ADR-0002, ADR-0007 (sem permissão nova), ADR-0009 (diagnóstico sem URL com query) e ADR-0012 (acesso por flavor).

**Regras de arquitetura a garantir (G3):** `src/core` não importa `entrypoints/` nem `wxt/browser`; código de provider específico de site não entra no build `public` (ADR-0011). Ambas já são verificadas por `pnpm arch` (dependency-cruiser).

## 4. Decomposição
| Spec | Título | Tier | Tipo | Tamanho | Depende de | Consome contrato de |
|---|---|---|---|---|---|---|
| SPEC-0024 | Detecção estável entre contas e páginas: falha parcial, re-detecção, rede e service worker | full | fix | M | — | — |
| SPEC-0025 | Indicador da toolbar confiável: ícones no manifesto, estado padrão e contagem única | full | fix | S | SPEC-0024 | — |

## 5. Estratégia de Entrega
- **Ambientes:** como hoje: CI em todo PR; a release (`pnpm build` + artefatos `extension-{public,local}-<versão>.zip`) pelo pipeline de release; o dono instala o build `local` a partir do GitHub Releases.
- **Entrega por onda:** onda 1 = SPEC-0024; onda 2 = SPEC-0025. As duas saem juntas na `0.1.0-rc.10`, depois do H2 da onda 2.
- **Feature flags:** N/A — correções de comportamento, sem caminho alternativo a manter.
- **Rollback:** reverter o merge do PR na `main` e reinstalar a `0.1.0-rc.9`.
- **Métricas de sucesso pós-release:** o dono testa com pelo menos uma das contas que falhavam; o "Copiar diagnóstico" não mostra `detect.restricted` com rede capturada nem `popup.detect_failed`.

## 6. Riscos & Mitigações
- A causa do relato pode estar em um defeito não listado, já que a reprodução com a conta que falha não foi feita — mitigação: os logs novos (`popup.detect_failed`, `network.sw_attributed`, `action.update_failed`) e o diagnóstico de uma conta que falhe depois da rc.10 apontam o próximo passo; achado novo vira spec.
- A atribuição por origem (service worker) pode pôr o mesmo vídeo em duas abas do mesmo site — mitigação: comportamento aceito pelo dono e coberto por UT-08 da SPEC-0024.
- O polling do popup pode redesenhar a lista enquanto o usuário escolhe uma qualidade — mitigação: a seleção dos cartões que continuam na lista é mantida, e um job em andamento nunca é redesenhado (SPEC-0024 UT-10).

## 7. Critérios de Aceite do Épico
- [ ] Um vídeo HLS que o player só pede depois de o popup estar aberto aparece sem reabrir o popup e é baixado como MP4 válido — SPEC-0024:E2E-01
- [ ] A jornada de vídeo direto continua funcionando — SPEC-0024:E2E-02
- [ ] A falha de um frame não esconde o vídeo capturado pela rede — SPEC-0024:IT-01
- [ ] Requisições do service worker do site entram na aba da mesma origem — SPEC-0024:IT-04
- [ ] O ícone ClipDrop está no manifesto dos dois flavors e o badge mostra o mesmo número do popup — SPEC-0025:E2E-01

## 8. Questões em Aberto
- [x] Escopo de contas e sintoma — outras contas no mesmo site, flavor `local`, vídeo não detectado (Thomas Ravache, 2026-11-26)
- [x] Re-detecção automática, service worker e Stitch — sim, sim, e Stitch fora (Thomas Ravache, 2026-11-26)

## 9. Aprovação (H1)
Uma aprovação humana cobre o épico e as specs filhas apresentadas junto com ele. Registrada no frontmatter (`approved_by`, `approved_at`) do épico e de cada filha.

## 10. Registro de Impedimentos
| ID | Aberto em | Fase/Gate | Tipo | Descrição | Tentativas | Responsável | Resolução | Fechado em |
|---|---|---|---|---|---|---|---|---|

## 11. Relatório de Entrega

## 12. Emendas
| Versão | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
