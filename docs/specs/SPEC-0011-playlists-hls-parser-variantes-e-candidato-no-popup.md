---
id: SPEC-0011
title: "Playlists HLS: parser, variantes e candidato no popup"
tier: full
type: feature
user_facing: true
status: in-progress
created: 2026-10-02
parent: SPEC-0008
depends_on: []
consumes_contract: [SPEC-0010@1]
contract_version: 1
touches: [package.json, pnpm-lock.yaml, wxt.config.ts, .dependency-cruiser.cjs, src/core/**, entrypoints/**, public/_locales/**, e2e/support/**, e2e/journeys/**, e2e/fixtures/**, tests/unit/**, tests/integration/**]
adrs: [ADR-0013, ADR-0012, ADR-0008, ADR-0006, ADR-0001]
external: []
size: M
approved_by: thomas
approved_at: 2026-10-02
---

# SPEC-0011 — Playlists HLS: parser, variantes e candidato no popup

<!-- type: feature | fix | refactor | migration | foundation. user_facing: true quando a mudança altera uma jornada do usuário (UI ou API pública) — exige teste E2E. Substitua todos os marcadores com chaves duplas: o G0 (`spec_graph.py validate`) reprova a spec enquanto restar algum. As seções de Checklist em diante são preenchidas depois da aprovação, sem marcadores. -->

## 1. Visão Geral
Quando a rede revela uma playlist HLS (`.m3u8`), a extensão a **lê e interpreta**: busca a playlist (e a da melhor variante), extrai as qualidades (resolução/banda), a duração e os sinais que impedem o download — criptografia (`EXT-X-KEY`, `EXT-X-SESSION-KEY`) e transmissão ao vivo. O popup mostra um seletor de qualidade e marca os casos protegidos ou ao vivo. Esta spec **não baixa**: ela prepara o candidato HLS que a SPEC-0012 baixa.

## 2. Motivação & Escopo
**Motivação:** HLS é o formato de entrega da maioria das plataformas de vídeo e de curso. Para baixar com segurança é preciso decidir, antes, o que é baixável (sem criptografia, VOD) e deixar o usuário escolher a qualidade.

**Objetivos (dentro do escopo):**
- Dependência `m3u8-parser` 7.2.0 (ADR-0013), restrita a `src/core`.
- `parseHlsPlaylist(text, baseUrl)` → `HlsInfo`: tipo (`master` | `media`), variantes ordenadas da maior para a menor banda com rótulo (`1080p`, `720p`, ou `<kbps> kbps`), duração, contagem de segmentos, `encrypted`, `live`, `fmp4` (presença de `EXT-X-MAP`), URLs resolvidas contra a base.
- Mensagem `resolveHls` do popup para o background: busca a playlist (requisição própria da extensão, limites de tamanho e tempo), para master busca também a playlist da melhor variante para detectar criptografia/ao vivo.
- `VideoCandidate` do tipo `hls` ganha `hls: HlsInfo` depois de resolvido; `protection` ganha o valor `encrypted`; ao vivo vira `unsupported-stream`.
- Popup: estado "lendo playlist", seletor de qualidade (`quality-select`) com padrão na maior, selos de protegido/ao vivo/erro; botão Baixar ainda indisponível para HLS até a SPEC-0012.

**Não-objetivos (fora do escopo):**
- Baixar segmentos ou montar arquivo (SPEC-0012); DASH; legendas e faixas de áudio alternativas; HLS criptografado ou DRM (recusados, sem contorno — decisão de 2026-10-02).

## 3. Dependências
- **Implementações necessárias:** SPEC-0010 — candidatos de rede `kind: 'hls'`, `source`, `VideoCandidate` v3 e permissões de rede.
- **Contratos consumidos:** N/A
- **Pré-requisitos externos:** `m3u8-parser` 7.2.0 (Apache-2.0) instalado com versão fixa.

## 4. Decisão Arquitetural
**Contexto:** ADR-0013 (m3u8-parser em `src/core`, regras de criptografia e ao vivo), ADR-0012, ADR-0008 (dependência nova com versão fixa), ADR-0006, ADR-0001.

**Decisão:** o parse é puro em `src/core/hls` sobre `m3u8-parser`; a busca da playlist é uma porta (`PlaylistFetcherPort`) implementada em `entrypoints/background` com `fetch` (`credentials: 'include'` para playlists que dependem de cookie do site, com host permission do flavor); o popup só conversa por mensagens.

**Justificativa:** reaproveita a arquitetura de portas e mantém `src/core` testável sem navegador.

**Desvio do padrão existente:** primeira requisição de rede **iniciada pela própria extensão** (além do download): limitada à URL de playlist observada na própria aba, sem enviar nada a terceiros; o teste SPEC-0005:IT-06 (que exigia nenhuma requisição além do download) é atualizado para permitir exatamente isso.

**Alternativas descartadas:** parser próprio (reinventa casos de borda); resolver as playlists dentro do `detect` (deixaria a primeira abertura lenta).

**ADRs:** ADR-0013, ADR-0012, ADR-0008, ADR-0006, ADR-0001.

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** playlist ≤ 1 MiB e timeout de 10 s por requisição; `parseHlsPlaylist` de 5.000 segmentos < 50 ms — UT-02, IT-02.
- **Segurança:** só `http(s)`; `fetch` segue os redirecionamentos pelo navegador (`redirect: 'follow'`, limite próprio do Chrome) e a resposta só é aceita se a URL final (`response.url`) for `http(s)` — o teto de 3 redirecionamentos foi retirado por não ser implementável em service worker (Emenda 1); nenhuma URL vinda do conteúdo da playlist é seguida nesta spec além da playlist da melhor variante (que precisa ser do mesmo tipo `http(s)`); respostas gigantes ou não-texto são recusadas — IT-02.
- **Privacidade e dados pessoais:** URLs e tokens só em memória/`storage.session`; logs sem query; nenhuma requisição além das playlists observadas — IT-03.
- **Disponibilidade e resiliência:** falha de rede/parse vira erro tratado no popup (`HLS_FETCH_FAILED`/`HLS_PARSE_FAILED`), sem travar a lista — IT-01.
- **Acessibilidade (UI):** `quality-select` com rótulo, operável por teclado, anunciado por leitores de tela; axe sem violações — E2E-01.
- **Custo:** N/A.

## 6. Artefato A — Contrato
**Interface:** `parseHlsPlaylist` · `HlsInfo` · mensagem `resolveHls` · `VideoCandidate.hls` · popup

```ts
// src/core/hls — HlsInfo (versão 1)
interface HlsVariant { index: number;   /* posição na lista ORDENADA por banda decrescente: 0 = maior qualidade; é o `variantIndex` da SPEC-0012 */ url: string; bandwidth: number; width?: number; height?: number; codecs?: string; label: string }
interface HlsInfo {
  type: 'master' | 'media';
  variants: HlsVariant[];            // master: da maior para a menor banda; media: [] (a própria playlist é a única qualidade)
  durationSec?: number;              // playlist de mídia resolvida (soma dos EXTINF)
  segmentCount?: number;
  encrypted: boolean;                // qualquer EXT-X-KEY com METHOD ≠ NONE (inclui SAMPLE-AES) ou EXT-X-SESSION-KEY
  live: boolean;                     // sem EXT-X-ENDLIST
  fmp4: boolean;                     // EXT-X-MAP presente
}
function parseHlsPlaylist(text: string, baseUrl: string): HlsInfo     // lança HlsParseError('HLS_PARSE_FAILED') se vazio/inválido
// label: altura conhecida → '<altura>p'; senão '<round(bandwidth/1000)> kbps'

