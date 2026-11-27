---
id: SPEC-0008
title: "Detector completo de vídeos: iframes, rede e HLS"
tier: epic
type: feature
status: implemented
created: 2026-10-02
depends_on: []
adrs: [ADR-0012, ADR-0013]
external: []
approved_by: thomas
approved_at: 2026-10-02
---

# SPEC-0008 — Detector completo de vídeos: iframes, rede e HLS (Épico)

<!-- type: feature | migration | foundation (produto novo: ver references/greenfield.md). O épico não é executado: define visão, decisões, decomposição e entrega. Quem executa são as specs filhas (tier full ou lite, tamanho S/M, `parent: SPEC-0008`). A ordem de execução é calculada a partir do frontmatter das filhas (`spec_graph.py waves`). -->

## 1. Visão
A detecção é o núcleo do produto, e a fundação só cobre `<video>` no documento principal. Este épico entrega o **detector completo**: vídeos em iframes (inclusive de outro domínio), mídia vista na rede (players MSE/`blob:`) e download de **HLS sem criptografia** com escolha de qualidade, progresso e cancelamento, gerando MP4 reproduzível. Acesso amplo no build `local`; por site, em tempo de uso, no build `public` (ADR-0012). Criptografia (AES-128) e DRM continuam fora: aparecem como "protegido", nunca baixados.

Origem: na verificação manual da fundação (2026-10-02), a página da MDN (vídeo em iframe de outro domínio) mostrou "Nenhum vídeo encontrado". Por decisão do Thomas, a detecção é melhorada **antes** de criar a conta da Chrome Web Store e de publicar.

## 2. Escopo
**Objetivos (dentro do escopo):**
- Detecção em todos os frames e pedido de acesso por site no build público (SPEC-0009).
- Detecção por rede de arquivos, HLS e DASH, resistente à suspensão do service worker (SPEC-0010).
- Leitura de playlists HLS, qualidades e recusa de criptografado/ao vivo (SPEC-0011).
- Download HLS em MP4 com progresso e cancelamento (SPEC-0012).
- Duas jornadas críticas novas no `sdd-config.yml`: `baixar-video-em-iframe` e `baixar-hls`.

**Não-objetivos (fora do escopo):**
- DRM e criptografia de stream (AES-128, SAMPLE-AES, Widevine etc.) — decisão de 2026-10-02: nunca.
- DASH (download), legendas, faixas de áudio alternativas, transmissões ao vivo.
- Providers de plataformas específicas, YouTube e Google Drive (épicos seguintes do roadmap).
- Gravação em disco por streaming (arquivos HLS acima de 1,5 GiB são recusados nesta fase).

## 3. Arquitetura Alvo
**Contexto:** Projeto novo; evolui a arquitetura da fundação (ADR-0001, ADR-0011) com permissões por flavor (ADR-0012) e montagem de HLS (ADR-0013).

```text
página (qualquer frame) ──executeScript(allFrames)──► background ◄── webRequest (observação)
                                         │  NetworkStore (storage.session) · jobs (storage.session)
popup ◄── detect / resolveHls / download / job / cancel ──┘      │
                                                                  └── offscreen (BLOBS): fetch de segmentos + mux.js → blob URL → downloads
```

- `src/core` continua puro (contratos, classificação, frames, rede, parser HLS com m3u8-parser, agendador de segmentos); `mux.js` e blobs só no offscreen; APIs do navegador só em `entrypoints/`.
- Manifestos por flavor: `local` com `host_permissions` http(s); `public` com `optional_host_permissions`; permissões novas `webRequest` (SPEC-0010) e `offscreen` (SPEC-0012).

**Decisões (ADRs):** ADR-0012 — permissões por flavor; ADR-0013 — montagem de HLS (m3u8-parser + mux.js em offscreen). Refinam o ADR-0007 (host permissions).

**Regras de arquitetura a garantir (G3):**
- `m3u8-parser` só em `src/core`; `mux.js` só em `entrypoints/offscreen` (dependency-cruiser).
- `src/core` sem APIs do navegador (inclusive globais) e `entrypoints/popup` sem importar providers/offscreen (regras existentes + novas).
- O manifesto `public` não declara `host_permissions` (teste sobre o build).

