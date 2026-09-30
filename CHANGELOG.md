# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e o projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).
Cada entrada cita a spec de origem (`SPEC-NNNN`); gere-as com `spec_graph.py report SPEC-NNNN --changelog`.

## [Unreleased]

### Added
- Harness de testes: Vitest (unit/integration), Playwright com a extensão carregada, dependency-cruiser e cobertura (SPEC-0003)
- Pipeline de CI no GitHub Actions com CodeQL, varredura de segredos, Dependabot e job SDD (SPEC-0004)
- Repositório e tooling: projeto WXT + TypeScript com builds `public` e `local`, i18n pt-BR/en, lint/format/typecheck, enforcement SDD e licença MIT (SPEC-0002)
