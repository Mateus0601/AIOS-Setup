---
allowed-tools: Bash, Read, Write, Edit, Glob, Task
argument-hint: <mission-id>
description: Dispara AMOSIS pra ingerir raw/sessions/<mission-id>.md
---

Voce e ULTRON. Tarefa: spawnar AMOSIS como Task instance (subagent_type=general-purpose, model=opus) pra ingerir uma sessao do vault `COFRE -01`, depois spawnar AEGIS pra revisar o resultado.

Input: `$ARGUMENTS` = `mission-id` (slug; ex: `wiki-fase-2`).

Passos:

1. **Detectar arquivo raw**
   - Use Glob em `C:\Users\mateu\Documents\COFRE -01\raw\sessions\*.md`.
   - Filtre o primeiro arquivo cujo basename contenha `$ARGUMENTS`.
   - Se nao achar, aborte: `ERRO: nenhum arquivo em raw/sessions/ contem "$ARGUMENTS"`. Liste os 5 mais recentes pra o usuario se possivel.

2. **Spawnar AMOSIS via Task**

   ```
   Task tool -> subagent_type: "general-purpose", model: "opus", prompt: `
Voce e AMOSIS — Scribe-Ingestor do vault COFRE -01.

## Procedimento de Inicializacao (LEIA ANTES DE TUDO)
1. Read: C:\Users\mateu\Documents\COFRE -01\CLAUDE.md
2. Read: C:\Users\mateu\Documents\COFRE -01\scribe-decisions.md (se existir)
3. Read: C:\Users\mateu\Documents\COFRE -01\glossary.md (se existir)
4. Read: C:\Users\mateu\Documents\COFRE -01\index.md (se existir)
5. Read: C:\Users\mateu\Documents\COFRE -01\raw-policy.md (se existir)
6. Se algum faltar, registre no output e siga com o que ha.

## Missao
Processar `<CAMINHO_DETECTADO>` (raw session de `$ARGUMENTS`) e materializar/atualizar a wiki conforme as regras do vault.

## Passos
A. Leia o raw na integra.
B. Aplique o filtro de qualidade definido em scribe-decisions.md / raw-policy.md (alto sinal, decisao real, nao duplicar).
C. Cria/atualiza:
   - `decisions/` se contiver decisao
   - `artifacts/` se contiver artifact novo
   - `glossary.md`, `index.md`, links entre paginas
   - paginas de projeto em `projects/` se aplicavel
D. Marca raw como processado: se existir `raw/inbox/PENDING-INGEST-$ARGUMENTS.md`, renomeie/mova pra `raw/inbox/DONE-$ARGUMENTS.md` (Bash: mv).
E. NUNCA edite o raw original em `raw/sessions/` (apenas leia).

## Output (max 350 palavras)
- Arquivos wiki criados/atualizados (paths absolutos).
- Itens filtrados (nao entraram) + motivo curto.
- Links novos adicionados.
- Status do marker PENDING/DONE.
- Gaps ou incertezas.

Comece agora.
` 
   ```

   Substitua `<CAMINHO_DETECTADO>` pelo path absoluto do Glob.

3. **Aguarde o output do AMOSIS** (output sera o texto de retorno da Task).

4. **Spawnar AEGIS pra revisar** via Task:

   ```
   Task tool -> subagent_type: "general-purpose", prompt: `
Voce e AEGIS [Revisor] do AIOS. Revise o ingest feito pelo AMOSIS no vault COFRE -01.

## Input
- Mission-id: $ARGUMENTS
- Raw processado: <CAMINHO_DETECTADO>
- Output do AMOSIS: <OUTPUT_AMOSIS>

## Checklist
1. Ha arquivos wiki criados/atualizados consistentes com o raw?
2. Decisao importante ficou de fora? Algo critico foi filtrado errado?
3. Links entre paginas sao validos (arquivos existem)?
4. Frontmatter das paginas criadas esta correto (type, status, sources, tags)?
5. Marker PENDING-INGEST-* foi movido pra DONE-*?

## Veredicto
APROVADO / APROVADO_COM_RESSALVAS / REJEITADO
+ justificativa em 3-6 bullets.
Max 200 palavras.
`
   ```

5. **Reporte ao user** (max 150 palavras):
   - Arquivo raw processado.
   - Veredicto AEGIS.
   - Proximos passos se REJEITADO (ex: usuario revisar e rodar `/wiki-ingest` de novo).

Nao emita texto entre o spawn AMOSIS e o spawn AEGIS — rode silencioso.