## 4. Decomposição
| Spec | Título | Tier | Tipo | Tamanho | Depende de | Consome contrato de |
|---|---|---|---|---|---|---|
| SPEC-0009 | Detecção em iframes e acesso por site | full | feature | M | SPEC-0005 | — |
| SPEC-0010 | Detecção por rede (media sniffing) | full | feature | M | SPEC-0009 | — |
| SPEC-0011 | Playlists HLS: parser, variantes e candidato no popup | full | feature | M | SPEC-0010 | — |
| SPEC-0012 | Download HLS sem criptografia: segmentos, junção em MP4 e progresso | full | feature | M | SPEC-0011 | — |

Executam em sequência (arquivos em comum: background, popup, manifesto e harness).

## 5. Estratégia de Entrega
- **Ambientes:** staging = release candidata (`v0.1.0-rc.N`/`v0.2.0-rc.N`) como prerelease no GitHub com os dois zips e smoke E2E; produção = estável, que só sai com confirmação do Thomas e depois da conta da Chrome Web Store.
- **Entrega por onda:** cada spec fecha com o G6 de staging (rc) e a verificação manual descrita no §7.6 dela; a conta da Web Store e o primeiro envio acontecem **depois** deste épico e **só quando o Thomas decidir** (regra de 2026-10-02: a publicação na loja passa pelo crivo dele; nenhum agente cria conta, aprova o job `webstore` nem publica por conta própria).
- **Feature flags:** N/A — o flavor isola o risco de permissões.
- **Rollback:** nova versão com o código anterior pela pipeline de release (runbook seção 4).
- **Métricas de sucesso pós-release:** a página da MDN passa a mostrar o vídeo (local direto; público após conceder acesso); um HLS sem criptografia baixa um MP4 que toca; HLS criptografado aparece como protegido.

## 6. Riscos & Mitigações
- **Permissão ampla no build público reprova na loja** — mitigado pelo ADR-0012 (por site, em tempo de uso, só origens vistas na página).
- **O diálogo nativo de permissão não é automatizável** — E2E usa cópia de teste do build; o fluxo real é verificado manualmente no G6 de cada spec.
- **Service worker suspenso perde estado** — repositórios de rede e jobs em `storage.session`, com teste de recriação do background.
- **Blob URL do offscreen em `chrome.downloads` é pouco documentado** — provado por E2E no Chromium real (SPEC-0012:E2E-01); se falhar, vira impedimento e alternativa registrada em ADR.
- **Memória em arquivos grandes** — limite de 1,5 GiB com erro claro; streaming para disco fica para depois.
- **Codecs fora de H.264/AAC** (ex.: HEVC) — erro `UNSUPPORTED_CODEC` com mensagem clara.
- **Build `public` não enxerga mídia de CDN de terceiros** — o `webRequest` e o `fetch` do service worker só alcançam hosts com permissão concedida; um player cuja playlist/mídia vem de um host diferente do da página só será detectado no `public` se o usuário também conceder esse host. Consequência do ADR-0012 (por site). Mitigação a decidir pelo Thomas após a verificação manual: oferecer no popup "Permitir todos os sites" (uma concessão ampla opcional) ou aceitar a limitação do `public` e deixar a cobertura completa para o `local` (decisão de produto, registrada em ADR se mudar).
- **Conteúdo protegido/pago** — AES-128 por chave de sessão é permitido (ADR-0015) e DRM está fora de escopo; a política da loja e o uso responsável permanecem como no épico da fundação.

