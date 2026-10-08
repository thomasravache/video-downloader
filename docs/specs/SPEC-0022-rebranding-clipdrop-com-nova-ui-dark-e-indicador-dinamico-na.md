---
id: SPEC-0022
title: Rebranding ClipDrop com nova UI dark e indicador dinamico na toolbar
tier: full
type: feature
user_facing: true
status: in-progress
created: 2026-10-08
parent:
depends_on: []
consumes_contract: []
contract_version: 1
touches:
  - public/icon/**
  - public/_locales/**
  - entrypoints/popup/**
  - entrypoints/background/**
  - src/core/**
  - wxt.config.ts
  - tests/unit/**
  - tests/integration/**
  - e2e/**
adrs:
  - ADR-0001
  - ADR-0002
  - ADR-0010
external: []
size: M
approved_by: Thomas Ravache
approved_at: 2026-10-08
---

# SPEC-0022 — Rebranding ClipDrop com nova UI dark e indicador dinamico na toolbar

## 1. Visão Geral
Esta especificação introduz o rebranding da extensão de **"Video Downloader"** para **"ClipDrop"**, revitalizando a interface visual do popup para o padrão **Dark Media Lab / Studio** e implementando o **indicador dinâmico de detecção na toolbar** do Google Chrome via `chrome.action` (ícone ativo colorido com badge numérico em páginas com vídeos detectados vs. ícone inativo monocromático e sem badge em abas sem mídia).

Esta especificação é estritamente uma evolução visual e de identidade: **nenhuma nova funcionalidade além do indicador de toolbar é criada**, preservando 100% da arquitetura, das rotas de extração/transmuxing HLS, seletores de áudio/qualidade, diagnósticos e dos seletores semânticos/acessíveis (`data-testid`) existentes.

## 2. Motivação & Escopo
**Motivação:** A extensão possui motor técnico de alto desempenho (HLS fMP4, áudio empacotado AAC, MPEG-TS e junção com Mediabunny com compatibilidade nativa com QuickTime Player), porém sua apresentação visual é utilitária, monocromática e genérica ("Video Downloader"). A adoção da marca **ClipDrop**, uma interface escura refinada com alto contraste visual e o feedback imediato na barra de ferramentas aumentam drasticamente a clareza de uso e percepção de qualidade do usuário.

**Objetivos (dentro do escopo):**
- Renomear a extensão para **ClipDrop** nos catálogos de internacionalização (`public/_locales/pt_BR/messages.json` e `en/messages.json`), mantendo o sufixo ` (local)` intacto nos builds locais.
- Criar e integrar os ícones oficiais da marca ClipDrop (16, 32, 48, 128px):
  - Versão **ativa**: colorida em gradiente violeta/cobalto com símbolo da gota de mídia.
  - Versão **inativa**: cinza neutro monocromático (`#64748B`).
- Implementar indicador reativo na barra de ferramentas (`chrome.action`):
  - Aba com vídeos detectados: ícone ativo, badge numérico com a contagem de vídeos e fundo `#6366F1`.
  - Aba sem vídeos detectados: ícone inativo e badge limpo.
  - Sincronização automática em eventos de detecção, carregamento de rede e alternância de abas (`tabs.onActivated`, `tabs.onRemoved`).
- Revitalizar o CSS do popup (`entrypoints/popup/style.css` e `index.html`) para a estética **Dark Media Lab**:
  - Paleta base: Grafite profundo (`#0F1117`), cards elevados (`#1A1D24`) com bordas nítidas de 1px (`#262A34`).
  - Acentos cromáticos: Violeta (`#6366F1`), Azul Cobalto (`#3B82F6`), Verde Esmeralda (`#10B981`) para compatibilidade e Âmbar (`#F59E0B`) para áudio.
  - Manter todos os `data-testid` (`download-button`, `download-progress`, `copy-diagnostics`, `job-error`, etc.) e estrutura do DOM inalterados para estabilidade absoluta dos testes e automações.

**Não-objetivos (fora do escopo):**
- Nenhuma adição de funcionalidades não existentes (sem conversão de formatos não suportados, sem histórico em banco de dados, sem download em lote).
- Nenhuma alteração nos contratos de detecção (`src/core/contracts.ts`) ou nos pipelines de download/transmuxing offscreen.

## 3. Dependências
- **Implementações necessárias:** N/A
- **Contratos consumidos:** SPEC-0010@1, SPEC-0011@1, SPEC-0015@1, SPEC-0020@1, SPEC-0021@1
- **Pré-requisitos externos:** N/A

## 4. Decisão Arquitetural
**Contexto:** Projeto brownfield em TypeScript, WXT e Manifest V3. O service worker (`entrypoints/background/`) orquestra o estado efêmero e gerencia as chamadas às APIs de extensões do navegador (ADR-0001, ADR-0010).

**Decisão:**
1. Criar um módulo desacoplado em `entrypoints/background/action-indicator.ts` responsável por atualizar o ícone e badge por aba (`chrome.action.setIcon`, `chrome.action.setBadgeText`, `chrome.action.setBadgeBackgroundColor`), com tolerância a ambientes onde a API `action` é parcial (ex: mocks de teste e fakes do WXT).
2. Conectar a atualização do indicador aos pontos existentes de mudança de candidatos no background (`service.onNetworkResponse`, `service.handle({ type: 'detect' })`, `clearNetwork` e `tabs.onActivated`).
3. No popup, manter o contrato e fluxo do `view.ts` intactos, aplicando as classes e variáveis de CSS moderno baseadas em tokens dark no `style.css`.

**Justificativa:** Mantém a separação de responsabilidades (ADR-0001), garante execução leve sem overhead de memória e não quebra a suíte de testes unitários ou E2E existente.

**Desvio do padrão existente:** Nenhum.

**Alternativas descartadas:**
- Alterar o DOM do popup para frameworks externos (ex: Tailwind/React): Rejeitado para preservar o carregamento instantâneo do popup com Vanilla DOM e zero dependências pesadas adicionais.

**ADRs:** ADR-0001, ADR-0002, ADR-0010

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** Troca de ícone/badge com latência perceptível nula (<15ms) executada de forma assíncrona sem bloquear chamadas de rede.
- **Segurança:** Ícones empacotados localmente na extensão sem requisições remotas (ADR-0006).
- **Acessibilidade:** Relação de contraste WCAG AA (>4.5:1) em todos os textos claros sobre o fundo grafite escuro.
- **Privacidade:** Nenhuma informação do site além do ID da aba é transmitida para atualizar a toolbar.

## 6. Artefato A — Contrato
Contrato do módulo de indicador da barra de ferramentas (`entrypoints/background/action-indicator.ts`):

```typescript
export interface ActionPort {
  setIcon(details: { tabId?: number; path: Record<number, string> }): Promise<void> | void;
  setBadgeText(details: { tabId?: number; text: string }): Promise<void> | void;
  setBadgeBackgroundColor(details: { tabId?: number; color: string }): Promise<void> | void;
  setBadgeTextColor?(details: { tabId?: number; color: string }): Promise<void> | void;
}

export interface ActionIndicator {
  updateForTab(tabId: number, videoCount: number): Promise<void>;
  clearForTab(tabId: number): Promise<void>;
}

export function createActionIndicator(action?: ActionPort): ActionIndicator;
```

Tokens de design em `entrypoints/popup/style.css`:
```css
:root {
  color-scheme: dark;
  --bg: #0f1117;
  --surface: #1a1d24;
  --surface-hover: #222732;
  --border: #262a34;
  --fg: #f8fafc;
  --muted: #94a3b8;
  --accent: #6366f1;
  --accent-hover: #4f46e5;
  --accent-fg: #ffffff;
  --success: #10b981;
  --warn: #f59e0b;
}
```

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| Indicador ativo na toolbar | Aba possui `videoCount > 0` | `setIcon` com ícone colorido ativo, `setBadgeText` com contagem e fundo `#6366F1` | UT-01, IT-01, CT-01 |
| Indicador inativo na toolbar | Aba sem vídeos (`videoCount === 0`) ou resetada | `setIcon` com ícone cinza inativo e badge vazio | UT-02, IT-02, CT-01 |
| Resiliência a APIs parciais | Chamadas com `chrome.action` ausente ou aba inválida | Execução não lança exceção e tolera falhas silenciosamente | UT-03, CT-01 |
| Rebranding e tema Dark no CSS | Carregamento do popup | Tokens dark declarados, fundo grafite e acentos da marca ClipDrop | UT-04, E2E-01 |
| Preservação das funcionalidades existentes | Abertura do popup e download de vídeo | Título "ClipDrop" exibido, seletores existentes operacionais e download funcional | CH-01, E2E-01 |

## 7. Artefato B — Plano de Testes

### Testes de Caracterização
- **CH-01:** Suíte existente de popup (`tests/unit/popup-view-dedup.test.ts` e `e2e/journeys/download-video.spec.ts`) valida que todos os seletores de elementos, botões de download e diagnósticos continuam funcionando com 100% de sucesso.

### Testes Unitários
- **UT-01 (action-indicator.test.ts):** `createActionIndicator` define ícone ativo, badge numérico e cor de fundo `#6366F1` quando `videoCount > 0`. Tag: `SPEC-0022:UT-01`
- **UT-02 (action-indicator.test.ts):** `createActionIndicator` define ícone inativo cinza e limpa badge quando `videoCount === 0`. Tag: `SPEC-0022:UT-02`
- **UT-03 (action-indicator.test.ts):** Tratamento tolerante contra ausência da API ou erros em abas fechadas sem lançar exceções. Tag: `SPEC-0022:UT-03`
- **UT-04 (popup-theme.test.ts):** `style.css` declara paleta dark com tokens da marca ClipDrop e variáveis acessíveis. Tag: `SPEC-0022:UT-04`

### Testes de Integração
- **IT-01 (background-action.test.ts):** Ao receber resposta de rede com vídeo para a aba `tabId`, o background aciona o indicador da toolbar atualizando o badge para a quantidade de candidatos correspondente. Tag: `SPEC-0022:IT-01`
- **IT-02 (background-action.test.ts):** Ao fechar aba ou navegar para nova página principal, o indicador da toolbar para a aba é resetado para o estado inativo. Tag: `SPEC-0022:IT-02`

### Teste de Contrato
- **CT-01 (action-contract.test.ts):** Contrato `ActionIndicator` aceita objetos com interface `ActionPort` e tolera implementações do Chrome e Firefox sem quebra. Tag: `SPEC-0022:CT-01`

### Testes E2E
- **E2E-01 (e2e/journeys/clipdrop-branding.spec.ts):** [jornada: baixar-video-direto] Valida que o popup renderiza o título "ClipDrop", aplica tema dark visual nos cards e executa fluxo de download de vídeo com barra de progresso preservada. Tag: `SPEC-0022:E2E-01`

## 8. Plano de Rollout
- **Estratégia:** Deploy direto no branch principal através de release minor (v0.2.0-rc.1 ou patch v0.1.0-rc.9).
- **Dados/schema:** N/A.
- **Compatibilidade:** Totalmente compatível com Manifest V3 do Chrome.
- **Observabilidade:** Logs do diagnostics registram erros de atualização de action quando ocorrerem.
- **Rollback:** Reversão do commit de merge via Git caso necessário.
- **Etapas de migração/coexistência:** N/A.

## 9. Questões em Aberto
Nenhuma.

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
- [ ] Fase 0: Escrever teste de caracterização CH-01 confirmando passagem da suíte atual.
- [ ] Fase 1: Escrever testes Red (UT-01..04, IT-01..02, CT-01, E2E-01) com a tag `SPEC-0022:<ID>` e confirmar falha esperada (G1 Red).
- [ ] Fase 2: Criar ícones oficiais ClipDrop (ativo e inativo em 16, 32, 48, 128px) e implementar `entrypoints/background/action-indicator.ts`.
- [ ] Fase 3: Integrar o `action-indicator` ao ciclo de vida de eventos do background (`entrypoints/background/index.ts`).
- [ ] Fase 4: Atualizar os catálogos de locale com o nome "ClipDrop" e revitalizar o CSS do popup (`style.css` e `index.html`) para o tema Dark Media Lab.
- [ ] Fase 5: Executar suíte completa até Green (G2), validar arquitetura (G3) e conduzir code review independente (G4).

## 12. Registro de Gates
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — c4afddb (árvore suja) | 2026-10-08 |
| G1 Red | PASS | verify G1: PASS; `pnpm test` exit 1 (red: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/5]⎯) — d97a86a | 2026-10-08 |
| G2 Green | PASS | build exit 0 (✔ Finished in 299 ms); test exit 0 (Duration  56.00s (tests 97%, import 2%, transform 1%)); lint exit 0 (✔ Finished in 160 ms); coverage exit 0 (================================================================================) — 47ea3ee | 2026-10-08 |
| G3 Arquitetura | PASS | arch_test exit 0 (✔ no dependency violations found (65 modules, 141 dependencies cruised)) — a96081c | 2026-10-08 |
| G4 Review | PASS | verify G1+G4: PASS; revisão: Architect: APPROVED sem ressalvas — f39296a | 2026-10-08 |
| G5 Integração & CI | PASS | build exit 0 (✔ Finished in 285 ms); test exit 0 (Duration  54.84s (tests 97%, import 2%, transform 1%)); test_integration exit 0 (at least ~578ms faster with isolate: false — reuses workers across files instead of one pe); test_e2e exit 0 (pnpm exec playwright show-report); arch_test exit 0 (✔ no dependency violations found (65 modules, 141 dependencies cruised)); security_scan exit 0 ([90m2:43AM[0m [32mINF[0m [1mno leaks found[0m) — 25d022e | 2026-10-08 |
| H2 Integração aprovada | PASS | aprovado por Thomas Ravache (autorizado no chat para pilotar sozinho até o fim) | 2026-10-08 |
| G6 Deploy | PENDING | | |
| G7 Pronto & Docs | PENDING | | |

## 13. Registro de Impedimentos
| ID | Aberto em | Fase/Gate | Tipo | Descrição | Tentativas | Responsável | Resolução | Fechado em |
|---|---|---|---|---|---|---|---|---|

## 14. Relatório de Entrega

### O que foi entregue

### Como foi feito

### Prova de Correção

### Verificação
| Teste | Comportamento | Resultado | Evidência |
|---|---|---|---|

### Definição de Pronto
- [ ] Todos os testes do plano passando e listados na Verificação
- [ ] Todo comportamento do Mapa de Comportamentos coberto e verificado
- [ ] Suíte completa, arquitetura e CI verdes no resultado integrado (G5)
- [ ] Review independente sem achados blocker/major (G4)
- [ ] Padrão arquitetural existente mantido, ou desvio coberto por ADR aprovado
- [ ] Requisitos não-funcionais medidos com evidência (ou N/A justificado)
- [ ] Disponível no ambiente-alvo via pipeline, com smoke/E2E passando no ambiente (G6)
- [ ] Observabilidade e rollback prontos conforme o Plano de Rollout
- [ ] Documentação raiz e CHANGELOG atualizados (G7)
- [ ] Pendências registradas como novas specs (ou nenhuma)

### Deploy

### Pendências

## 15. Emendas
| Versão do contrato | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
