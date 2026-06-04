# AIOS — Guia de Uso Completo

> **AIOS** = AI Operating System. Um sistema multi-agente que roda dentro do
> Claude Code. Voce conversa com **um orquestrador** (ULTRON) e ele coordena
> uma equipe de agentes especializados para planejar, construir, revisar e
> entregar trabalho — software, documentos, pesquisa, prospeccao.
>
> Este guia ensina a usar **100% do AIOS**. Para reexibir a qualquer momento:
> rode `/aios-tour`.

---

## 1. A ideia em 30 segundos

Voce nao fala com "uma IA". Voce fala com **ULTRON**, o orquestrador. Ele:

1. Classifica a complexidade da sua tarefa (simples / media / complexa).
2. Spawna os agentes certos, cada um numa instancia separada (Task).
3. Coordena o fluxo silenciosamente e so volta a falar com voce no fim
   (checkpoint) ou quando precisa de uma decisao sua.

A regra de ouro: **ULTRON coordena, NUNCA executa direto**. Quem escreve
codigo e o **FORGE**. Quem revisa e o **AEGIS**. E assim por diante.

---

## 2. Os 10 agentes (3 squads + 1 independente)

### Squad Engenharia (constroi e revisa)

| Agente | Papel | O que faz |
|--------|-------|-----------|
| **ULTRON** | Orquestrador | Coordena tudo, classifica complexidade, resolve conflitos, dispatcha agentes. Nunca escreve codigo. E com quem voce conversa. |
| **VIGIL** | Estrategista | Valida a abordagem, define a arquitetura, gera story files, lista quais skills o FORGE deve usar. Nunca escreve codigo. |
| **FORGE** | Executor | Implementa de verdade — frontend e backend. Raciocina com CoT + ReACT, max 3 iteracoes. Pragmatico, evita overengineering. |
| **AEGIS** | Revisor | Revisa TODA entrega. Tem poder de veto. Emite `approved`, `approved_with_conditions` ou `rejected`. Nada chega a voce sem passar por ele. |

### Squad Produto (pensa o produto ANTES da engenharia)

| Agente | Papel | O que faz |
|--------|-------|-----------|
| **MORGAN** | Product Manager | Escreve PRDs, define roadmap e estrategia. Lider da squad. Advisor do ULTRON. |
| **PAX** | Product Owner | Guarda o backlog, prioriza features, valida requisitos e criterios de aceite. |
| **RIVER** | Scrum Master | Quebra epicos em stories, define tasks, gerencia impedimentos. |
| **ATLAS** | Analyst | Pesquisa de mercado, analise competitiva, deep research. Traz MUITOS resultados de varias regioes. |

> **Regra:** a Squad Produto NUNCA escreve codigo. A saida sao **documentos**
> (PRDs, backlogs, stories, relatorios de pesquisa).

### Squad Growth (prospeccao e outreach)

| Agente | Papel | O que faz |
|--------|-------|-----------|
| **LINK** | Prospector | Caca leads, cria outreach personalizado, gerencia um pipeline SQLite, planeja campanhas. |

> **Regra:** LINK NUNCA envia email nem posta sem **aprovacao explicita** sua.
> Ele prepara tudo (drafts, relatorios, contact cards) e voce aprova.

### Independente

| Agente | Papel | O que faz |
|--------|-------|-----------|
| **AMOSIS** | Escriba (Wiki) | Mantem o "vault" de conhecimento (wiki semantico). Destila notas brutas em paginas organizadas. Nunca inventa, nunca escreve codigo. (Opcional — voce so usa se montar um vault Obsidian.) |

---

## 3. Os fluxos (como ULTRON decide o caminho)

ULTRON classifica TODA tarefa primeiro e escolhe o fluxo:

| Complexidade | Quando | Fluxo |
|--------------|--------|-------|
| **simple** | 1-3 arquivos, fix pontual, zero ambiguidade | ULTRON → **FORGE** → **AEGIS** → checkpoint |
| **medium** | 4-10 arquivos, feature com alguma decisao tecnica | ULTRON → **VIGIL** → **FORGE** → **AEGIS** → checkpoint |
| **complex** | 10+ arquivos, sistema novo, varias decisoes | ULTRON → **VIGIL** → **Group Chat** → **FORGE** → **AEGIS** → checkpoint |