// Mensagem: {type:'resolveHls', candidateId} →
{ ok:true, hls: HlsInfo }                                   // master: encrypted/live/duração refletem a playlist da melhor variante
| { ok:false, error:'CANDIDATE_NOT_FOUND' | 'HLS_FETCH_FAILED' | 'HLS_PARSE_FAILED' }
// Limites do fetch: 10 s, 1 MiB, redirecionamentos seguidos pelo navegador com URL final http(s), só http(s), só text/* ou application/(vnd.apple.mpegurl|x-mpegurl|octet-stream)

// VideoCandidate (v4, aditiva): hls?: HlsInfo; protection: 'none' | 'drm' | 'encrypted'
//   hls.encrypted → protection 'encrypted' (sem ação de download); hls.live → support 'unsupported-stream'

// Popup (data-testid): hls-loading, quality-select (padrão: maior qualidade), badge-encrypted, badge-live, hls-error
```

**Design:** cartão HLS com selo "HLS"; enquanto resolve, esqueleto com `aria-busy`; resolvido e válido: seletor de qualidade com o rótulo `720p · 3,2 Mbps` e a duração; criptografado: selo "Protegido (criptografado)"; ao vivo: "Transmissão ao vivo não suportada".

**Arquivos/módulos afetados:** ver `touches` no frontmatter.

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| Master com variantes | 3 `EXT-X-STREAM-INF` | variantes da maior para a menor, rótulos `1080p/720p/480p` | UT-01, E2E-01 |
| Rótulo sem altura | só `BANDWIDTH` | rótulo `<kbps> kbps` | UT-01 |
| Playlist de mídia | só `EXTINF` + `ENDLIST` | tipo `media`, duração e segmentos | UT-02 |
| Ao vivo | sem `EXT-X-ENDLIST` | `live: true` → não suportado | UT-02, E2E-03 |
| Criptografada | `EXT-X-KEY:METHOD=AES-128` | `encrypted: true` → protegido | UT-03, E2E-02 |
| Chave NONE | `EXT-X-KEY:METHOD=NONE` | `encrypted: false` | UT-03 |
| SAMPLE-AES / SESSION-KEY | `SAMPLE-AES` ou `EXT-X-SESSION-KEY` | `encrypted: true` | UT-03 |
| URLs relativas | `../v/720.m3u8`, `/abs`, `https://x/..` | resolvidas contra a base | UT-04 |
| fMP4 | `EXT-X-MAP` | `fmp4: true` | UT-02 |
| Playlist inválida | vazia / HTML | `HLS_PARSE_FAILED` | UT-05, IT-01 |
| Falha de rede | timeout/404 | `HLS_FETCH_FAILED` no popup | IT-01, IT-02 |
| Limites | > 1 MiB, tipo errado, URL final não http(s) | recusado | IT-02 |
| Redirecionamento comum | playlist redireciona (1 a vários) para outra URL http(s) | seguido; a resposta final é lida | IT-02 |
| Estado do candidato | após `resolveHls` de playlist criptografada / ao vivo / válida | `detect` devolve o candidato com `hls`, `protection: 'encrypted'` (criptografada), `support: 'unsupported-stream'` (ao vivo) ou `hls` resolvido (válida) | IT-04 |
| Master → variante | master não mostra criptografia | busca a playlist da melhor variante | IT-01 |
| Candidato inexistente | id desconhecido | `CANDIDATE_NOT_FOUND` | IT-01 |
| Privacidade | URL com `?token=` | logs sem query; só as playlists são requisitadas | IT-03 |
| Chave com METHOD escondido em atributo entre aspas / ausente / repetido | `URI="..,METHOD=NONE",METHOD=AES-128` | `encrypted: true` (dúvida = criptografado) | UT-03 |
| Muitas variantes / variante com esquema não http(s) | 16.000 variantes; `file:`, `javascript:` | no máximo 50, só `http(s)` | UT-06 |
| HLS e arquivo com a mesma URL | `<video src=x.m3u8>` e rede `hls` | prevalece o candidato `hls` | UT-07 |
| Reobservação, reinício e concorrência | mesma playlist observada de novo; `restart`; 3 `resolveHls` juntos | estado preservado; candidato achado no `NetworkStore`; 1 busca por URL | IT-05 |
| Contrato de HlsInfo | objeto `HlsInfo` | validador aceita v1; rejeita campos ausentes | CT-01 |

