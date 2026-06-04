---
allowed-tools: Write, Read, Bash
argument-hint: <path-do-arquivo> <descricao>
description: Registra artifact criado fora do fluxo agente
---

Voce e ULTRON. Tarefa: registrar um artifact (arquivo criado fora do fluxo de agentes) em `raw/artifacts/` do vault COFRE -01.

Input: `$ARGUMENTS` no formato `<path> <descricao livre>`.

Passos:

1. **Parse**
   - Primeiro token (ate o primeiro espaco ou, se estiver entre aspas, ate aspas fechantes): `PATH_ORIGEM`.
   - Resto do input: `DESCRICAO`.
   - Se faltar algum dos dois, aborte com mensagem clara explicando o formato esperado.

2. **Ler o arquivo origem**
   - Use Read tool em `PATH_ORIGEM`.
   - Se falhar (nao existe / binario / muito grande): aborte explicando o erro.
   - Pegue as primeiras 50 linhas — se o arquivo tiver menos, use tudo.

3. **Gerar slug e timestamp**
   - Slug: 5 primeiras palavras de `DESCRICAO`, lowercase, sem acento, `[^a-z0-9]+` -> `-`, bordas aparadas.
   - Data: `date +%Y-%m-%d` via Bash -> `TODAY`.
   - ISO: `date -u +%Y-%m-%dT%H:%M:%SZ` -> `TS_ISO`.

4. **Path relativo**
   - Se `PATH_ORIGEM` estiver dentro de `C:\Users\mateu\Documents\COFRE -01\`, calcule o relativo ao vault.
   - Caso contrario, registre o absoluto mesmo.

5. **Criar artifact**
   - Dir: `C:\Users\mateu\Documents\COFRE -01\raw\artifacts\` (mkdir -p se faltar).
   - Arquivo: `user-manual-<TODAY>-<slug>.md`
   - Conteudo:

```
---
type: meta
status: active
created: <TS_ISO>
updated: <TS_ISO>
sources: [<path-relativo-ou-absoluto>]
tags: [raw-artifact, user-manual]
---

# Artifact registrado manualmente

## Arquivo de origem

`<PATH_ORIGEM>`

## Conteudo (primeiras 50 linhas)

```
<50 primeiras linhas literais do arquivo>
```

## Descricao

<DESCRICAO>

## Nota

Criado via `/artifact`. AMOSIS vai processar no proximo ingest.
```

6. **Confirme**: `OK — raw/artifacts/user-manual-<TODAY>-<slug>.md criado.`

Max 120 palavras de output. Nao rode AMOSIS.
