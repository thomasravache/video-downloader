# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e o projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).
Cada entrada cita a spec de origem (`SPEC-NNNN`); gere-as com `spec_graph.py report SPEC-NNNN --changelog`.

## [Unreleased]

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
