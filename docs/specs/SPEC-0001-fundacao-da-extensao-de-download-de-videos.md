---
id: SPEC-0001
title: Fundação da extensão de download de vídeos
tier: epic
type: foundation
status: approved
created: 2026-09-30
depends_on: []
adrs: [ADR-0001, ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0007, ADR-0008, ADR-0009, ADR-0010, ADR-0011]
external: []
approved_by: thomas
approved_at: 2026-09-30
---

# SPEC-0001 — Fundação da extensão de download de vídeos (Épico)

## 1. Visão
Uma extensão do Chrome (Manifest V3) que identifica vídeos na página aberta e oferece o download, entregue sobre uma fundação que já funciona de ponta a ponta: repositório, testes (unitário, integração, E2E com a extensão carregada no Chrome, arquitetura), CI, e um pipeline de release que gera **dois builds** a partir do mesmo código — `public` (Chrome Web Store, sem providers proibidos pela política da loja) e `local` (instalado sem empacotar, com providers como YouTube). Ao fim do épico, o *walking skeleton* — detectar um vídeo direto (MP4/WebM sem DRM) e baixá-lo pelo popup — está publicado na Web Store (listagem não listada) e disponível como build local.

**Roadmap após a fundação** (épicos futuros, cada um com sua própria spec e H1):
1. Detector genérico completo: streams HLS/DASH **sem criptografia** (junção de segmentos), escolha de qualidade, progresso, nome do arquivo.
2. Providers de plataformas de curso (ex.: Hotmart) — só aulas sem DRM, **somente build `local`**.
3. Provider YouTube — **somente build `local`**.
4. Salvar direto no Google Drive (OAuth via `chrome.identity`).

## 2. Escopo
**Objetivos (dentro do escopo):**
- Stack, arquitetura (núcleo + providers + builds `public`/`local`) e pilares de entrega decididos em ADRs.
- Repositório com tooling, lint/format, typecheck, convenções (Conventional Commits, Keep a Changelog, SemVer) e enforcement SDD (`vendor`).
- Harness de testes: Vitest (unitário/integração), Playwright com a extensão carregada (E2E), dependency-cruiser (arquitetura).
- CI no GitHub Actions obrigatório na proteção da branch `main`.
- Walking skeleton: detecção de `<video>`/MP4/WebM direto na página → lista no popup → download via `chrome.downloads`.
- Pipeline de release: versão SemVer, zip dos dois builds, publicação do `public` na Web Store via API (com confirmação humana), `local` como artefato da release no GitHub.

**Não-objetivos (fora do escopo):**
- Qualquer contorno de DRM (Widevine/PlayReady/FairPlay) ou de criptografia de stream — **nunca**, em nenhum build. Vídeo protegido aparece como "protegido — download indisponível".
- HLS/DASH, providers de sites específicos, YouTube e Google Drive (épicos do roadmap).
- Navegadores além do Chrome/Chromium.
- Telemetria remota ou coleta de dados do usuário.

## 3. Arquitetura Alvo
**Contexto:** Projeto novo. Stack e arquitetura definidas nos ADRs de fundação (ADR-0010 stack, ADR-0011 providers/builds, ADR-0001 fronteiras).

```text
┌──────────── Página (aba) ────────────┐        ┌──────── Service worker (background) ────────┐
│ content script                        │  msg   │ core/detection  ← agrega candidatos por aba │
│  └─ providers/*/detect (DOM)          │ ─────► │ core/download   → chrome.downloads          │
└───────────────────────────────────────┘        │ providers/*/network (webRequest observação) │
                                                  └──────────────┬──────────────────────────────┘
                                                                 │ msg (contrato tipado)
                                                  ┌──────────────▼──────────────┐
                                                  │ popup (UI) — lista e ação    │
                                                  └──────────────────────────────┘
```

- `core/` não conhece nenhum site: define os contratos `VideoCandidate`, `Provider` e as mensagens entre contextos.
- `providers/<site>/` implementam `Provider`; o registro de providers de cada build é gerado a partir de `build.flavor` (`public` | `local`) — código de provider excluído não entra no bundle.
- UI (`entrypoints/popup`) só fala com o background por mensagens do contrato; nunca importa providers.

**Decisões (ADRs):** ADR-0010 — TypeScript + WXT (MV3); ADR-0011 — providers por site e builds `public`/`local`; ADR-0001…ADR-0009 — pilares de entrega (arquitetura, testes, qualidade, entrega, fluxo de mudança, segredos/dados, permissões/acesso, dependências, observabilidade). Resiliência, dados/migrações e custo dispensados com motivo em `sdd-config.yml`.

**Regras de arquitetura a garantir (G3):** (dependency-cruiser no CI)
- `core/**` não importa `providers/**`, `entrypoints/**` nem APIs `chrome.*`/`browser.*` diretamente (só via portas injetadas).
- `providers/**` só importam `core/**` (contratos) — nunca outro provider nem a UI.
- `entrypoints/popup/**` não importa `providers/**`.
- O bundle `public` não contém nenhum módulo de provider marcado `flavors: [local]` (teste sobre o `dist/` do build).
- Sem ciclos entre módulos.