## 7. Artefato B — Plano de Testes (TDD)
### 7.1 Testes de Caracterização
- N/A — comportamento novo; os candidatos `hls` já existem desde a SPEC-0010 e continuam "não suportados" até aqui.

### 7.2 Testes Unitários
- **UT-01** — Dado um master com três variantes (com e sem `RESOLUTION`), quando `parseHlsPlaylist` é chamado, então devolve variantes ordenadas por banda decrescente com índice, URL absoluta e rótulo `1080p`/`720p`/`<kbps> kbps`.
- **UT-02** — Dado playlists de mídia (VOD com `ENDLIST`, ao vivo sem `ENDLIST`, com `EXT-X-MAP`), quando `parseHlsPlaylist` é chamado, então devolve duração, contagem de segmentos, `live` e `fmp4` corretos.
- **UT-03** — Dado playlists com `METHOD=NONE`, `AES-128`, `SAMPLE-AES` e `EXT-X-SESSION-KEY` no master, quando `parseHlsPlaylist` é chamado, então `encrypted` é falso só no `NONE` e verdadeiro nos demais. Regra de lista de permissão (Emendas 2 e 3): o texto da playlist é varrido procurando QUALQUER ocorrência de `#EXT-X-KEY` ou `#EXT-X-SESSION-KEY` (prefixo, sem depender de regex com `.`), a linha vai até o próximo `\n` (tolerando um único `\r` final) e uma chave só é **limpa** se a linha for exatamente `#EXT-X-KEY:METHOD=NONE` (valor `NONE` exato, maiúsculo); **qualquer outra forma conta como criptografada** — aspas soltas ou sem fechar, atributo `METHOD` ausente/repetido/desconhecido, outros atributos junto de `NONE` (ex.: `METHOD=NONE,URI=...`), `METHOD=none`, quebras de linha Unicode (U+2028/U+2029/U+0085), `\r` no meio da linha, caracteres de controle ou qualquer sufixo inesperado. Casos que devem dar `encrypted: true`: `#EXT-X-KEY:METHOD=NONE,X=a"b,METHOD=AES-128,Y="`, `#EXT-X-KEY:METHOD=NONE,URI="x,METHOD=AES-128`, `#EXT-X-KEY:METHOD=AES-128,URI="k\u2028"`, `#EXT-X-KEY:METHOD=NONE\r,METHOD=AES-128`, `METHOD=none`. O custo (uma playlist limpa com `METHOD=NONE` e atributos extras aparece como protegida) é aceito: o erro vai sempre no sentido seguro.
- **UT-04** — Dado URLs relativas (`seg.ts`, `../v/720.m3u8`, `/abs/x.m3u8`, absoluta com query) e uma base, quando as variantes/segmentos são resolvidos, então ficam absolutos e preservam a query.
- **UT-05** — Dado texto vazio, HTML e lixo binário, quando `parseHlsPlaylist` é chamado, então lança `HLS_PARSE_FAILED`.
- **UT-06** — Dado um master com 16.000 variantes e variantes com URL `file:`, `javascript:` e `ftp:`, quando `parseHlsPlaylist` é chamado, então devolve no máximo 50 variantes (as de maior banda, `index` 0..49) e descarta as de esquema não `http(s)` (Emenda 2).
- **UT-07** — Dado um candidato DOM `kind: 'file'` e um candidato de rede `kind: 'hls'` com a mesma URL, quando `mergeCandidates` é chamado, então prevalece o candidato `hls`; para URLs iguais do mesmo `kind` o DOM continua prevalecendo (Emenda 2; ajusta SPEC-0010:UT-03 só para o caso de `kind` diferente).