Pontos fixos, sem excecao:
- **AEGIS sempre revisa.** Nenhuma entrega pula a revisao.
- **Frontend/UI:** FORGE implementa direto usando a skill `frontend-design`.
- **Group Chat:** debate multi-agente, max 2 rodadas; 3 de 4 concordando = convergiu.
- **Fluxo continuo:** ULTRON nao fica narrando ("processando...", "aguardando...").
  Roda o pipeline em silencio e so fala no checkpoint final ou pra te perguntar algo.

### Quando ULTRON para e te pergunta?

So em 4 situacoes (senao ele decide sozinho, porque voce pode estar ausente):
(a) acao irreversivel (deletar dados, force push, publicar em canal publico),
(b) gasto de dinheiro (API paga, servico pago),
(c) decisao estrategica/roadmap,
(d) preferencia sua sem default obvio em que a escolha errada custaria horas.

---

## 4. Slash commands

### Squad Engenharia
- `/ultron` — invoca o orquestrador (ou so converse normalmente).
- `/vigil` — chama o estrategista direto.
- `/forge` — chama o executor direto.
- `/aegis` — chama o revisor direto.

### Squad Produto
- `/pm` — Morgan (PRD, roadmap, estrategia).
- `/po` — Pax (backlog, priorizacao).
- `/sm` — River (quebrar epicos em stories).
- `/analyst` — Atlas (pesquisa de mercado, deep research).

### Squad Growth
- `/link-prospect` — Link (prospeccao, outreach, pipeline).

### Sistema
- `/aios` — visao geral / inicia o sistema.
- `/missao <descricao>` — abre uma nova missao formal.
- `/implementacao` — melhorias internas do proprio AIOS.
- `/continue` — retoma trabalho pendente apos um crash/fechamento.
- `/fast-mode <task>` — **opt-in**: ULTRON executa direto + AEGIS revisa
  depois (so vale pra aquela task; ULTRON nunca propoe, so voce ativa).
- `/aios-pack` — empacota o motor pra distribuir/restaurar (sem dados pessoais).
- `/aios-tour` — reexibe este guia.

> Instalou via npm? O comando de instalacao e `aios-mateus` (rode no terminal,
> fora do Claude Code). Dentro do Claude Code, use `/aios-tour` para rever isto.

### Extras (escriba / housekeeping)
- `/artifact` — registra um artefato criado fora do fluxo.
- `/decision` — registra uma decisao.
- `/wiki-ingest` — dispara o AMOSIS pra ingerir notas no vault.

---

## 5. As 9 skills (conhecimento que o FORGE aplica)

Skills sao guias de boas praticas que o FORGE le e aplica quando a tarefa
pede. O mecanismo e **PUSH**: VIGIL (ou ULTRON) lista quais skills usar em
`requiredSkills`, e o FORGE aplica exatamente essas.

| Skill | Para que serve |
|-------|----------------|
| `api-design` | Criar/modificar REST, GraphQL, endpoints, contratos entre sistemas. |
| `backend-patterns` | Logica server-side, tratamento de erro, logging, config, estrutura de servicos. |
| `database-design` | Modelagem de dados, schemas, queries, migrations, escolha de banco. |
| `system-architecture` | Decisoes arquiteturais, fronteiras entre modulos/servicos, escolha de padroes. |
| `infrastructure` | Containers, deploy em cloud, rede, escala, config de ambiente. |
| `cicd-monitoring` | Pipelines de build/deploy, estrategias de release, observabilidade, rollback. |
| `security-auth` | Autenticacao, autorizacao, protecao contra ataques, dados sensiveis. |
| `frontend-design` | Qualquer UI — landing pages, slides, web apps, componentes, dashboards. Foco em design premium, nao generico. |
| `pdf-generation` | Gerar PDF (relatorio, apostila, fatura, certificado) via HTML + Playwright. |

---

## 6. Paralelismo (rodar varias missoes ao mesmo tempo)

Por padrao, uma missao roda sozinha (fluxo normal). Quando voce tem **2 ou
mais projetos** pra tocar ao mesmo tempo, ULTRON vira um **run dispatcher**:

- Abre um "run" por missao (`runs/{runId}/`), registrado num indice.
- Respeita um teto de concorrencia definido em `aios/concurrency.json`
  (`maxConcurrentRuns`, agentes por run, teto global). Runs/agentes acima do
  teto entram numa FILA FIFO e sao puxados quando abre vaga.
- Spawna **um sub-orquestrador por run** — cada um roda o pipeline
  VIGIL→FORGE→AEGIS daquele projeto e devolve o resultado consolidado.