## 7. Critérios de Aceite do Épico
- [x] Numa página com iframe de outro domínio, o build `local` lista e baixa o vídeo do iframe — SPEC-0009:E2E-01
- [x] No build `public`, o iframe sem acesso mostra "acesso necessário" e, concedido o acesso, o vídeo aparece — SPEC-0009:E2E-02
- [x] Mídia carregada por JavaScript/MSE é detectada pela rede e baixa quando é arquivo direto — SPEC-0010:E2E-01
- [x] Uma playlist HLS mostra as qualidades disponíveis — SPEC-0011:E2E-01
- [x] HLS criptografado aparece como protegido, sem download — SPEC-0011:E2E-02
- [x] Um HLS sem criptografia baixa um MP4 válido na qualidade escolhida, com progresso — SPEC-0012:E2E-01
- [x] O download HLS pode ser cancelado sem deixar arquivo — SPEC-0012:E2E-02

## 8. Questões em Aberto
- [x] HLS com criptografia AES-128 entra no escopo? — não: só HLS sem criptografia; criptografados aparecem como protegidos (Thomas, 2026-10-02)
- [x] Modelo de permissões — acesso amplo só no build local; por site, em tempo de uso, no público (Thomas, 2026-10-02)
- [x] Ordem do trabalho — detecção completa antes de criar a conta da Web Store (Thomas, 2026-10-02)

## 9. Aprovação (H1)
Uma aprovação humana cobre o épico e as specs filhas apresentadas junto com ele. Registrada no frontmatter (`approved_by`, `approved_at`) do épico e de cada filha.

## 10. Registro de Impedimentos
<!-- Problemas que envolvem várias filhas (conflito de integração da onda, CI quebrado, decisão transversal). Impedimento que trava uma filha específica vai na própria filha. -->
| ID | Aberto em | Fase/Gate | Tipo | Descrição | Tentativas | Responsável | Resolução | Fechado em |
|---|---|---|---|---|---|---|---|---|

## 11. Relatório de Entrega
**O que foi entregue:** detecção de vídeos em iframes de outro domínio, com acesso pedido por site no build `public` (SPEC-0009); detecção pela rede (SPEC-0010); playlists HLS com escolha de qualidade e selo de protegido (SPEC-0011); download HLS sem criptografia com junção em MP4, progresso e cancelamento (SPEC-0012); HLS com byte range (SPEC-0013); junção de vídeo e áudio separados (SPEC-0014); um cartão por vídeo com seletor de áudio (SPEC-0015); contexto de requisição da página para playlists recusadas com 403 (SPEC-0016); HLS AES-128 por chave de sessão no flavor `local` (SPEC-0017, ADR-0015).

**Como (ondas e deploys):** as filhas entraram na `main` por PR, cada uma com G0–G5 e H2 pela política auto-on-green. Pré-releases no GitHub pelo `release.yml`: `v0.1.0-rc.2` (SPEC-0009 a 0012, run 37081174307), `v0.1.0-rc.3` (SPEC-0013 a 0015, run 37101154187) e `v0.1.0-rc.4` (SPEC-0016 e 0017). Em todas, o smoke E2E rodou nos dois flavors; o job `webstore` falhou porque a publicação na Chrome Web Store ainda não foi configurada, por decisão do dono.

**Critérios de aceite:** os 7 estão marcados, cada um provado pelo E2E citado, e foram reexecutados verdes em `main` 0f94085 em 2026-11-27 (unit 602, integração 338, E2E 76).

**Métricas pós-release:** uso pelo dono em sites reais desde a rc.2, confirmado no chat em 2026-11-27. Esse uso gerou as SPEC-0013 a 0022 a partir dos problemas encontrados.

**Pendências:** a instabilidade com outras contas e os bugs do indicador da toolbar seguem no épico SPEC-0023. A versão estável `v0.1.0` e a publicação na Web Store dependem da decisão do dono.

## 12. Emendas
<!-- Mudança em spec aprovada: uma linha por emenda, aprovada pelo humano. -->
| Versão | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
| 1 (política, ADR-0015) | 2026-10-03 | removida a proibição de contorno de criptografia de stream; AES-128 por chave de sessão passa a ser permitido (DRM segue fora de escopo) | decisão do Thomas (uso pessoal e offline) | SPEC-0011, SPEC-0012, SPEC-0017 | thomas (chat, 2026-10-03: "aprovadíssimo") |
