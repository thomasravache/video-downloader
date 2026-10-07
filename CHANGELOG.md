# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e o projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).
Cada entrada cita a spec de origem (`SPEC-NNNN`); gere-as com `spec_graph.py report SPEC-NNNN --changelog`.

## [Unreleased]

## [0.1.0-rc.6] - 2026-10-07

### Added
- Suporte a HLS com audio separado em TS ou ADTS e desduplicacao no YouTube (SPEC-0019)

## [0.1.0-rc.5] - 2026-10-07

### Fixed
- Corrigir transmuxer HLS TS com MP4 compativel, ignorar legendas e enriquecer titulo (SPEC-0018)

## [0.1.0-rc.4] - 2026-10-06

### Added
- Contexto de requisição da página para buscar playlists e segmentos recusados com 403 (SPEC-0016, ADR-0015)
- HLS com criptografia AES-128 por chave de sessão no flavor local (SPEC-0017, ADR-0015)

## [0.1.0-rc.3] - 2026-10-03

### Added
- Download de HLS cujos segmentos são trechos de um único arquivo (`EXT-X-BYTERANGE`, `EXT-X-MAP` com `BYTERANGE`), com requisições `Range` validadas (só `206` com `Content-Range` coerente) e recusa antecipada acima do limite (SPEC-0013)
- Vídeo e áudio em playlists separadas (`EXT-X-MEDIA TYPE=AUDIO`) são baixados e juntados num único MP4, sem recodificar, com a biblioteca Mediabunny (MPL-2.0) carregada só quando há áudio separado; áudio criptografado, ao vivo ou inválido recusa o download inteiro (SPEC-0014, ADR-0014)
- Aviso de licenças de terceiros (`THIRD_PARTY_NOTICES.txt`) na raiz do pacote, sem nada na interface (SPEC-0014)
- Popup com um cartão por vídeo: fontes redundantes ficam recolhidas em "Outras fontes (N)" e, havendo mais de um idioma, um seletor de áudio; o MP4 mantém o idioma da faixa escolhida (SPEC-0015)

### Changed
- O cartão "arquivo" da página que aponta para a própria playlist HLS passa a ser o cartão HLS, com o título da página, em vez de oferecer o download do texto da playlist (SPEC-0013)
- O cartão `blob` ("Not supported yet") deixa de aparecer quando há outra fonte baixável na aba (SPEC-0013)
- Limite de memória de 512 MiB para downloads com junção de áudio e vídeo (SPEC-0014)

### Fixed
- Playlist com byte range deixa de falhar com "Could not read this video's playlist" (SPEC-0013)

## [0.1.0-rc.2] - 2026-10-02

### Added
- Detecção em iframes e acesso por site: permissão opcional pedida no popup no build `public` (SPEC-0009, ADR-0012)
- Detecção por rede (media sniffing) observando requisições de mídia, sem bloquear nem alterar tráfego (SPEC-0010)
- Playlists HLS: parser, escolha de variante e candidato no popup; HLS criptografado ou com DRM aparece como protegido (SPEC-0011)
- Download de HLS sem criptografia: busca dos segmentos, junção em MP4 e barra de progresso com cancelamento; playlists ao vivo, criptografadas ou com byte range são recusadas (SPEC-0012, ADR-0013)

### Changed
- Chrome mínimo 116 (`minimum_chrome_version`) por causa do documento offscreen (SPEC-0012)

## [0.1.0-rc.1] - 2026-10-02

### Added
- Detecção de vídeos diretos (MP4/WebM sem DRM) na página e download pelo popup; vídeos com DRM aparecem como protegidos, sem ação de download (SPEC-0005)
- Builds `public` (Chrome Web Store) e `local` a partir do mesmo código, com registro de providers por flavor (SPEC-0005, ADR-0011)
- Pipeline de release por tag: verificação de versão, `flavor-guard`, smoke E2E, GitHub Release e envio à Chrome Web Store (API v2) com aprovação (SPEC-0006)
- Harness de testes: Vitest (unit/integration), Playwright com a extensão carregada, dependency-cruiser e cobertura (SPEC-0003)
- Pipeline de CI no GitHub Actions com CodeQL, varredura de segredos, Dependabot e job SDD (SPEC-0004)
- Repositório e tooling: projeto WXT + TypeScript com builds `public` e `local`, i18n pt-BR/en, lint/format/typecheck, enforcement SDD e licença MIT (SPEC-0002)