- AEGIS roda por run (um por pipeline).
- `/continue` em modo multi-run lista os runs ativos e pergunta qual retomar.

> Em maquina modesta (ex: 8GB RAM), o teto vem conservador (~2 runs). Em
> maquina melhor / nuvem, basta subir os numeros em `concurrency.json` — o
> mesmo motor escala sem mudar codigo.

Detalhes: `~/.claude/aios/protocols/runs-protocol.md`.

---

## 7. Onde mora cada coisa

| Componente | Caminho |
|------------|---------|
| Bootstrap do modo ULTRON | `~/CLAUDE.md` |
| Cerebro auto-carregado | `~/.claude/rules/doc-roots.md` + `rules/ultron-core.md` |
| Protocolos (12) | `~/.claude/aios/protocols/` |
| Skills (9) | `~/.claude/aios/skills/` |
| Schemas de validacao | `~/.claude/aios/schemas/` |
| Libs (paralelismo, locks, activity-log) | `~/.claude/aios/lib/` |
| Engine de handoff (Python) | `~/.claude/aios/core/handoff_engine.py` |
| Personas Squad Produto | `~/.claude/aios/squads/produto/` |
| Persona Squad Growth | `~/.claude/aios/squads/growth/` |
| Slash commands | `~/.claude/commands/` |
| Hooks (validacao, telemetria, notify) | `~/.claude/hooks/` |
| Log central de acoes | `~/.claude/aios/activity-log.json` |
| Estado atual (recovery) | `~/.claude/aios/status.json` |

> Tudo que e "pessoal" (seus projetos, stories, checkpoints, memoria) e
> criado por VOCE conforme usa. O pacote so traz o **motor**.

### O papel do `~/CLAUDE.md` (liga o modo ULTRON)

O `~/CLAUDE.md` e o **bootstrap** do sistema: e ele que faz o Claude Code
operar como **ULTRON** (orquestrador) em vez de uma IA generica. Ele aponta
para `~/.claude/rules/doc-roots.md` (o cerebro) e define as regras de
comportamento (NUNCA/SEMPRE).

O instalador copia um `CLAUDE.md` **generico** (com a secao "Projetos Ativos"
em branco) para `~/CLAUDE.md` **somente se voce ainda nao tiver um** — assim ele
nunca sobrescreve um CLAUDE.md seu. Depois de instalar, **edite a secao
"Projetos Ativos"** com os seus projetos (path, stack, comandos). Sem o
`~/CLAUDE.md`, o Claude Code nao entra no modo ULTRON.

---

## 8. Primeiros passos

0. **Como voce chegou aqui:** se instalou via npm, foi com
   `npm i -g github:Mateus0601/AIOS-Setup` e depois `aios-mateus` (mesma
   sequencia em macOS/Windows/Linux). Para rever este guia: `/aios-tour`.
1. **Confirme o Node:** os hooks e libs usam Node 18+. Rode `node -v`.
2. **Instale as deps das libs** (se ainda nao):
   `npm install --prefix ~/.claude/aios/lib`
3. **(Opcional) Ajuste `settings.json`:** o template vem com
   `defaultMode: "acceptEdits"` (seguro). Veja o `_note` dentro do arquivo se
   quiser reativar o modo agressivo.
4. **Personalize sua memoria:** edite `~/.claude/aios/memory_blocks.json` e
   troque o template `<seu nome>` pelos seus dados (opcional).
5. **Comece:** rode `/aios` para a visao geral, ou ja mande uma tarefa:

   ```
   /missao Crie uma landing page para meu produto X
   ```

   ULTRON vai classificar, spawnar os agentes e te entregar o resultado.

6. **Reconfigurar MCPs/credenciais:** o pacote NAO traz tokens nem MCP auth.
   Configure seus MCP servers (memory, playwright, supabase, etc.) e logins
   normalmente — veja o README do pacote.

---

## 9. Regras de comportamento que voce vai notar

- **ULTRON nunca implementa direto** — sempre spawna FORGE, mesmo pra 1 linha.
- **AEGIS nunca e pulado** — toda entrega e revisada.
- **Fluxo continuo** — sem "processando...", "aguardando..." entre agentes.
- **Autonomia tecnica** — ambiguidade tecnica o agente resolve sozinho; so
  escala pra voce decisoes irreversiveis, gastos ou estrategia.
- **Sempre o melhor modelo** — sem downgrade por custo.
- **Tudo registrado** — cada acao vai pro `activity-log.json`.

Bom proveito. Rode `/aios-tour` quando quiser reler isto.
