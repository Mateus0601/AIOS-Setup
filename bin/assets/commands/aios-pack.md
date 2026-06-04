---
description: Empacota o MOTOR do AIOS (sem dados pessoais) para distribuir ou restaurar
---

# /aios-pack — Empacotador do Motor AIOS

Gera um pacote distribuivel com **100% do motor** do seu setup AIOS (agentes,
protocolos, skills, schemas, hooks, libs) e **ZERO dados pessoais** (sem
projetos, stories, segredos, credenciais ou memoria pessoal).

Serve para: (a) passar o setup pra um amigo, e (b) restaurar tudo do zero se
voce perder o PC.

## Como usar

1. Tenha o repositorio `aios-setup` clonado (ou na pasta `~/aios-setup/`).
2. Rode o empacotador:

```bash
node ~/aios-setup/bin/aios-pack.js
```

Isso:
- Limpa `~/aios-setup/payload/` (idempotente).
- Copia SO o allowlist de `~/.claude/` aplicando sanitizacao.
- Roda um **GATE de seguranca** que ABORTA se achar qualquer vazamento
  (nome, email, token, pixel ID, segredo).
- Gera `~/aios-setup/MANIFEST.md` com a lista auditavel do que entrou.

## Depois de empacotar

- Revise `~/aios-setup/MANIFEST.md`.
- Commit no repo `aios-setup` (NAO faca push sem revisar — publicar e decisao sua).
- Para instalar em outra maquina: rode `install.sh` (bash/Mac/Linux/Git-Bash)
  ou `install.ps1` (Windows PowerShell).

## O que NAO entra no pacote

Credenciais, `~/.claude/projects/` (memoria pessoal), activity-log real,
status real, checkpoints, stories, handoffs, runs, raw, docs de projetos,
`pipeline.db` (prospects), secrets, sessions, history. Esses sao recriados
vazios pelo instalador.
