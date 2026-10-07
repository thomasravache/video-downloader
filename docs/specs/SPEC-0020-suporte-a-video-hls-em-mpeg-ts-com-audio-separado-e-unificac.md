---
id: SPEC-0020
title: Suporte a video HLS em MPEG-TS com audio separado e unificacao de cartoes
tier: full
type: feature
user_facing: true
status: in-progress
created: 2026-10-07
parent:
depends_on: [SPEC-0019]
consumes_contract: [SPEC-0014@1, SPEC-0015@1, SPEC-0018@1, SPEC-0019@1]
contract_version: 1
touches:
  - src/core/candidates.ts
  - src/core/service.ts
  - entrypoints/offscreen/assemble.ts
  - entrypoints/offscreen/merge.ts
  - entrypoints/offscreen/run-job.ts
  - entrypoints/popup/view.ts
  - entrypoints/popup/main.ts
  - tests/unit/**
  - tests/integration/**
  - e2e/journeys/**
adrs: [ADR-0014, ADR-0013, ADR-0001]
external: []
size: M
approved_by: thomas
approved_at: 2026-10-07
---

# SPEC-0020 — Suporte a vídeo HLS em MPEG-TS com áudio separado e unificação de cartões

## 1. Visão Geral
Esta especificação soluciona os problemas de download e reprodução no YouTube identificados na release `v0.1.0-rc.6`:
1. **Vídeo H.264 em MPEG-TS com áudio separado:** No YouTube HLS, as variantes em H.264/AVC1 (1080p, 720p, etc.) são transmitidas em contêineres MPEG-TS (`.ts` sem `#EXT-X-MAP`, onde `fmp4: false`), enquanto a trilha de áudio é transmitida separadamente em TS ou ADTS AAC. O núcleo (`src/core/service.ts`) ainda possuía uma trava que rejeitava downloads de vídeo que não fossem fMP4 com o erro `UNSUPPORTED` ("This kind of video is not supported yet."). Esta spec habilita a desmultiplexação e junção de vídeo MPEG-TS + áudio separado em um arquivo MP4 progressivo.
2. **Duração completa do áudio (resolução do áudio que parava aos 5.7s):** Ao inspecionar o vídeo de 720p baixado pelo usuário (`(17) VOCÊ PRECISA DESCANSAR (LENDO LIVROS) - YouTube - 720p (VP9).mp4`), constatou-se via `ffprobe` que a trilha de áudio tinha exatamente `duration=5.735329` (apenas 247 frames / 1 segmento), enquanto o vídeo durava 6 minutos e 50 segundos. Ao concatenar segmentos TS de áudio em um único Blob cru, o demuxer parava na fronteira do primeiro segmento TS. Esta spec utiliza o `mux.js.mp4.Transmuxer` (ADR-0013) para costurar todos os segmentos TS (tanto de áudio quanto de vídeo) em streams contínuos fMP4 antes de alimentar o montador Mediabunny, garantindo que o áudio cubra 100% da duração do vídeo.
3. **Compatibilidade QuickTime Player:** O primeiro botão do popup baixava a media playlist isolada em 4K no codec VP9 sem áudio, o que gerava um vídeo mudo e incompatível com o reprodutor nativo do macOS (QuickTime Player exibia o erro *"The file isn't compatible with QuickTime Player"*). Com a liberação das variantes H.264/AVC1 muxadas com áudio AAC em duração total, o download padrão gera um arquivo MP4 universalmente compatível com QuickTime Player, IINA, VLC, macOS Finder e navegadores.
4. **Unificação completa de cartões no popup:** Elimina a duplicação no popup quando o YouTube dispara tanto a Master Playlist (`hls_variant`) quanto a Media Playlist individual (`hls_playlist`). O cartão da Master Playlist passa a ser o único exibido em destaque (com os seletores de qualidade e áudio), agrupando ou suprimindo a media playlist individual com base no identificador de vídeo `/id/<id>/` ou relacionamento de variante.

## 2. Motivação & Escopo
**Motivação:** Na versão `v0.1.0-rc.6`, ao selecionar qualquer resolução H.264 (ex: 1080p H.264) em um vídeo do YouTube, a extensão falhava com o erro `UNSUPPORTED`. Ao clicar no primeiro botão (que baixava a media playlist capturada solta na rede), baixava-se um vídeo de 896 MB em 4K VP9 sem áudio, que não abria no QuickTime Player. Além disso, no download de 720p VP9, o som tocava por apenas 5.7 segundos no player IINA, pois apenas o primeiro segmento de áudio havia sido muxado. A extensão concorrente baixou com sucesso um arquivo de 136 MB em 1080p H.264 com áudio de 6 minutos e 50 segundos que abriu perfeitamente no QuickTime e no IINA.

**Objetivos (dentro do escopo):**
- Permitir que variantes de vídeo HLS em formato MPEG-TS (`media.fmp4 === false`) sejam aceitas em `downloadHls` quando associadas a faixas de áudio separadas (TS, ADTS AAC ou fMP4).
- No offscreen (`run-job.ts` / `assemble.ts` / `merge.ts`), utilizar `mux.js.mp4.Transmuxer` para processar a cadeia completa de segmentos TS de áudio e de vídeo em streams fMP4 contínuos e integrá-los no Mediabunny para produzir um MP4 progressivo com vídeo e áudio sincronizados por toda a duração.
- Unificar cartões no popup: associar media playlists individuais da rede à sua master playlist correspondente na mesma aba através do identificador do streaming (ex: `/id/<videoId>/` no pathname da URL da `googlevideo.com` ou variantes da master), evitando a exibição de dois cartões para o mesmo vídeo.
- Garantir que a variante H.264 selecionada por padrão produza um MP4 com streams de vídeo AVC1 e áudio AAC LC reconhecido e reproduzível pelo QuickTime Player no macOS e pelo IINA.

**Não-objetivos (fora do escopo):**
- Recodificação de vídeo VP9 para H.264 via software (transcoding consome CPU excessiva e é desnecessário já que o YouTube já disponibiliza streams nativas em H.264).
- Suporte a streams de vídeo protegidas por DRM Widevine (fora do escopo do projeto, respeitando ADR-0001).

## 3. Dependências
- **Implementações necessárias:** SPEC-0019 (suporte a áudio separado TS/ADTS e Mediabunny multiformato).
- **Contratos consumidos:** SPEC-0014@1, SPEC-0015@1, SPEC-0018@1, SPEC-0019@1.
- **Pré-requisitos externos:** Mediabunny v1.61.0 e mux.js v7.1.0 (já instalados como dependências do projeto).

## 4. Decisão Arquitetural
**Contexto:** O projeto utiliza o Mediabunny (ADR-0014) e o mux.js (ADR-0013) no documento offscreen. Na SPEC-0019, o Mediabunny foi configurado para suportar `formats: [MP4, ADTS, MPEG_TS]`. Porém, verificou-se que concatenar múltiplos buffers `.ts` brutos em um `Blob` faz com que o leitor MPEG-TS pare no primeiro segmento. O `mux.js.mp4.Transmuxer` foi projetado exatamente para HLS, iterando segmento a segmento e gerando um contêiner fMP4 contínuo (`initSegment` + `fragments`) que o Mediabunny consome perfeitamente em toda a extensão do vídeo.

**Decisão:**
1. Em `src/core/service.ts`:
   - Remover a exigência `if (!media.fmp4)` em `downloadHls` quando `audioTrack !== 'none'`. O vídeo pode ser entregue como MPEG-TS (`.ts`) ou fMP4 (`.mp4`/`.m4s`).
   - Montar o `JobPlan` permitindo que tanto o vídeo quanto o áudio tenham `initUrl` indefinido.
2. Em `entrypoints/offscreen/run-job.ts` e `assemble.ts`:
   - Se o áudio for TS (`audio.initUrl === undefined` com segmentos TS), passar a lista de segmentos pelo `mux.js.mp4.Transmuxer` para gerar o `audioBlob` em fMP4 contínuo.
   - Se o vídeo for TS (`request.fmp4 === false`), passar a lista de segmentos de vídeo pelo `mux.js.mp4.Transmuxer` para gerar o `videoBlob` em fMP4 contínuo.
   - Alimentar o `assembleMerged` com os blobs contínuos, gerando o MP4 final progressivo com áudio e vídeo de duração completa e timestamps alinhados.
3. Em `src/core/candidates.ts`:
   - Expandir a regra de associação em `groupCandidates`: uma master playlist HLS reivindica como `related` não apenas URLs que batem exatamente com `pathKey`, mas também media playlists HLS que compartilham o mesmo identificador de recurso de vídeo do YouTube (extraído do segmento `/id/<id>/` na URL da `googlevideo.com`).
   - No popup, cartões recolhidos sob a master não poluem a visualização principal com fluxos incompletos (mudos).

**Justificativa:** Mantém a arquitetura limpa existente em ADR-0014 e ADR-0013, aproveitando as ferramentas já existentes no repositório (`mux.js` e `mediabunny`) para resolver tanto a compatibilidade com MPEG-TS quanto o problema da duração do áudio, sem adicionar nenhuma dependência externa nova.

**Desvio do padrão existente:** Nenhum. Utiliza as bibliotecas e padrões já estabelecidos no projeto.

**Alternativas descartadas:**
- Tentar transcodificar VP9 para H.264 no navegador: descartado por lentidão extrema e consumo proibitivo de memória. O YouTube já fornece H.264 nativamente.

**ADRs:** ADR-0014, ADR-0013, ADR-0001.

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** O muxing de vídeo H.264 TS com áudio AAC em MP4 deve rodar na velocidade de I/O de rede e disco do navegador, com pico de memória controlado pelo buffer de segmentos (< 3 segundos para remuxar).
- **Compatibilidade:** Arquivo resultante MP4 com codec AVC1/H.264 e áudio AAC LC abre sem erros no QuickTime Player do macOS e toca o áudio até o final no IINA e no VLC.
- **Segurança:** Isolamento mantido no documento offscreen sem injeção de scripts não confiáveis nem execução de código externo.
- **Privacidade e dados pessoais:** URLs de manifestos sensíveis continuam sanitizadas em logs conforme ADR-0006; nenhum token ou cookie vazado.
- **Disponibilidade e resiliência:** Tolerância a variações de container de vídeo e áudio (MPEG-TS, ADTS AAC, fMP4).
- **Acessibilidade (UI):** Popup mantém elementos de navegação por teclado e semântica de formulário intactas.
- **Custo:** N/A — extensão puramente cliente.

## 6. Artefato A — Contrato
**Interface:** `src/core/service.ts`, `src/core/candidates.ts`, `entrypoints/offscreen/run-job.ts`, `entrypoints/offscreen/assemble.ts`

```typescript
// Em src/core/service.ts:
// downloadHls aceita vídeo TS (media.fmp4 === false) com áudio separado:
if (audioTrack !== 'none') {
  if (noInit) {
    return refuse('HLS_NOT_RESOLVED', 'download.not_resolved');
  }
  // media.fmp4 pode ser false (MPEG-TS) ou true (fMP4)
}

// Em entrypoints/offscreen/assemble.ts:
// transmuxTsToFmp4(segments: readonly Uint8Array[]): Promise<{ initSegment: Uint8Array; fragments: Uint8Array[] }>
// Transmuta uma série de segmentos TS em fMP4 contínuo preservando todos os segmentos de áudio/vídeo

// Em src/core/candidates.ts:
// groupCandidates associa media playlists do YouTube ao grupo da master
// quando compartilham o mesmo identificador /id/<id>/ no pathname ou query
```

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| Download de vídeo H.264 MPEG-TS com áudio | Variante H.264 sem `#EXT-X-MAP` (`fmp4: false`) e áudio TS/ADTS | `service.downloadHls` aprova o plano de job sem recusar com `UNSUPPORTED` | UT-01, IT-01 |
| Agrupamento de media playlist YouTube com master | Lista contém master `hls_variant` e media `hls_playlist` com mesmo `/id/<id>/` | `groupCandidates` agrupa a media playlist sob a master como `related` | UT-02 |
| Execução offscreen de merge com vídeo sem initUrl | Mensagem de início de job com vídeo TS (`initUrl: undefined`) e áudio TS/ADTS | `run-job.ts` baixa segmentos de vídeo e áudio e aciona `assembleMerged` gerando MP4 | UT-03, IT-02 |
| Áudio TS multi-segmento transmuxado com duração completa | Áudio com múltiplos segmentos TS (ex: 60 segmentos de 6s cada) | Transmux gera fMP4 contendo a totalidade dos frames de todos os segmentos, sem parar no primeiro | UT-04 |
| Preservação de fMP4 completo existente | Master e áudio onde ambos são fMP4 (formato Hotmart) | Continua baixando e juntando normalmente sem regressão | CH-01 |
| Contrato de JobPlan flexível | `JobPlan` com `initUrl?: string` para vídeo e áudio | Tipos compilam e respeitam o contrato sem quebras | CT-01 |
| Jornada do usuário no YouTube com 1080p H.264 | Usuário abre popup em vídeo do YouTube e seleciona 1080p H.264 | Popup exibe cartão unificado, baixa MP4 e conclui com sucesso com áudio de duração completa | E2E-01 |

## 7. Artefato B — Plano de Testes (TDD)

### 7.1 Testes de Caracterização
- **CH-01** — Dado um cenário com master playlist e faixas de áudio fMP4 (comportamento validado na SPEC-0014 e SPEC-0019), quando o download é iniciado, então o fluxo é concluído com sucesso gerando MP4 válido (guarda: passa antes da mudança).

### 7.2 Testes Unitários
- **UT-01** — Dado um candidato HLS cuja variante de vídeo é MPEG-TS (`media.fmp4 === false`, sem `#EXT-X-MAP`) e cuja faixa de áudio é TS/ADTS, quando `downloadHls` é acionado, então o download não é recusado com `UNSUPPORTED` e emite `JobPlan` válido.
- **UT-02** — Dado uma lista de candidatos contendo uma master playlist do YouTube (`/api/manifest/hls_variant/.../id/679c932c...`) e uma media playlist individual (`/api/manifest/hls_playlist/.../id/679c932c...`), quando `groupCandidates` é chamado, então a media playlist é reivindicada como `related` sob o grupo da master.
- **UT-03** — Dado o executor `run-job.ts` recebendo um plano de merge onde o vídeo não possui `initUrl` (`fmp4: false`), quando os segmentos são baixados, então o buffer de vídeo é entregue ao `assembleMerged` sem exigir init segment.
- **UT-04** — Dado múltiplos segmentos TS de áudio (cada um com ~6 segundos), quando o transmuxer de áudio processa a sequência, então a saída fMP4 gerada contém a soma temporal de todos os segmentos (ex: ~12s para 2 segmentos) e não é truncada ao fim do primeiro segmento.

### 7.3 Testes de Integração
- **IT-01** — Dado o serviço HLS integrado com o repositório de jobs, quando um download de 1080p H.264 do YouTube com áudio é solicitado, então o job é aceito e o offscreen recebe o comando `start` com a configuração correta de vídeo e áudio.
- **IT-02** — Dado o documento offscreen executando um job de merge com vídeo H.264 MPEG-TS e áudio TS multi-segmento, quando o pipeline finaliza, então é gerado um Blob MP4 contendo ambas as faixas com durações correspondentes à duração total do vídeo.

### 7.4 Testes de Contrato
- **CT-01** — Dado o contrato `JobPlan`, quando instanciado sem `initUrl` no vídeo e sem `initUrl` no áudio, então as estruturas atendem às regras estritas de tipos do TypeScript.

### 7.5 Testes E2E
- **E2E-01** — [jornada: baixar-hls] Dado que o usuário navega em um vídeo do YouTube com variantes H.264 e VP9, quando abre o popup da extensão, então visualiza um único cartão com seletores, escolhe a opção 1080p (H.264) com áudio em Português e realiza o download com sucesso, resultando em um vídeo reproduzível com áudio sincronizado.

### 7.6 Outros
- Performance: Muxing via Mediabunny e mux.js sem recodificação mantendo tempo de empacotamento < 3s.
- Compatibilidade: Arquivo MP4 gerado tem cabeçalhos AVC1 e AAC reconhecidos pelo QuickTime Player e toca áudio integral no IINA.

## 8. Plano de Rollout
- **Estratégia:** Deploy no branch `main` via PR após aprovação e validação completa dos gates de qualidade.
- **Dados/schema:** N/A — sem alterações em persistência.
- **Compatibilidade:** Totalmente compatível com todas as fontes já suportadas (Hotmart, plataformas genéricas, YouTube VP9 e H.264).
- **Observabilidade:** Métricas e diagnósticos registram tipo de container de vídeo e áudio.
- **Rollback:** Reversão do commit de merge via git em caso de anomalia.

## 9. Questões em Aberto
Nenhuma questão impeditiva.

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
- [ ] Fase 0: Teste de caracterização CH-01 commitado passando.
- [ ] Fase 1: Escrever testes unitários e de integração Red (UT-01..04, IT-01..02, CT-01, E2E-01) com a tag `SPEC-0020:<ID>` e confirmar que falham pelo motivo esperado.
- [ ] Fase 2: Implementar suporte a vídeo MPEG-TS em `service.ts` relaxando a trava de `media.fmp4` e aprimorar agrupamento em `candidates.ts`.
- [ ] Fase 3: Ajustar `run-job.ts` e `assemble.ts` para transmuxar áudio e vídeo TS em fMP4 contínuo antes do merge.
- [ ] Fase 4: Rodar todos os testes (unitários, integração, E2E, arquitetura, lint) e verificar tudo verde.
- [ ] Fase 5: Validação do gate G4 (Review independente), G5 (CI) e PR de entrega.

## 12. Registro de Gates
<!-- Preenchido pelo comando `spec_graph.py gate SPEC-0020 <G>`. Não edite as linhas de tabela manualmente. -->
| Gate | Decisão | Data | Evidência / Detalhes |
|---|---|---|---|
| G0 | PASS | validate: 0 erro(s) — d089018 | 2026-10-07 |
| H1 | PENDING | | |
| G1 | PASS | verify G1: PASS; `pnpm test` exit 1 (red: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯) — b973479 | 2026-10-07 |
| G2 | PASS | build exit 0 (✔ Finished in 291 ms); test exit 0 (Duration  59.10s (tests 97%, import 2%, transform 1%)); lint exit 0 (✔ Finished in 212 ms); coverage exit 0 (================================================================================) — 474a89a | 2026-10-07 |
| G3 | PENDING | | |
| G4 | PENDING | | |
| G5 | PENDING | | |
| H2 | PENDING | | |
| G6 | PENDING | | |
| G7 | PENDING | | |

## 13. Registro de Impedimentos
| ID | Aberto em | Fase/Gate | Tipo | Descrição | Tentativas | Responsável | Resolução | Fechado em |
|---|---|---|---|---|---|---|---|---|

## 14. Relatório de Entrega
<!-- Preenchido no fechamento (G7). -->

## 15. Emendas
| Versão do contrato | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
