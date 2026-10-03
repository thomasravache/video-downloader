---
id: SPEC-0016
title: Contexto de requisição da página para buscar playlists e segmentos recusados com 403
tier: full
type: feature
user_facing: true
status: in-progress
created: 2026-10-03
parent: SPEC-0008
depends_on: []
consumes_contract: [SPEC-0011@1, SPEC-0012@1, SPEC-0015@1]
contract_version: 1
touches: [wxt.config.ts, src/core/**, entrypoints/background/**, entrypoints/offscreen/**, entrypoints/popup/**, public/_locales/**, e2e/support/**, e2e/journeys/**, e2e/fixtures/**, tests/unit/**, tests/integration/**]
adrs: [ADR-0015, ADR-0012, ADR-0013, ADR-0006, ADR-0001]
external: []
size: M
approved_by: thomas
approved_at: 2026-10-03
---

# SPEC-0016 — Contexto de requisição da página para buscar playlists e segmentos recusados com 403

## 1. Visão Geral
Plataformas de curso como a Hotmart servem HLS por uma CDN (`vod-akm.play.hotmart.com`) que só responde quando a requisição traz o **contexto do player**: `Origin: https://cf-embed.play.hotmart.com` e `Referer: https://cf-embed.play.hotmart.com/` (o acesso em si é decidido por um token na própria URL, `hdnts=…`, sem cookie). A extensão busca playlists no service worker e segmentos no offscreen document, ambos com origem `chrome-extension://…`, e a CDN responde **403**. O popup mostra "Could not read this video's playlist" para todas as playlists. Esta spec faz a extensão, **somente depois de um 401/403**, repetir a busca com o `Origin`/`Referer` do frame que originalmente fez a requisição (informação que o navegador já nos dá), no flavor `local`.

## 2. Motivação & Escopo
**Motivação:** diagnóstico real na Hotmart (2026-10-03): `hls.failed: HLS_FETCH_FAILED: status 403` nas três playlists (master, qualidade e legenda); o DevTools do usuário mostra a requisição do player com os dois cabeçalhos e sem `Cookie`.

**Plataforma-alvo:** Hotmart (`hotmart.com`, player em `cf-embed.play.hotmart.com`, CDN `vod-akm.play.hotmart.com`); os testes usam hosts de exemplo (`*.exemplo.test`).

**Objetivos (dentro do escopo):**
- Guardar, para cada candidato observado na rede, a **origem do iniciador** da requisição (`initiatorOrigin`, só esquema+host+porta, vinda do `webRequest`).
- Ao receber `401`/`403` numa busca de playlist, de segmento, de init (e, na SPEC-0017, de chave), repetir **uma vez** com `Origin` e `Referer` (`<initiatorOrigin>/`) via regras de sessão do `declarativeNetRequest`, escopadas aos hosts daquela operação e removidas ao fim.
- Mensagem clara no popup quando o servidor continua recusando (provável token expirado), em vez do erro genérico.
- Aplicar só no flavor `local` (permissão `declarativeNetRequestWithHostAccess` só no manifest `local`).

**Não-objetivos (fora do escopo):**
- Alterar, gerar ou renovar tokens; usar cookies de outra aba/sessão; qualquer cabeçalho além de `Origin` e `Referer`.
- Descriptografia (SPEC-0017) e o flavor `public` (nova decisão futura).
- Legendas (`TYPE=SUBTITLES`) e listas I-frame.

## 3. Dependências
- **Implementações necessárias:** N/A (vínculo por contrato).
- **Contratos consumidos:** SPEC-0011@1 (`PlaylistFetcherPort`, `resolveHls`), SPEC-0012@1 (job, `start` do offscreen, erros), SPEC-0015@1 (`VideoCandidate`, popup). Mudanças nesses contratos são **aditivas** (§6) e entram como emendas aditivas ao integrar.
- **Pré-requisitos externos:** nenhum pacote novo. Permissão de manifest nova (`declarativeNetRequestWithHostAccess`, só `local`), prevista pelo ADR-0012 ("novas permissões só com a spec que as usa").

## 4. Decisão Arquitetural
**Contexto:** `entrypoints/background/playlist-fetcher.ts` (SW) e `entrypoints/offscreen/run-job.ts` (`fetchBytes`) são os pontos de busca; `network.ts` observa a rede (hoje descarta `initiator`); `wxt.config.ts` monta o manifest por flavor; ADR-0012 (permissões por flavor) e ADR-0015 (regra 3: contexto da própria página, "nunca valores inventados").

**Decisão:** (1) o observador de rede passa a ler `details.initiator`, reduz a **origem** http(s) e a guarda no candidato (`initiatorOrigin?`); (2) um gerenciador de contexto (`entrypoints/background/request-context.ts`) instala **uma regra de sessão** do `declarativeNetRequest` por operação (resolve de uma playlist, ou job de download): `requestDomains` = hosts das URLs daquela operação (máx. 8), `initiatorDomains` = o ID da extensão, `resourceTypes` = `xmlhttprequest`, ação `modifyHeaders` com `set` de `origin` e `referer`; (3) a escada de tentativa é: busca simples → se `401|403` **e** o candidato tem `initiatorOrigin` → instala a regra → repete uma vez → remove a regra; no job, se o resolve precisou de contexto, a regra cobre o job inteiro (playlists, init, segmentos, e chaves da SPEC-0017) e é removida ao terminar, cancelar ou falhar; (4) regras órfãs (SW reiniciado) são limpas na partida.

**Justificativa:** reproduz fielmente o que o navegador do usuário já enviou, só quando a CDN recusa; não toca tokens; escopo mínimo e reversível.

**Desvio do padrão existente:** uma permissão nova no manifest `local`. Nenhuma dependência.

**Alternativas descartadas:** (a) `fetch` executado dentro do frame da página via `scripting.executeScript` (origem natural, sem DNR; fica como **plano B** se a prova de conceito mostrar que o DNR não consegue sobrescrever `Origin`); (b) enviar o contexto sempre, desde a primeira tentativa (amplia o alcance sem necessidade); (c) pegar a origem na aba ativa (a página da aula, `site.exemplo.test`, é diferente do iframe do player, `player.exemplo.test`).

**ADRs:** ADR-0015, ADR-0012, ADR-0013, ADR-0006, ADR-0001.

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** no máximo **1** repetição por recurso; a regra é instalada uma vez por operação (não por segmento); no máximo 4 regras simultâneas na extensão.
- **Segurança:** `Origin`/`Referer` só a partir do `initiatorOrigin` guardado (nunca de mensagem do popup nem de campo da playlist); só `https?://` e nunca a origem da própria extensão; hosts da regra = hosts das URLs aprovadas daquela operação; nenhum cabeçalho além dos dois; sem `Cookie`; sem leitura de resposta além do que o job já lê.
- **Privacidade e dados pessoais:** a regra guarda só nomes de host e a origem (sem caminho, query ou token); logs registram apenas "contexto usado: sim/não" e o status HTTP, nunca URL com query nem a origem completa de terceiros além do host.
- **Disponibilidade e resiliência:** regras removidas em sucesso, erro e cancelamento; órfãs limpas na inicialização; falha ao instalar a regra ⇒ erro normal da busca (sem laço).
- **Acessibilidade (UI):** só texto novo em área já existente; axe sem violações sérias no E2E-02.
- **Custo:** N/A.

## 6. Artefato A — Contrato
**Interface:** `VideoCandidate.initiatorOrigin?` (src/core/contracts); `NetworkResponse.initiator?` (src/core/network.ts); `RequestContextPort` (src/core/ports); mensagem `resolveHls`/`download` com erro `status?` (aditivo); manifest `local`.

```text
// Candidato (aditivo, SPEC-0015@1):
VideoCandidate.initiatorOrigin?: string   // "https://host[:porta]" — só esquema+host+porta; ausente se desconhecido
// NetworkResponse (aditivo): initiator?: string  (valor cru de details.initiator)
// Regra: initiatorOrigin = new URL(initiator).origin se esquema http(s) e não é a origem da extensão; senão ausente.
// Validação: string que é exatamente uma origem http(s) (sem caminho/query/fragmento); outra coisa => candidato inválido.

// Porta de contexto (src/core/ports):
interface RequestContextPort {
  acquire(opts: { hosts: string[]; origin: string }): Promise<RequestContextLease>  // instala a regra
}
interface RequestContextLease { release(): Promise<void> }   // remove a regra (idempotente)
// Referer = origin + '/'; Origin = origin. Hosts: minúsculos, únicos, <= 8, só nomes DNS/IP http(s).

// Regra DNR (sessão), id na faixa reservada 7_000_000+ (n/a a regras de outros usos):
{ id, priority: 1,
  action: { type: 'modifyHeaders', requestHeaders: [
    { header: 'origin',  operation: 'set', value: origin },
    { header: 'referer', operation: 'set', value: origin + '/' } ] },
  condition: { requestDomains: hosts, initiatorDomains: [<id da extensão>], resourceTypes: ['xmlhttprequest'] } }

// Escada de busca (playlist-fetcher e fetchBytes do offscreen):
//  1) busca simples; 2) status 401|403 e candidato com initiatorOrigin => lease = acquire(); repetir UMA vez;
//  3) qualquer outro resultado, ou 2ª recusa => erro como hoje (HLS_FETCH_FAILED: status N / FETCH_FAILED).
// No job: se o resolve usou contexto para a playlist, o lease cobre todos os hosts do job até o fim (done/failed/canceled).
// Erro de resolve ganha `status?: number` (aditivo) quando for HLS_FETCH_FAILED por HTTP.

// Popup: HLS_FETCH_FAILED com status 401|403 => texto i18n `hlsErrorExpired` (pt_BR/en):
//   "O servidor recusou o acesso ao vídeo (o link pode ter expirado). Reabra a aula e tente de novo."
// Manifest: `declarativeNetRequestWithHostAccess` em `permissions` SOMENTE no flavor local.
```

**Design:** N/A — só um texto de erro novo no cartão HLS existente.

**Arquivos/módulos afetados:** ver `touches`; novos: `entrypoints/background/request-context.ts`, ajustes em `network.ts`, `playlist-fetcher.ts`, `run-job.ts`, `service.ts`, `wxt.config.ts`, locales.

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| Captura do iniciador | resposta de rede com `initiator` http(s) / extensão / ausente | `initiatorOrigin` = origem; ausente nos outros | UT-01 |
| Contexto derivado | candidato com e sem `initiatorOrigin` | `{origin, referer}` / nada | UT-02 |
| Regra DNR | hosts + origem válidos / inválidos | regra exata do contrato / recusa | UT-03 |
| Escada de busca | 403→200, 403→403, 404, 500, sem origem | repete 1× só em 401/403 com origem | UT-04, IT-01 |
| Ciclo de vida das regras | sucesso, erro, cancelamento, SW reiniciado | removidas; órfãs limpas | UT-05, IT-05 |
| Mensagem de expiração | HLS_FETCH_FAILED 401/403 | texto `hlsErrorExpired` | UT-06, E2E-02 |
| Resolve com contexto | servidor exige Origin/Referer | resolve ok após 1 repetição | IT-01 |
| Download com contexto | playlist, init e segmentos exigem contexto | job `done`; regra cobre os hosts do job | IT-02, E2E-01 |
| Segurança do contexto | origem forjada no popup, host fora do job, sem origem | ignorado/recusado; nenhuma regra extra | IT-03 |
| Privacidade | URLs com token | regra e logs sem query/token | IT-04 |
| Manifest por flavor | build local / public | só o local tem a permissão | IT-06 |
| Compatibilidade | candidato sem o campo novo | continua válido | CT-01 |

## 7. Artefato B — Plano de Testes (TDD)

### 7.1 Testes de Caracterização
N/A — buscas sem 401/403 já são cobertas pelos testes de SPEC-0011/0012/0013/0014/0015; IT-01 inclui o caso "sem contexto necessário" como guarda.

### 7.2 Testes Unitários
- **UT-01** — Dado respostas de rede com `initiator` `https://player.exemplo.test`, `chrome-extension://abc`, `null`, ausente e `http://x.test:8080/caminho?q=1`, quando o candidato é criado, então `initiatorOrigin` é `https://player.exemplo.test`, ausente, ausente, ausente e `http://x.test:8080` respectivamente.
- **UT-02** — Dado candidato com `initiatorOrigin`, quando `contextFor` roda, então devolve `{origin, referer: origin + '/'}`; sem o campo, devolve `undefined`.
- **UT-03** — Dado `buildContextRule` com hosts e origem válidos, então produz a regra do contrato (ids na faixa reservada, `set` de `origin`/`referer`, `requestDomains` únicos e minúsculos, `initiatorDomains` = extensão); e dado host não-http(s)/vazio, mais de 8 hosts, ou origem da extensão, então recusa.
- **UT-04** — Dado um `fetch` falso, quando a escada roda: 403→200 repete uma vez com lease e devolve ok; 403→403 falha com `status 403`; 404 e 500 não repetem; sem `initiatorOrigin` não repete; nunca mais de uma repetição.
- **UT-05** — Dado o gerenciador de regras, quando `acquire`/`release` rodam em sequência, em paralelo (limite de 4), com `release` duplicado e com `removeOrphans` na partida, então ids não colidem, `release` é idempotente e só regras da faixa reservada são removidas.
- **UT-06** — Dado erro de resolve `HLS_FETCH_FAILED` com `status` 403, 401, 404 e sem status, quando o popup escolhe o texto, então usa `hlsErrorExpired` em 401/403 e o texto atual nos demais; ambos os locales têm a chave.

### 7.3 Testes de Integração
- **IT-01** — Dado servidor local que responde 403 sem `Origin`/`Referer` iguais ao esperado e candidato observado com esse iniciador, quando `resolveHls` roda, então a 1ª busca é recusada, a regra é instalada com os hosts e cabeçalhos corretos, a 2ª tem sucesso e a regra é removida; com servidor que não exige contexto, nenhuma regra é criada (guarda).
- **IT-02** — Dado servidor que exige contexto para playlist, init e segmentos, quando o job roda no offscreen real, então termina `done`, uma regra cobre os hosts do job e ela é removida no fim.
- **IT-03** — Dado mensagem do popup com `origin`/`referer` forjados, candidato sem `initiatorOrigin`, e URL de host fora do conjunto do job, quando download/resolve rodam, então nenhum valor da mensagem é usado, nenhuma regra é instalada sem origem e o host extra não entra na regra.
- **IT-04** — Dado URLs com `?token=…&expires=…`, quando regra e logs são inspecionados, então nenhum contém a query ou o token (só host e origem).
- **IT-05** — Dado job que termina `done`, `failed` e `canceled`, e um SW reiniciado com regra órfã, quando o ciclo acaba/inicia, então não restam regras da faixa reservada.
- **IT-06** — Dado os builds `local` e `public`, quando o manifest é inspecionado, então só o `local` tem `declarativeNetRequestWithHostAccess` e a lista de permissões do `public` não muda.

### 7.4 Testes de Contrato
- **CT-01** — Dado `VideoCandidate` e erro de resolve sem os campos novos (SPEC-0015@1), quando validados, então continuam aceitos; com `initiatorOrigin` válido e `status` inteiro, também; com `initiatorOrigin` com caminho/query, esquema não-http(s) ou tipo errado, rejeitados.

### 7.5 Testes E2E
- **E2E-01** — Dado uma página em uma origem A com iframe que carrega HLS de um servidor B que responde 403 a menos que `Origin` = origem do iframe e `Referer` = origem do iframe + `/` [jornada: baixar-hls], quando o usuário (flavor `local`, Chromium real) abre o popup e baixa, então o cartão resolve, o download termina e o MP4 salvo é válido (`ftyp`, `moov`, `mdat`, trilha de vídeo), com o servidor registrando que a 1ª tentativa foi recusada e as seguintes tiveram os cabeçalhos corretos. **Este teste é a prova de conceito (fase 1):** se o DNR não conseguir sobrescrever `Origin`, o Implementer para e reporta.
- **E2E-02** — Dado um servidor que responde sempre 403 (token expirado), quando o popup abre, então o cartão mostra o texto de expiração (não o erro genérico), há no máximo 2 requisições por playlist e axe não acusa violações sérias.

### 7.6 Outros
- **Segurança:** IT-03 e UT-03 (nenhum valor externo chega ao cabeçalho); revisão manual dos cabeçalhos que o DNR altera.
- **Manual (G6):** o usuário confirma em uma aula real que as playlists resolvem.

**Dublês e dados de teste:** servidor HTTP com verificação de `Origin`/`Referer` e registro dos cabeçalhos (estender `tests/integration/support/playlist-server.ts` e um servidor de E2E em origem diferente); fake de `declarativeNetRequest` na harness de integração que aplique os cabeçalhos às buscas de teste.

**Ambiente de execução:** Vitest e Playwright com Chromium real, local e no CI (E2E-01/02 no flavor `local`; no `public` o E2E-02 verifica só o texto de erro).

## 8. Plano de Rollout
- **Estratégia:** deploy direto na próxima rc; ativo só no `local`.
- **Dados/schema:** N/A (campo opcional no candidato guardado em `storage.session`).
- **Compatibilidade:** campos aditivos; sem `initiatorOrigin` o comportamento é o de hoje.
- **Observabilidade:** log `hls.context_used` (sim/não, status), sem URL com query.
- **Rollback:** reverter o PR e publicar nova rc.
- **Etapas de migração/coexistência:** N/A.
- **Fase 1 (portão):** E2E-01 prova que as regras DNR de sessão fazem o `fetch` da extensão carregar `Origin`/`Referer` da página. Se falhar, parar e reportar `SPEC_DEFECT`; o arquiteto abre emenda para o plano B (busca dentro do frame).

## 9. Questões em Aberto
Nenhuma. (Premissas a confirmar no H1: aplicar só no `local`; uma única repetição por recurso; origem do iniciador, e não a URL da aba, como fonte do contexto.)

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
<!-- Preenchido na fase PLAN, após a aprovação. Cada fase começa pelos testes. -->
**Fase 1: Prova de conceito do contexto de requisição (portão)**
- [ ] Red: E2E-01 (servidor que exige Origin/Referer, iframe de outra origem) falhando pelo motivo certo
- [ ] Green mínimo: `initiatorOrigin`, regra DNR de sessão e a escada 401/403 no resolve; E2E-01 verde no Chromium real; se o DNR não sobrescrever `Origin`, PARAR e reportar SPEC_DEFECT (plano B por emenda)

**Fase 2: Contexto completo e segurança**
- [ ] Red: UT-01..UT-06, CT-01, IT-01..IT-06, E2E-02 com a tag `SPEC-0016:<ID>`
- [ ] Green: gerenciador de regras (lease, limpeza de órfãs), job com regra por operação, mensagem `hlsErrorExpired`, permissão só no manifest `local`
- [ ] Refactor e validar: build + suíte + arquitetura (G2/G3)

**Fase final: Integração, entrega e documentação**
- [ ] Review independente (G4)
- [ ] Integração + CI verde (G5) e aprovação (H2)
- [ ] Release rc com smoke/E2E no pipeline e teste manual do Thomas (G6)
- [ ] Relatório de Entrega, docs raiz e CHANGELOG (G7)


## 12. Registro de Gates
<!-- Status: PENDING | PASS | FAIL | N/A. PASS e N/A exigem evidência (comando + resultado, SHA, execução de CI, veredito). -->
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — 0dadeb8 | 2026-10-03 |
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
N/A

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
<!-- Mudança em spec aprovada: uma linha por emenda. Mudou o contrato? Incremente `contract_version` e rode `spec_graph.py impacted SPEC-0016`. -->
| Versão do contrato | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
| 1 (escopo) | 2026-10-03 | a plataforma-alvo (Hotmart) passa a ser citada nesta spec | decisão do Thomas: a spec de implementação pode nomear a plataforma que se quer fazer funcionar; contrato inalterado | N/A | thomas (chat, 2026-10-03) |
