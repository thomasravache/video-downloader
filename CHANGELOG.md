# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e o projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).
Cada entrada cita a spec de origem (`SPEC-NNNN`); gere-as com `spec_graph.py report SPEC-NNNN --changelog`.

## [Unreleased]

## [0.1.0-rc.1] - 2026-10-02

### Added
- Detecção de vídeos diretos (MP4/WebM sem DRM) na página e download pelo popup; vídeos com DRM aparecem como protegidos, sem ação de download (SPEC-0005)
- Builds `public` (Chrome Web Store) e `local` a partir do mesmo código, com registro de providers por flavor (SPEC-0005, ADR-0011)
- Pipeline de release por tag: verificação de versão, `flavor-guard`, smoke E2E, GitHub Release e envio à Chrome Web Store (API v2) com aprovação (SPEC-0006)
- Harness de testes: Vitest (unit/integration), Playwright com a extensão carregada, dependency-cruiser e cobertura (SPEC-0003)
- Pipeline de CI no GitHub Actions com CodeQL, varredura de segredos, Dependabot e job SDD (SPEC-0004)
- Repositório e tooling: projeto WXT + TypeScript com builds `public` e `local`, i18n pt-BR/en, lint/format/typecheck, enforcement SDD e licença MIT (SPEC-0002)
