---
id: SPEC-0015
title: "Popup com um cartão por vídeo: fontes redundantes recolhidas e seletor de áudio"
tier: full
type: feature
user_facing: true
status: in-progress
created: 2026-10-02
parent: SPEC-0008
depends_on: []
consumes_contract: [SPEC-0013@1, SPEC-0014@1]
contract_version: 1
touches: [src/core/**, entrypoints/popup/**, public/_locales/**, e2e/support/**, e2e/journeys/**, e2e/fixtures/**, tests/unit/**, tests/integration/**]
adrs: [ADR-0006, ADR-0001]
external: []
size: M
approved_by: thomas
approved_at: 2026-10-02
---

# SPEC-0015 — Popup com um cartão por vídeo: fontes redundantes recolhidas e seletor de áudio

## 1. Visão Geral
Numa aula de curso o popup lista hoje até 11 cartões para o mesmo vídeo: a playlist master, as playlists de cada qualidade e do áudio, e os arquivos `.mp4` soltos que essas playlists usam. Depois da SPEC-0014 o cartão master já baixa vídeo com áudio; esta spec deixa **esse cartão em destaque** e **recolhe** os redundantes numa seção "Outras fontes (N)" (sem apagá-los: continuam baixáveis como alternativa), e acrescenta um **seletor de áudio** quando a master tem mais de um idioma.

## 2. Motivação & Escopo
**Motivação:** prints do teste manual da rc.2 (2026-10-02): `…_1080p.mp4`, `…_480p.mp4`, `…_en_192k.mp4`, `…_1080p.m3u8`, `…_480p.m3u8`, `…_en_192k.m3u8` e a master, todos com botão Download, sem indicação de qual baixar.

**Objetivos (dentro do escopo):**
- Identificar, para cada master resolvida, os cartões que são variantes/áudio dela ou arquivos de mídia referenciados por essas playlists, e exibi-los recolhidos sob o cartão master.
- Seletor "Áudio" quando o grupo da variante escolhida tem mais de uma faixa, enviando `audioIndex` (contrato da SPEC-0014).
- Buscar playlists extras **só quando necessário** (há cartões candidatos a redundância na aba) e dentro de limites fixos.

**Não-objetivos (fora do escopo):**
- Apagar fontes da lista (nada some; só é recolhido).
- Agrupar cartões sem master (heurística por nome de arquivo).
- Mudar o download, a junção ou as recusas de segurança (SPEC-0012/0013/0014).

## 3. Dependências
- **Implementações necessárias:** N/A (vínculo por contrato).
- **Contratos consumidos:** SPEC-0013@1 (`hideRedundantCandidates`, regra do `blob`); SPEC-0014@1 (`HlsInfo.audio`, `HlsVariant.audioGroup`, `chooseAudio`, `download.audioIndex`). Execução **depois** da SPEC-0014.
- **Pré-requisitos externos:** N/A.

## 4. Decisão Arquitetural
**Contexto:** a regra de exibição fica em funções puras de `src/core/candidates.ts` (como `hideRedundantCandidates` da SPEC-0013), e o popup (`entrypoints/popup/{main,view}.ts`) só renderiza; o `quality-select` existente é o padrão do novo `audio-select`.

**Decisão:** (1) `groupCandidates(list)` devolve `{ primary, related[] }[]` preservando a ordem do primeiro elemento de cada grupo; (2) o resolve da master ganha `mediaResources` (origem+caminho dos arquivos de mídia citados nas playlists de variante/áudio buscadas), com as buscas extras feitas **só** se houver na aba candidatos `file`/`hls` não-master da mesma origem; (3) `view.ts` renderiza `related` dentro de um `<details>` "Outras fontes (N)" fechado por padrão.

**Justificativa:** recolher em vez de remover preserva o fallback que funcionou no teste manual; buscas condicionadas evitam tráfego extra em páginas comuns.

**Desvio do padrão existente:** Nenhum.

**Alternativas descartadas:** remover os redundantes (perde o fallback); buscar sempre todas as playlists ao abrir o popup (tráfego e cookies sem necessidade); agrupar por prefixo de nome (frágil).

**ADRs:** ADR-0006, ADR-0001.

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** buscas extras só com candidatos relacionáveis na aba; no máximo 4 playlists de variante e 4 de áudio, em paralelo, 10 s e 1 MiB cada; o cartão master aparece antes das buscas extras terminarem (o agrupamento é refeito quando chegam).
- **Segurança:** nenhuma regra de download muda; `mediaResources` só guarda origem+caminho; nomes de faixa como texto (`textContent`).
- **Privacidade e dados pessoais:** query/token nunca em `mediaResources`, diagnósticos ou erros (IT-02).
- **Disponibilidade e resiliência:** falha numa busca extra só deixa de agrupar aquele recurso; nada falha.
- **Acessibilidade (UI):** `<details>`/`<summary>` nativo com texto acessível; `audio-select` com `label` e teclado; axe sem violações sérias (E2E-01).
- **Custo:** N/A — sem serviços pagos.

## 6. Artefato A — Contrato
**Interface:** `groupCandidates(list): CandidateGroup[]` (src/core/candidates.ts); `HlsInfo.mediaResources` (aditivo); popup (`related-sources`, `audio-select`).

```text
// HlsInfo (aditivo):
mediaResources?: string[]   // origem+caminho (sem query/fragmento) dos arquivos de mídia citados pelas
                            // playlists de variante/áudio buscadas no resolve; únicos; máx. 32

// Resolve da master: buscas extras (<= 4 variantes, <= 4 áudios) SÓ se a lista da aba tem algum candidato
// file/hls que não é a própria master, com a mesma origem da master. Falha numa busca extra é ignorada.

interface CandidateGroup { primary: VideoCandidate; related: VideoCandidate[] }
groupCandidates(list):
  para cada master HLS resolvida M (na ordem), related(M) = candidatos que
   (a) são HLS com origem+caminho de uma variante ou faixa de áudio de M, ou
   (b) são 'file' com origem+caminho em M.hls.mediaResources;
  um candidato entra em no máximo um grupo (o da primeira master que o reivindicar);
  os demais candidatos viram grupos de um elemento (related = []);
  aplica antes a regra do blob da SPEC-0013; preserva a ordem; não muta a entrada.

// Popup
cartão primary como hoje; se related.length > 0: <details data-testid="related-sources"> fechado,
  <summary> "Outras fontes (N)" (i18n relatedSources), cartões related dentro, com seus botões normais.
audio-select (label i18n audioLabel): só quando o grupo da variante selecionada tem > 1 faixa;
  opções = nome (+ idioma); padrão = chooseAudio sem índice; trocar a qualidade recalcula as opções;
  o download envia audioIndex da opção escolhida. Com 1 faixa, mantém o "Inclui áudio" da SPEC-0014.
```

**Design:** cartão master no topo do grupo; abaixo, linha recolhível "Outras fontes (N)"; seletor "Áudio" logo abaixo de "Qualidade". Chaves i18n novas em pt_BR e en: `relatedSources`, `audioLabel`.

**Arquivos/módulos afetados:** ver `touches`.

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| Agrupar | master resolvida + variantes, áudio e arquivos citados | um grupo com a master e N relacionados | UT-01, E2E-01 |
| Não agrupar | sem master resolvida, ou candidatos sem relação | grupos de um elemento; nada some | UT-02 |
| Duas masters | candidato reivindicado por ambas | fica só no grupo da primeira | UT-03 |
| Recursos de mídia | playlists com query/token, repetidos, > 32 | origem+caminho únicos, ≤ 32 | UT-04 |
| Seletor de áudio | grupo com 2 faixas / 1 faixa / troca de qualidade | seletor / "Inclui áudio" / opções recalculadas | UT-05, E2E-02 |
| Buscas condicionadas | aba sem candidatos relacionáveis / com | nenhuma busca extra / até 4+4 | IT-01 |
| Privacidade | URLs com token | sem token em `mediaResources`, diagnósticos e erros | IT-02 |
| Falha extra | uma playlist extra 404 | resolve ok; recurso não agrupado | IT-01 |
| Compatibilidade | `HlsInfo` sem `mediaResources` | continua válido | CT-01 |

## 7. Artefato B — Plano de Testes (TDD)

### 7.1 Testes de Caracterização
N/A — a ordem e o conteúdo atuais da lista são cobertos pelos E2E das SPEC-0005/0009/0010/0011; UT-02 fixa que nada some sem master.

### 7.2 Testes Unitários
- **UT-01** — Dado uma master resolvida com variantes `…_1080p.m3u8`/`…_480p.m3u8`, áudio `…_en_192k.m3u8` e `mediaResources` com os três `.mp4`, e a lista com esses seis cartões e a master, quando `groupCandidates` roda, então há um grupo com a master como `primary` e os seis em `related`, na ordem original.
- **UT-02** — Dado listas sem master resolvida ou com cartões de outra origem/caminho, quando `groupCandidates` roda, então todos viram grupos de um elemento e a contagem total de candidatos é preservada.
- **UT-03** — Dado duas masters que citam o mesmo arquivo, quando agrupadas, então o arquivo aparece só no grupo da primeira.
- **UT-04** — Dado playlists com `…/arq.mp4?token=x&expires=1#f` repetidas e mais de 32 recursos, quando `mediaResources` é derivado, então contém origem+caminho únicos, sem query/fragmento, no máximo 32.
- **UT-05** — Dado um grupo de áudio com 2 faixas (uma default), 1 faixa, e variantes com grupos diferentes, quando as opções do seletor são calculadas, então há 2 opções com a default marcada, nenhum seletor com 1 faixa, e as opções mudam com a variante.

### 7.3 Testes de Integração
- **IT-01** — Dado uma master com 3 variantes e 2 áudios, quando o resolve roda numa aba sem candidatos relacionáveis, então não há busca extra; numa aba com eles, há no máximo 4+4 buscas, `mediaResources` é preenchido, e uma playlist extra com 404 não falha o resolve.
- **IT-02** — Dado playlists e mídias com `?token=…`, quando o resolve conclui, então `mediaResources`, diagnósticos e erros não contêm o token.

### 7.4 Testes de Contrato
- **CT-01** — Dado `HlsInfo` da SPEC-0014@1 sem `mediaResources` e mensagens `download` sem `audioIndex`, quando validados, então continuam aceitos.

### 7.5 Testes E2E
- **E2E-01** — Dado a página de fixture com master, variantes, áudio e os `.mp4` soltos observados na rede [jornada: baixar-hls], quando o popup abre, então há um cartão master visível e uma seção "Outras fontes (N)" fechada com os demais, que ao abrir mostra cartões ainda baixáveis; axe sem violações sérias.
- **E2E-02** — Dado uma master com áudio en e pt, quando o usuário escolhe "pt" no seletor "Áudio" e baixa, então o MP4 salvo tem a trilha de áudio com idioma `por`.

### 7.6 Outros
- **Acessibilidade:** axe no E2E-01 com a seção aberta e fechada.

**Dublês e dados de teste:** fixtures `e2e/fixtures/hls/split-av/` da SPEC-0014, acrescidas de uma segunda faixa de áudio (`-metadata:s:a language=por`) e uma página que também busca os `.mp4` soltos.

**Ambiente de execução:** Vitest e Playwright com Chromium real, local e no CI.

## 8. Plano de Rollout
- **Estratégia:** deploy direto na próxima rc; sem flag.
- **Dados/schema:** N/A.
- **Compatibilidade:** campos aditivos; sem master resolvida a lista fica como hoje.
- **Observabilidade:** nenhum evento novo.
- **Rollback:** reverter o PR e publicar nova rc.
- **Etapas de migração/coexistência:** N/A.

## 9. Questões em Aberto
Nenhuma. (Premissa a confirmar no H1: os redundantes ficam recolhidos, não removidos.)

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
<!-- Preenchido na fase PLAN, após a aprovação. Cada fase começa pelos testes. -->
**Fase 1: Agrupamento e seletor**
- [ ] Red: UT-01..UT-05, CT-01, IT-01, IT-02 com a tag `SPEC-0015:<ID>`
- [ ] Green: `groupCandidates`, `mediaResources`, buscas condicionadas, popup (`related-sources`, `audio-select`), i18n pt_BR/en
- [ ] Refactor e validar: build + suíte + arquitetura (G2/G3)

**Fase 2: Jornada E2E**
- [ ] Red: E2E-01 e E2E-02 falhando pelo motivo certo
- [ ] Green: jornada completa nos dois flavors, 3 execuções sem flake

**Fase final: Integração, entrega e documentação**
- [ ] Review independente (G4)
- [ ] Integração + CI verde (G5) e aprovação (H2)
- [ ] Release rc com smoke/E2E no pipeline e teste manual do Thomas (G6)
- [ ] Relatório de Entrega, docs raiz e CHANGELOG (G7)


## 12. Registro de Gates
<!-- Status: PENDING | PASS | FAIL | N/A. PASS e N/A exigem evidência (comando + resultado, SHA, execução de CI, veredito). -->
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — 2482d6e (árvore suja) | 2026-10-02 |
| G1 Red | PENDING | | |
| G2 Green | PENDING | | |
| G3 Arquitetura | PENDING | | |
| G4 Review | PENDING | | |
| G5 Integração & CI | PENDING | | |
| H2 Integração aprovada | PENDING | | |
| G6 Deploy | PENDING | | |
| G7 Pronto & Docs | PENDING | | |

## 13. Registro de Impedimentos
<!-- Toda parada é registrada pelo Architect com `spec_graph.py impede` e fechada com `resolve` — não edite à mão. Tipos: spec (spec errada/incompleta → resolve com Emenda) | decisão (só o humano decide → resposta ou ADR) | trabalho (falta algo que exige código → SPEC-NNNN nova) | externo (acesso, ambiente, terceiro → ação tomada) | falha (3 FAILs seguidos no mesmo gate → diagnóstico e decisão). Com impedimento aberto a spec aparece como parada no INDEX e não pode ser fechada. -->
| ID | Aberto em | Fase/Gate | Tipo | Descrição | Tentativas | Responsável | Resolução | Fechado em |
|---|---|---|---|---|---|---|---|---|

## 14. Relatório de Entrega
<!-- Preenchido no CLOSE (G7). Diz o que foi feito, como, e prova que foi resolvido. Para status implemented o validate exige todas as subseções preenchidas, todo teste do plano com PASS + evidência e a Definição de Pronto toda marcada. -->

### O que foi entregue
<!-- comportamento entregue do ponto de vista do usuário/sistema -->

### Como foi feito
<!-- decisões de implementação, módulos/arquivos principais, desvios e emendas (com versão), dívidas assumidas -->

### Prova de Correção
<!-- type fix: o teste de regressão falhou antes da correção (commit red + saída) e passa depois (commit green + execução). Outros tipos: "N/A". -->

### Verificação
<!-- Uma linha por teste do plano (todos os IDs da seção 7). Resultado: PASS. Evidência: execução de CI, commit ou relatório. -->
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
<!-- ambiente(s), versão/tag, data, estratégia, estado da feature flag, execução do pipeline -->

### Pendências
<!-- specs criadas para o que ficou de fora, ou "Nenhuma" -->

## 15. Emendas
<!-- Mudança em spec aprovada: uma linha por emenda. Mudou o contrato? Incremente `contract_version` e rode `spec_graph.py impacted SPEC-0015`. -->
| Versão do contrato | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