### 7.3 Testes de Integração
- **IT-01** — Com o background real, `fakeBrowser` e um `PlaylistFetcherPort` apontado para o servidor de fixtures, `resolveHls` devolve `HlsInfo` para um master (buscando a playlist da melhor variante para `encrypted/live/duração`), `HLS_PARSE_FAILED` para conteúdo inválido, `HLS_FETCH_FAILED` para 404/timeout e `CANDIDATE_NOT_FOUND` para id desconhecido.
- **IT-02** — Com o fetcher real contra o servidor de fixtures, respostas > 1 MiB, de tipo inesperado, cujo redirecionamento termine em esquema não http(s) ou com esquema não http(s) são recusadas; redirecionamentos para outra URL http(s) são seguidos; timeout de 10 s é respeitado (relógio injetado).
- **IT-04** — Com o background real, depois de `resolveHls` bem-sucedido, uma nova chamada de `detect` devolve o mesmo candidato com `hls` preenchido; se `hls.encrypted` o candidato tem `protection: 'encrypted'` (e nenhuma ação de download), se `hls.live` tem `support: 'unsupported-stream'`; um `resolveHls` com falha não altera o candidato (Emenda 1).
- **IT-05** — Com o background real: (a) uma nova observação da mesma URL de playlist (`NetworkStore.add`) preserva `hls` e `protection` já resolvidos; (b) um novo `resolveHls` de playlist que deixou de ser criptografada volta `protection` para `none`; (c) após `bg.restart()` e sem `detect` prévio, `resolveHls` encontra o candidato guardado no `NetworkStore`; (d) três `resolveHls` simultâneos do mesmo candidato fazem uma única busca por URL de playlist; (e) um `HlsInfo` com mais de 50 variantes brutas é guardado com no máximo 50 (Emenda 2).
- **IT-03** — Com o logger real, depois de `resolveHls` com URL de `?token=...`, o diagnóstico não contém `token=`, e o servidor de fixtures só recebeu requisições às URLs de playlist.