## 4. Decomposição
| Spec | Título | Tier | Tipo | Tamanho | Depende de | Consome contrato de |
|---|---|---|---|---|---|---|
| SPEC-0002 | Repositório e tooling (WXT + TypeScript) | full | foundation | S | — | — |
| SPEC-0003 | Harness de testes (unitário, integração, E2E, arquitetura) | full | foundation | M | SPEC-0002 | — |
| SPEC-0004 | Pipeline de CI no GitHub Actions | full | foundation | S | SPEC-0002 | — |
| SPEC-0005 | Walking skeleton: detectar vídeo direto e baixar pelo popup | full | foundation | M | SPEC-0003, SPEC-0004 | — |
| SPEC-0006 | Pipeline de release e builds public/local | full | foundation | M | SPEC-0004 | SPEC-0005@1 |

## 5. Estratégia de Entrega
- **Ambientes:** *staging* = listagem **não listada** da Web Store (ou grupo de testadores confiáveis) + artefato `local` da release candidata; *produção* = listagem pública da Web Store + release estável no GitHub com o zip `local`.
- **Entrega por onda:** onda 1 (tooling) não publica nada; ao fim do walking skeleton + release, versão `0.1.0` vai para staging; produção só após confirmação humana da release.
- **Feature flags:** o próprio `build.flavor` é a separação de distribuição; flags de runtime N/A na fundação.
- **Rollback:** Web Store — publicar a versão anterior com número de versão maior (a loja não aceita downgrade) a partir da tag anterior; `local` — reinstalar o zip da release anterior.
- **Métricas de sucesso pós-release:** aprovação na revisão da Web Store sem violação; zero erros no log de diagnóstico local nos testes manuais de fumaça em 3 sites de referência.

## 6. Riscos & Mitigações
- **Rejeição na Web Store por "download de conteúdo protegido/pago"** — build `public` restrito ao detector genérico sem DRM; providers de cursos (login/paywall) e YouTube só no build `local` (decisão de 2026-09-30); descrição da loja deixa claro o uso para conteúdo que o usuário tem direito de baixar.
- **YouTube banido da loja e com URLs ofuscadas que mudam com frequência** — isolado no build `local` e em épico próprio; nunca no bundle `public` (teste de arquitetura sobre o `dist/`).
- **Limites do MV3** (service worker efêmero, sem acesso a blobs grandes no SW) — downloads grandes via `chrome.downloads` com a URL original; junção de segmentos (roadmap) em *offscreen document*.
- **Permissões amplas (`<all_urls>`) geram alerta e revisão mais lenta** — ADR-0007 define permissões mínimas e `optional_host_permissions` quando possível.

## 7. Critérios de Aceite do Épico
- [ ] Numa página de teste com `<video src="*.mp4">`, o usuário abre o popup, vê o vídeo listado e o arquivo é salvo em Downloads — SPEC-0005:E2E-01
- [ ] Vídeo com DRM (EME/`encrypted`) aparece como protegido e sem botão de download — SPEC-0005:E2E-02
- [ ] O build `public` não contém código de provider `local` — SPEC-0006:IT-01
- [ ] Todo PR roda build, lint, typecheck, unitário, integração, arquitetura, E2E e job SDD, obrigatórios na `main` — SPEC-0004:IT-01
- [ ] Release gera os zips `public` e `local` versionados e o `public` é enviado à Web Store pela API — SPEC-0006:IT-02

## 8. Questões em Aberto
- [x] Distribuição — pública na Web Store para o que a política permitir; o resto (ex.: YouTube) só em build local (Thomas, 2026-09-30)
- [x] Limite para conteúdo protegido — somente conteúdo sem DRM; nunca contornar DRM (Thomas, 2026-09-30)
- [x] Board — só no repositório (`tracker.provider: none`) (Thomas, 2026-09-30)
- [x] Fluxo de mudança — PR no GitHub com CI obrigatório e merge commit (Thomas, 2026-09-30)
- [x] Stack — Thomas domina .NET e já usou TypeScript; pediu a tecnologia mais compatível → TypeScript + WXT (ADR-0010) (Thomas, 2026-09-30)
- [x] Repositório GitHub — ainda não existe; git init local agora, repo criado em SPEC-0002 (Thomas, 2026-09-30)
- [x] Rigor dos pilares — `padrao` (Thomas, 2026-09-30)
- [x] Primeiro alvo — detector genérico (MP4/WebM direto) antes de providers específicos (Thomas, 2026-09-30)
- [x] Providers de cursos e a política da loja (paywall/login) — providers de cursos (Hotmart etc.) e YouTube só no build `local`; build `public` = detector genérico sem DRM (Thomas, 2026-09-30)
- [x] Conta de desenvolvedor da Web Store — Thomas vai criar; até existir, a publicação na loja (SPEC-0006) fica como impedimento externo e a produção é o zip `local` (Thomas, 2026-09-30)
- [x] Idiomas e nome — interface em pt-BR + en com `_locales` desde o início; nome provisório "Video Downloader", nome final definido na listagem da loja (SPEC-0006) (Thomas, 2026-09-30)
- [x] Visibilidade — repositório público no GitHub, licença MIT (Thomas, 2026-09-30)

## 9. Aprovação (H1)
Uma aprovação humana cobre o épico e as specs filhas apresentadas junto com ele. Registrada no frontmatter (`approved_by`, `approved_at`) do épico e de cada filha.

## 10. Registro de Impedimentos
| ID | Aberto em | Fase/Gate | Tipo | Descrição | Tentativas | Responsável | Resolução | Fechado em |
|---|---|---|---|---|---|---|---|---|

## 11. Relatório de Entrega

## 12. Emendas
| Versão | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
