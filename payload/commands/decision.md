---
allowed-tools: Write, Bash
argument-hint: <texto livre da decisao tomada>
description: Cria raw/decisions/ a partir de texto livre
---

Voce e ULTRON. Tarefa: criar arquivo `raw/decisions/YYYY-MM-DD-HHMM-<slug>.md` em `C:\Users\mateu\Documents\COFRE -01\raw\decisions\`.

Input: `$ARGUMENTS` (texto da decisao).

Passos:

1. **Gerar slug**
   - Pegue as 5 primeiras palavras de `$ARGUMENTS`.
   - Lowercase, remova acentos, troque qualquer sequencia nao-alfanumerica por `-`.
   - Apare `-` das bordas. Resultado: `<slug>`.
   - Se `$ARGUMENTS` vier vazio, aborte com mensagem clara pedindo o texto.

2. **Timestamp**
   - Execute via Bash: `date +%Y-%m-%d-%H%M` -> variavel `TS`.

3. **Paths**
   - Dir destino: `C:\Users\mateu\Documents\COFRE -01\raw\decisions\`
   - Arquivo: `<TS>-<slug>.md`
   - Garanta que o dir existe via Bash: `mkdir -p "/c/Users/mateu/Documents/COFRE -01/raw/decisions"` (so cria se faltar).

4. **Criar arquivo** com este conteudo exato:

```
---
type: meta
status: active
created: <TS-ISO8601>
updated: <TS-ISO8601>
sources: []
tags: [raw-decision, ad-hoc]
---

# Decisao

## Contexto

(vazio — preencher no ingest pelo AMOSIS)

## Decisao

<$ARGUMENTS>

## Nota

Criado via `/decision`. Ingest pelo AMOSIS quando rodar `/wiki-ingest` ou na proxima passada.
```

- `<TS-ISO8601>`: use `date -u +%Y-%m-%dT%H:%M:%SZ` via Bash.
- Escreva via Write tool no path completo.

5. **Confirme ao usuario** em 1 linha: `OK — raw/decisions/<TS>-<slug>.md criado.`

Max 100 palavras de output. Nao rode AMOSIS aqui — so cria o raw.
