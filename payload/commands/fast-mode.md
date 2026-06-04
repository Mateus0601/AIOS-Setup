# /fast-mode — ULTRON executa direto + AEGIS revisa pós-fato

Ativa **fast-mode opt-in** para a tarefa descrita nos argumentos. Vale APENAS pra esta task. Próximas tasks voltam ao default (full flow Task FORGE → Task AEGIS).

## Contrato

Ao receber este comando, ULTRON:

1. **Usa o melhor modelo (Opus) + consulta o Vault** (`wiki/`) — passo 1 do checklist continua obrigatório. Sem roteamento por custo (Smart Router removido). Exceção do Vault: projeto novo sem nada no Vault.

2. **Classifica complexidade** e mostra ao usuário em 1-2 linhas o que vai fazer (escopo, IDs/arquivos afetados, blast radius).

3. **Para ops destrutivas em ambiente compartilhado** (DELETE/DROP/mass-update em prod, force-push, storage purge, drop branch/tabela, mass file delete, chamadas API irreversíveis):
   - **OBRIGATÓRIO antes do primeiro comando destrutivo:** mapear FK chain via `information_schema.referential_constraints` ou probe abrangente das tabelas relacionadas. Não deixar constraint error te ensinar a ordem.
   - Mostrar plano completo (lista de tabelas + ordem de DELETE + storage paths) ao usuário antes de executar.
   - Confirmar escopo via AskUserQuestion se houver QUALQUER ambiguidade no que apagar.

4. **Executa direto na main thread** (sem spawnar FORGE).

5. **Spawn AEGIS pós-fato** via Task tool com `target: "aegis"`, passando todo o detalhamento da operação no `chain.forgeOutput` (incluindo IDs, ordem de DELETE, anomalias, sweep de verificação, sanity checks). Template em `~/.claude/aios/protocols/agent-templates.md` seção "AEGIS [Revisor]".

6. **Reporta veredicto AEGIS** ao usuário em formato compacto:
   - `verdict` (approved / approved_with_concerns / rejected)
   - Issues por severidade (critical / important / minor)
   - Verificações concretas que AEGIS rodou

7. **Reset implícito:** ao concluir, fast-mode desliga. Próxima task volta ao default.

## Quando NÃO usar

- Ambiguidade alta no escopo → use fluxo normal (VIGIL faz a clarificação).
- Operação que envolve múltiplos componentes ou decisões de arquitetura → fluxo medium/complex com VIGIL.
- Você não tem certeza dos IDs/escopo → não use fast-mode, deixe FORGE planejar.

## Regras invioláveis (não relaxam em fast-mode)

- **Melhor modelo (Opus) + consulta ao Vault continuam obrigatórios.** (Smart Router foi removido — sem downgrade de modelo.)
- **AEGIS continua obrigatório** — só muda de pré-fato pra pós-fato.
- **Confirmação explícita do escopo destrutivo** antes da execução. Fast-mode não autoriza apagar coisa errada rápido.
- **FK discovery upfront** pra DELETEs em DB.
- **Se AEGIS reprovar (verdict=rejected):** reportar imediatamente e propor remediação. Não esconder issues críticas atrás de "AEGIS revisou".

---

Tarefa para fast-mode:

$ARGUMENTS