### 7.4 Testes de Contrato
- **CT-01** — Contrato `HlsInfo` v1 (consumido pela SPEC-0012): o validador aceita um `HlsInfo` completo (master e media) e rejeita objetos sem `encrypted`, `live` ou com variantes sem `url`.

### 7.5 Testes E2E
- **E2E-01** — Uma página que requisita um master HLS de fixture (3 qualidades) mostra o cartão HLS com `quality-select` na maior qualidade e as três opções; axe sem violações serious/critical.
- **E2E-02** — Uma página que requisita uma playlist com `EXT-X-KEY:METHOD=AES-128` mostra `badge-encrypted` e nenhum botão de download.
- **E2E-03** — Uma página que requisita uma playlist sem `ENDLIST` mostra `badge-live` e nenhum botão de download.

### 7.6 Outros
- Verificação manual no G6: em um site real com HLS sem criptografia, conferir as qualidades listadas; em um site com HLS criptografado, conferir o selo de protegido (registrar sites e resultado).

**Dublês e dados de teste:** servidor de fixtures com playlists pequenas versionadas (`e2e/fixtures/hls/`: master 3 qualidades, mídia VOD, mídia com AES-128, ao vivo, com `EXT-X-MAP`); relógio injetável para timeouts.

**Ambiente de execução:** Vitest e Playwright com a extensão carregada, local e CI.

