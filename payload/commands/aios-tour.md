---
description: Tour guiado do AIOS — reexibe o guia completo de uso do sistema
---

# /aios-tour — Tour Guiado do AIOS

Releia o guia completo do AIOS a qualquer momento. Mostra os 10 agentes, os
3 squads, todos os slash commands, os fluxos (simple/medium/complex), as 9
skills, como funciona o paralelismo, e os primeiros passos.

## O que fazer

Leia e apresente ao usuario, de forma didatica, o conteudo do guia em:

```
~/.claude/aios/AIOS-GUIA.md
```

Use a tool Read para abrir o arquivo e entao explique as secoes principais ao
usuario. Se ele perguntar sobre uma parte especifica (ex: "como funciona o
paralelismo?" ou "o que o VIGIL faz?"), aprofunde nessa secao puxando os
detalhes dos arquivos referenciados (protocolos em `~/.claude/aios/protocols/`,
personas das squads em `~/.claude/aios/squads/`).

Se for a primeira vez do usuario, sugira o "Primeiros Passos" do guia:
rode `/aios` ou `/missao <descricao da sua tarefa>` para comecar.