## 8. Plano de Rollout
- **Estratégia:** deploy direto numa release rc; sem feature flag.
- **Dados/schema:** N/A (resolução em memória/`storage.session`).
- **Compatibilidade:** campos aditivos em `VideoCandidate` (v4); mensagem nova `resolveHls`; popup e background saem juntos.
- **Observabilidade:** contadores locais de playlists resolvidas, protegidas e ao vivo; erros `HLS_*` com ID de correlação.
- **Rollback:** versão anterior pela pipeline de release.
- **Etapas de migração/coexistência:** N/A.

## 9. Questões em Aberto
- [x] HLS com criptografia AES-128 — fica de fora: só HLS sem criptografia; criptografados aparecem como protegidos (Thomas, 2026-10-02; ADR-0013)

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
<!-- Preenchido na fase PLAN. -->

**Fase 1: Parser HLS**
- [ ] Red: escrever UT-01, UT-02, UT-03, UT-04, UT-05, CT-01 com a tag `SPEC-0011:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados (`src/core/hls` sobre m3u8-parser 7.2.0)
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 2: resolveHls no background**
- [ ] Red: escrever IT-01, IT-02, IT-03 com a tag `SPEC-0011:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados (PlaylistFetcherPort, limites, candidato resolvido)
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 3: Popup e jornada E2E**
- [ ] Red: escrever E2E-01, E2E-02, E2E-03 com a tag `SPEC-0011:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados (quality-select, selos, fixtures HLS)
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase final: Integração, entrega e documentação**
- [ ] Review independente (G4)
- [ ] Integração + CI verde (G5) e aprovação (H2)
- [ ] Deploy via pipeline (release rc) com smoke/E2E e a verificação manual do §7.6 (G6)
- [ ] Relatório de Entrega, docs raiz e CHANGELOG (G7)

## 12. Registro de Gates
<!-- Status: PENDING | PASS | FAIL | N/A. PASS e N/A exigem evidência (comando + resultado, SHA, execução de CI, veredito). -->
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — b3992e6 (árvore suja) | 2026-10-02 |
| G1 Red | PASS | verify G1: PASS; `pnpm test` exit 1 (red: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[17/21]⎯) — b55d080 | 2026-10-02 |
| G2 Green | PASS | build exit 0 (✔ Finished in 202 ms); test exit 0 (Duration  25.42s (tests 98%, import 1%, transform 1%)); lint exit 0 (✔ Finished in 138 ms); coverage exit 0 (================================================================================) — 302082c | 2026-10-02 |
| G3 Arquitetura | PASS | arch_test exit 0 (✔ no dependency violations found (30 modules, 57 dependencies cruised)) — 302082c | 2026-10-02 |
| G4 Review | FAIL | reviewer-agent a3eaef7d (2ª rodada): CHANGES_REQUESTED @ 302082c — 2 major: tokenizador de aspas ainda esconde METHOD=AES-128 (aspa solta em valor sem aspas, aspa sem fechar, U+2028/2029 fazem a linha da chave ser ignorada; confirmado com ffmpeg/hls.js) + 4 minor | 2026-10-02 |
| G5 Integração & CI | PENDING | | |
| H2 Integração aprovada | PENDING | | |
| G6 Deploy | PENDING | | |
| G7 Pronto & Docs | PENDING | | |

## 13. Registro de Impedimentos
<!-- Toda parada é registrada pelo Architect com `spec_graph.py impede` e fechada com `resolve` — não edite à mão. Tipos: spec (spec errada/incompleta → resolve com Emenda) | decisão (só o humano decide → resposta ou ADR) | trabalho (falta algo que exige código → SPEC-NNNN nova) | externo (acesso, ambiente, terceiro → ação tomada) | falha (3 FAILs seguidos no mesmo gate → diagnóstico e decisão). Com impedimento aberto a spec aparece como parada no INDEX e não pode ser fechada. -->
| ID | Aberto em | Fase/Gate | Tipo | Descrição | Tentativas | Responsável | Resolução | Fechado em |
|---|---|---|---|---|---|---|---|---|
| IMP-01 | 2026-10-02 | G1 | spec | Teto de 3 redirecionamentos não implementável em service worker (redirect:'manual' devolve resposta opaca sem Location); a spec não define o armazenamento do HlsInfo no candidato (necessário à recusa server-side da SPEC-0012); HlsVariant.index sem semântica | Teste-writer validou com fetcher de referência em Node (passa), mas o navegador não permite contar redirecionamentos | Architect (emenda) + Test-writer | Emenda 1 (revisão do plano): redirecionamentos, HlsVariant.index e estado do candidato | 2026-10-02 |

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
<!-- Mudança em spec aprovada: uma linha por emenda. Mudou o contrato? Incremente `contract_version` e rode `spec_graph.py impacted SPEC-0011`. -->
| Versão do contrato | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
| 1 (dependência) | 2026-10-02 | `depends_on: [SPEC-0010]` passa a `consumes_contract: [SPEC-0010@1]` | a dependência real é o código/contrato já integrado na `main` (SPEC-0010 com G5 e H2); o fechamento (G6 manual e G7) das specs do épico acontece em lote numa única rc no fim, pois a verificação manual exige o Thomas | SPEC-0010 (sem efeito no contrato) | thomas (delegação no chat, 2026-10-02: seguir o recomendado) |
| 1 (revisão do plano) | 2026-10-02 | (a) o teto de 3 redirecionamentos é substituído por: o navegador segue os redirecionamentos e a URL final precisa ser `http(s)`; (b) `HlsVariant.index` = posição na lista ordenada por banda decrescente (0 = maior); (c) `resolveHls` grava o `HlsInfo` no candidato guardado (`hls`, `protection: 'encrypted'`, `support: 'unsupported-stream'` para ao vivo), novo IT-04 | (a) `fetch` em service worker com `redirect: 'manual'` devolve resposta opaca sem destino, então contar redirecionamentos não é implementável; (b) a SPEC-0012 usa o índice como `variantIndex`; (c) a SPEC-0012 recusa criptografado e ao vivo no servidor com base no estado do candidato | SPEC-0012 (consome `HlsInfo` e o estado do candidato) | thomas (delegação no chat, 2026-10-02: seguir o recomendado) |
| 2 (revisão G4) | 2026-10-02 | regra de dúvida do `METHOD` (tokenização com aspas; dúvida = criptografado); no máximo 50 variantes e só `http(s)`; `mergeCandidates` prefere o candidato `hls` ao DOM de mesma URL; reobservação da playlist preserva `hls`/`protection`; re-resolve limpa `protection`; `resolveHls` acha o candidato no `NetworkStore` e deduplica chamadas simultâneas; content-type `audio/mpegurl` e `audio/x-mpegurl` aceitos pelo fetcher | achados do Reviewer (G4): um `METHOD=NONE` dentro de URI entre aspas classificava playlist criptografada como limpa (regra de segurança central); estado perdido na reobservação; teto de armazenamento; inconsistências | SPEC-0010 (UT-03 de `mergeCandidates` para `kind` diferente), SPEC-0012 (obrigações abaixo) | thomas (delegação no chat, 2026-10-02: seguir o recomendado) |
| 3 (revisão G4, 2ª rodada) | 2026-10-02 | a detecção de criptografia passa de tokenizador para **lista de permissão**: só `#EXT-X-KEY:METHOD=NONE` exato é limpo; `support: 'unsupported-stream'` por ao vivo deixa de ser permanente (um novo resolve atualiza `support` a partir do resultado mais recente, sem sobrescrever outra razão de recusa) | o Reviewer provou (ffmpeg e hls.js reais) que o tokenizador com aspas ainda classificava como limpas chaves AES-128 com aspas soltas ou sem fechar e com U+2028/U+2029, a mesma classe do major original | SPEC-0012 (que re-analisa a variante escolhida e herda a mesma função) | thomas (delegação no chat, 2026-10-02: seguir o recomendado) |
