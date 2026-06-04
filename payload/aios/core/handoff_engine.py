#!/usr/bin/env python3
"""
AIOS Handoff Engine — Validation, Prompt Generation, Memory Management

Single-file engine that ULTRON calls via Bash to:
- Build structured handoff prompts with memory injection
- Validate agent responses against schemas
- Validate AIOS JSON files (for Claude Code hooks)
- Manage persistent memory blocks per agent
- Record transitions in state_graph.json

Usage:
  python handoff_engine.py build-prompt --target vigil --mission mission.json
  python handoff_engine.py validate-response --target vigil --output response.txt
  python handoff_engine.py validate-file path/to/file.json
  python handoff_engine.py memory get vigil
  python handoff_engine.py memory set vigil human "Nome: <seu nome>..."
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


# ─────────────────────────────────────────────────────────────
# Pydantic Models
# ─────────────────────────────────────────────────────────────

VALID_AGENTS = ("vigil", "forge", "aegis")
VALID_PRIORITIES = ("baixa", "media", "alta", "critica")
VALID_STATUSES = ("success", "partial", "error")
VALID_VERDICTS = ("approved", "approved_with_issues", "rejected")


class MemoryBlock(BaseModel):
    """Persistent memory block attached to an agent."""
    label: str
    description: str
    value: str
    char_limit: int = 800

    @field_validator("value")
    @classmethod
    def enforce_char_limit(cls, v: str, info) -> str:
        limit = info.data.get("char_limit", 800)
        if len(v) > limit:
            raise ValueError(f"Value ({len(v)} chars) exceeds limit ({limit})")
        return v


class Mission(BaseModel):
    id: str
    description: str
    project: str
    priority: str

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, v: str) -> str:
        if v not in VALID_PRIORITIES:
            raise ValueError(f"priority must be one of {VALID_PRIORITIES}")
        return v


class GotchaRef(BaseModel):
    id: str
    title: str
    workaround: str


class DecisionRef(BaseModel):
    id: int
    decision: str
    justification: str


class Context(BaseModel):
    storyFile: Optional[str]
    storyTasks: list[str]
    assignedTasks: list[str]
    gotchas: list[GotchaRef]
    decisions: list[DecisionRef]
    modifiedFiles: list[str]


class DebateEntry(BaseModel):
    from_agent: str = Field(alias="from")
    to_agent: str = Field(alias="to")
    topic: str
    message: str

    model_config = {"populate_by_name": True}


class Chain(BaseModel):
    vigilOutput: Optional[str] = None
    forgeOutput: Optional[str] = None
    debateHistory: list[DebateEntry] = []


class Instructions(BaseModel):
    persona: str
    responseSchema: str
    maxRetries: int = 2
    retryHint: Optional[str] = None

    @field_validator("responseSchema")
    @classmethod
    def validate_schema(cls, v: str) -> str:
        valid = ("response-vigil", "response-forge", "response-aegis")
        if v not in valid:
            raise ValueError(f"responseSchema must be one of {valid}")
        return v


class HandoffRequest(BaseModel):
    schema_version: str = Field(default="handoff-request-v1", alias="$schema")
    target: str
    mission: Mission
    context: Context
    chain: Chain
    instructions: Instructions

    model_config = {"populate_by_name": True}

    @field_validator("target")
    @classmethod
    def validate_target(cls, v: str) -> str:
        if v not in VALID_AGENTS:
            raise ValueError(f"target must be one of {VALID_AGENTS}")
        return v

    @model_validator(mode="after")
    def validate_chain_for_target(self) -> "HandoffRequest":
        t = self.target
        c = self.chain
        if t == "forge" and not c.vigilOutput:
            raise ValueError("FORGE requires chain.vigilOutput (non-empty string)")
        if t == "aegis":
            if not c.vigilOutput:
                raise ValueError("AEGIS requires chain.vigilOutput")
            if not c.forgeOutput:
                raise ValueError("AEGIS requires chain.forgeOutput")
        return self


# ─────────────────────────────────────────────────────────────
# Response Models (per agent)
# ─────────────────────────────────────────────────────────────

class BaseResponse(BaseModel):
    agent: str
    status: str
    summary: str
    artifacts: dict[str, Any] = {}
    issues: list[dict[str, Any]] = []
    metadata: dict[str, Any] = {}


# ─────────────────────────────────────────────────────────────
# Memory Manager
# ─────────────────────────────────────────────────────────────

DEFAULT_PERSONAS = {
    "vigil": "VIGIL [Estrategista] do AIOS. CTO/pensador critico. Valida abordagem, analisa trade-offs, define arquitetura. NUNCA coda.",
    "forge": "FORGE [Executor] do AIOS. Senior full-stack. Implementa, coda, cria, produz output concreto.",
    "aegis": "AEGIS [Revisor] do AIOS. Controle de qualidade. Poder de veto em issues criticas.",
    "ultron": "ULTRON [Orquestrador] do AIOS. CEO operacional. Coordena, distribui, resolve conflitos.",
}


class MemoryManager:
    """Manages persistent memory blocks per agent."""

    def __init__(self, memory_file: Path):
        self.memory_file = memory_file
        self.data: dict[str, list[dict]] = self._load()

    def _load(self) -> dict[str, list[dict]]:
        if self.memory_file.exists():
            raw = json.loads(self.memory_file.read_text(encoding="utf-8"))
            return raw.get("agents", {})
        return {}

    def save(self) -> None:
        payload = {
            "schema": "aios-memory-blocks-v1",
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "agents": self.data,
        }
        self.memory_file.parent.mkdir(parents=True, exist_ok=True)
        self.memory_file.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    def get_blocks(self, agent_id: str) -> list[MemoryBlock]:
        raw = self.data.get(agent_id)
        if raw:
            return [MemoryBlock(**b) for b in raw]
        # Initialize with defaults
        blocks = self._default_blocks(agent_id)
        self.data[agent_id] = [b.model_dump() for b in blocks]
        self.save()
        return blocks

    def _default_blocks(self, agent_id: str) -> list[MemoryBlock]:
        persona = DEFAULT_PERSONAS.get(agent_id, f"Agente {agent_id} do AIOS.")
        return [
            MemoryBlock(
                label="human",
                description="Fatos persistentes sobre o humano. Atualize ao aprender algo novo.",
                char_limit=800,
                value="Nome: <seu nome>. Idioma: <seu idioma>. Projetos: <seus projetos>. Preferencias: <ex: respostas diretas>. SO/shell: <ex: Windows + bash>.",
            ),
            MemoryBlock(
                label="persona",
                description="Identidade, conhecimento e estilo deste agente.",
                char_limit=600,
                value=persona,
            ),
            MemoryBlock(
                label="summary",
                description="Resumo executivo do historico relevante. Atualize ao final de cada tarefa.",
                char_limit=1200,
                value="Nenhum historico registrado ainda.",
            ),
            MemoryBlock(
                label="policies",
                description="Regras fixas de comportamento. Nao edite sem permissao explicita.",
                char_limit=500,
                value=(
                    "Sempre retorne output dentro de <HANDOFF_RESPONSE> tags com JSON valido.\n"
                    "Siga o schema indicado em instructions.responseSchema.\n"
                    "Priorize eficiencia de tokens.\n"
                    "Use handoff estruturado — texto livre vai em metadata.freeText."
                ),
            ),
        ]

    def update_block(self, agent_id: str, label: str, new_value: str) -> None:
        blocks = self.get_blocks(agent_id)
        for block in blocks:
            if block.label == label:
                # Validate by constructing — raises if char_limit exceeded
                MemoryBlock(
                    label=label,
                    description=block.description,
                    value=new_value,
                    char_limit=block.char_limit,
                )
                break
        else:
            raise ValueError(f"Block '{label}' not found for agent '{agent_id}'")

        # Update in raw data
        raw = self.data.get(agent_id, [])
        for item in raw:
            if item["label"] == label:
                item["value"] = new_value
                break
        self.save()

    def inject_into_prompt(self, agent_id: str, base_prompt: str) -> str:
        blocks = self.get_blocks(agent_id)
        memory_section = "\n### CORE MEMORY BLOCKS\n\n"
        for block in blocks:
            memory_section += (
                f'<{block.label} description="{block.description}">\n'
                f"{block.value}\n"
                f"</{block.label}>\n\n"
            )
        memory_section += (
            "### ARCHIVAL MEMORY\n"
            "Informacoes antigas podem ser movidas para archival. "
            "Use search_archive quando precisar de contexto historico.\n"
        )
        return base_prompt + "\n" + memory_section


# ─────────────────────────────────────────────────────────────
# Prompt Builder
# ─────────────────────────────────────────────────────────────

class PromptBuilder:
    """Generates complete handoff prompts from HandoffRequest + memory."""

    def __init__(self, memory: MemoryManager):
        self.memory = memory

    def build(self, request: HandoffRequest) -> str:
        """Build the full prompt for a target agent."""

        # 1. Structured handoff block
        request_dict = request.model_dump(by_alias=True)
        request_json = json.dumps(request_dict, indent=2, ensure_ascii=False)
        handoff_block = (
            f"<HANDOFF_REQUEST>\n{request_json}\n</HANDOFF_REQUEST>"
        )

        # 2. Persona (natural language, Phase 1 hybrid)
        persona_text = request.instructions.persona

        # 3. Mission summary
        m = request.mission
        mission_text = (
            f"TAREFA: {m.description}\n"
            f"PROJETO: {m.project}\n"
            f"PRIORIDADE: {m.priority}"
        )

        # 4. Context details
        ctx_parts: list[str] = []
        if request.context.storyFile:
            ctx_parts.append(f"STORY FILE: {request.context.storyFile}")
        if request.context.assignedTasks:
            ctx_parts.append(
                f"TASKS ATRIBUIDAS: {', '.join(request.context.assignedTasks)}"
            )
        if request.context.gotchas:
            g_str = "; ".join(
                f"[{g.id}] {g.title} — {g.workaround}"
                for g in request.context.gotchas
            )
            ctx_parts.append(f"GOTCHAS ATIVOS: {g_str}")
        if request.context.decisions:
            d_str = "; ".join(
                f"[D{d.id}] {d.decision}" for d in request.context.decisions
            )
            ctx_parts.append(f"DECISOES PREVIAS: {d_str}")
        if request.context.modifiedFiles:
            ctx_parts.append(
                f"ARQUIVOS JA MODIFICADOS: {', '.join(request.context.modifiedFiles)}"
            )
        context_text = "\n".join(ctx_parts) if ctx_parts else ""

        # 5. Chain (upstream outputs)
        chain_parts: list[str] = []
        if request.chain.vigilOutput:
            chain_parts.append(f"ANALISE DO VIGIL: {request.chain.vigilOutput}")
        if request.chain.forgeOutput:
            chain_parts.append(f"ENTREGA DO FORGE: {request.chain.forgeOutput}")
        if request.chain.debateHistory:
            debates = "\n".join(
                f"  [{d.from_agent} → {d.to_agent}] {d.topic}: {d.message}"
                for d in request.chain.debateHistory
            )
            chain_parts.append(f"HISTORICO DE DEBATES:\n{debates}")
        chain_text = "\n".join(chain_parts) if chain_parts else ""

        # 6. Response format instruction
        schema_name = request.instructions.responseSchema
        response_instruction = (
            f"FORMATO DE RESPOSTA OBRIGATORIO:\n"
            f"Retorne sua resposta dentro de tags <HANDOFF_RESPONSE>:\n\n"
            f"<HANDOFF_RESPONSE>\n"
            f"{{JSON conforme schema {schema_name}}}\n"
            f"</HANDOFF_RESPONSE>\n\n"
            f"Texto livre adicional pode ir APOS o bloco de response."
        )

        # 7. Retry hint
        retry_text = ""
        if request.instructions.retryHint:
            retry_text = f"\n⚠ RETRY: {request.instructions.retryHint}"

        # 8. Assemble base prompt
        sections = [
            persona_text,
            "",
            handoff_block,
            "",
            mission_text,
        ]
        if context_text:
            sections.append("")
            sections.append(context_text)
        if chain_text:
            sections.append("")
            sections.append(chain_text)
        sections.append("")
        sections.append(response_instruction)
        if retry_text:
            sections.append(retry_text)

        base_prompt = "\n".join(sections)

        # 9. Inject memory blocks
        return self.memory.inject_into_prompt(request.target, base_prompt)


# ─────────────────────────────────────────────────────────────
# Response Validator
# ─────────────────────────────────────────────────────────────

REQUIRED_FIELDS_BY_AGENT: dict[str, dict[str, list[str]]] = {
    "vigil": {
        "root": ["agent", "status", "summary", "artifacts", "issues", "metadata"],
        "artifacts": ["storyFile", "storyTaskCount", "decisions", "architecture", "risks"],
        "metadata": ["analysisDepth", "debateRequired", "debateTopics"],
    },
    "forge": {
        "root": ["agent", "status", "summary", "artifacts", "issues", "metadata"],
        "artifacts": ["completedTasks", "modifiedFiles", "testsRun", "storyFileUpdated"],
        "metadata": ["linesAdded", "linesRemoved", "buildStatus"],
    },
    "aegis": {
        "root": ["agent", "status", "summary", "artifacts", "issues", "metadata"],
        "artifacts": ["verdict", "critical", "important", "minor", "vigilDecisionsRespected", "tasksVerified"],
        "metadata": ["reviewDepth", "storyFileChecked"],
    },
}


class ResponseValidator:
    """Parses and validates HandoffResponse from agent output."""

    def parse_response(self, output: str) -> tuple[Optional[dict], str]:
        """
        Extract JSON from <HANDOFF_RESPONSE> tags.
        Returns (parsed_dict, parse_status).
        parse_status: "valid" | "cleaned" | "invalid_json" | "no_tags" | "empty"
        """
        if not output or not output.strip():
            return None, "empty"

        match = re.search(
            r"<HANDOFF_RESPONSE>\s*(.*?)\s*</HANDOFF_RESPONSE>",
            output,
            re.DOTALL,
        )
        if not match:
            return None, "no_tags"

        raw = match.group(1)

        # Try direct parse
        try:
            return json.loads(raw), "valid"
        except json.JSONDecodeError:
            pass

        # Try cleanup: remove comments, trailing commas, fix quotes
        cleaned = re.sub(r"//.*$", "", raw, flags=re.MULTILINE)
        cleaned = re.sub(r"/\*.*?\*/", "", cleaned, flags=re.DOTALL)
        cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
        try:
            return json.loads(cleaned), "cleaned"
        except json.JSONDecodeError:
            return None, "invalid_json"

    def validate_response(
        self, data: dict, target: str
    ) -> dict[str, Any]:
        """
        Validate parsed response against expected schema.
        Returns {level, errors, warnings}.
        level: "valid" | "partial" | "incomplete" | "invalid"
        """
        errors: list[str] = []
        warnings: list[str] = []

        if target not in REQUIRED_FIELDS_BY_AGENT:
            errors.append(f"Unknown target agent: {target}")
            return {"level": "invalid", "errors": errors, "warnings": warnings}

        schema = REQUIRED_FIELDS_BY_AGENT[target]

        # Check root fields
        for field in schema["root"]:
            if field not in data:
                errors.append(f"Missing root field: {field}")

        # Check agent match
        if data.get("agent") != target:
            errors.append(
                f"Agent mismatch: expected '{target}', got '{data.get('agent')}'"
            )

        # Check status enum
        if data.get("status") not in VALID_STATUSES:
            errors.append(f"Invalid status: '{data.get('status')}'")

        # Check summary non-empty
        if not data.get("summary"):
            warnings.append("summary is empty")

        # Check artifacts sub-fields
        artifacts = data.get("artifacts", {})
        if isinstance(artifacts, dict):
            for field in schema.get("artifacts", []):
                if field not in artifacts:
                    warnings.append(f"Missing artifacts.{field}")
        else:
            errors.append("artifacts must be an object")

        # Check metadata sub-fields
        metadata = data.get("metadata", {})
        if isinstance(metadata, dict):
            for field in schema.get("metadata", []):
                if field not in metadata:
                    warnings.append(f"Missing metadata.{field}")
        else:
            errors.append("metadata must be an object")

        # Agent-specific checks
        if target == "aegis" and isinstance(artifacts, dict):
            verdict = artifacts.get("verdict")
            if verdict and verdict not in VALID_VERDICTS:
                errors.append(f"Invalid verdict: '{verdict}'")

        # Determine level
        if errors:
            level = "incomplete" if any("Missing" in e for e in errors) else "invalid"
        elif warnings:
            level = "partial"
        else:
            level = "valid"

        return {"level": level, "errors": errors, "warnings": warnings}

    def build_fallback_response(self, target: str, raw_output: str) -> dict:
        """Build minimal valid response from free text (fallback)."""
        fallbacks = {
            "vigil": {
                "agent": "vigil",
                "status": "partial",
                "summary": "Response sem schema estruturado",
                "artifacts": {
                    "storyFile": None,
                    "storyTaskCount": 0,
                    "decisions": [],
                    "architecture": "",
                    "risks": [],
                },
                "issues": [],
                "metadata": {
                    "analysisDepth": "quick",
                    "debateRequired": False,
                    "debateTopics": [],
                    "freeText": raw_output[:4000],
                },
            },
            "forge": {
                "agent": "forge",
                "status": "partial",
                "summary": "Response sem schema estruturado",
                "artifacts": {
                    "completedTasks": [],
                    "modifiedFiles": [],
                    "testsRun": {"passed": 0, "failed": 0, "skipped": 0},
                    "storyFileUpdated": False,
                },
                "issues": [],
                "metadata": {
                    "linesAdded": 0,
                    "linesRemoved": 0,
                    "buildStatus": "skipped",
                    "freeText": raw_output[:4000],
                },
            },
            "aegis": {
                "agent": "aegis",
                "status": "partial",
                "summary": "Response sem schema estruturado",
                "artifacts": {
                    "verdict": "approved_with_issues",
                    "critical": [],
                    "important": [],
                    "minor": [],
                    "vigilDecisionsRespected": {"total": 0, "respected": 0, "violated": 0},
                    "tasksVerified": {"total": 0, "verified": 0, "mismatched": 0},
                },
                "issues": [],
                "metadata": {
                    "reviewDepth": "quick",
                    "storyFileChecked": False,
                    "freeText": raw_output[:4000],
                },
            },
        }
        return fallbacks.get(target, {"agent": target, "status": "error", "summary": "Unknown agent"})

    def process_output(self, output: str, target: str) -> dict[str, Any]:
        """
        Full pipeline: parse → validate → return result.
        Returns {data, parse_status, validation, used_fallback}.
        """
        parsed, parse_status = self.parse_response(output)

        if parsed is None:
            # Empty output → error per protocol step 0
            if parse_status == "empty":
                error_response = {
                    "agent": target,
                    "status": "error",
                    "summary": "Output vazio do agente",
                    "artifacts": {},
                    "issues": [],
                    "metadata": {"freeText": ""},
                }
                return {
                    "data": error_response,
                    "parse_status": "empty",
                    "validation": {"level": "invalid", "errors": ["Empty output"], "warnings": []},
                    "used_fallback": True,
                }
            # Other parse failures → fallback
            fallback = self.build_fallback_response(target, output or "")
            return {
                "data": fallback,
                "parse_status": parse_status,
                "validation": {"level": "partial", "errors": [], "warnings": [f"Fallback used: {parse_status}"]},
                "used_fallback": True,
            }

        validation = self.validate_response(parsed, target)
        return {
            "data": parsed,
            "parse_status": parse_status,
            "validation": validation,
            "used_fallback": False,
        }


# ─────────────────────────────────────────────────────────────
# File Validator (for Claude Code Hooks)
# ─────────────────────────────────────────────────────────────

AIOS_ROOT = Path.home() / ".claude" / "aios"

# Map file paths to their validation logic
# NOTE: state_graph.json aposentado (telemetria, nao runtime) -> ~/.claude/aios/_deprecated/.
# Removido do dispatch de validacao. StateGraphManager/_validate_graph_basic permanecem
# como dead code inofensivo (instanciacao tolera arquivo ausente via _load()).
WATCHED_FILES = {
    "activity-log.json": "activity-log",
    "status.json": "status",
    "gotchas.json": "gotchas",
    "memory_blocks.json": "memory",
}


def _normalize_path(filepath: str) -> Path:
    """
    Normalize path for cross-platform compatibility.
    Claude Code on Windows passes /c/Users/... (Git Bash / MSYS2 style).
    Windows Python cannot resolve that — convert to C:/Users/... form.
    """
    import re as _re
    if os.name == 'nt':
        # Match /c/... or /C/... at the start (single-letter drive)
        m = _re.match(r'^/([a-zA-Z])/(.*)', filepath)
        if m:
            drive, rest = m.group(1).upper(), m.group(2)
            filepath = f"{drive}:/{rest}"
    return Path(filepath)


def validate_file(filepath: str) -> dict[str, Any]:
    """
    Validate an AIOS JSON file.
    Returns {valid, file_type, errors, warnings}.
    """
    p = _normalize_path(filepath)
    filename = p.name

    # Check if this is a file we care about
    file_type = WATCHED_FILES.get(filename)
    if not file_type:
        # Check if it's a checkpoint file
        if "checkpoints" in str(p) and filename.endswith(".json"):
            file_type = "checkpoint"
        else:
            return {"valid": True, "file_type": None, "errors": [], "warnings": ["Not an AIOS file"]}

    errors: list[str] = []
    warnings: list[str] = []

    # Basic JSON validity
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return {"valid": False, "file_type": file_type, "errors": [f"Invalid JSON: {e}"], "warnings": []}
    except FileNotFoundError:
        return {"valid": False, "file_type": file_type, "errors": [f"File not found: {filepath}"], "warnings": []}

    if not isinstance(data, dict):
        errors.append("Root must be an object")
        return {"valid": False, "file_type": file_type, "errors": errors, "warnings": warnings}

    # Type-specific validation
    if file_type == "graph":
        _validate_graph_basic(data, errors, warnings)
    elif file_type == "activity-log":
        _validate_activity_log_basic(data, errors, warnings)
    elif file_type == "status":
        _validate_status_basic(data, errors, warnings)
    elif file_type == "memory":
        _validate_memory_basic(data, errors, warnings)
    elif file_type == "gotchas":
        _validate_gotchas_basic(data, errors, warnings)

    return {
        "valid": len(errors) == 0,
        "file_type": file_type,
        "errors": errors,
        "warnings": warnings,
    }


def _validate_graph_basic(data: dict, errors: list, warnings: list) -> None:
    if data.get("schema") != "aios-state-graph-v1":
        errors.append(f"Expected schema 'aios-state-graph-v1', got '{data.get('schema')}'")
    if "templates" not in data:
        errors.append("Missing 'templates' object")
    if "instances" not in data:
        errors.append("Missing 'instances' object")
    if isinstance(data.get("instances"), dict):
        for iid, inst in data["instances"].items():
            if not isinstance(inst, dict):
                errors.append(f"Instance '{iid}' must be object")
            elif "status" not in inst:
                warnings.append(f"Instance '{iid}' missing status")


def _validate_activity_log_basic(data: dict, errors: list, warnings: list) -> None:
    for section in ("activities", "discussions", "decisions", "tasks"):
        if section not in data:
            errors.append(f"Missing section: '{section}'")
        elif not isinstance(data[section], list):
            errors.append(f"'{section}' must be an array")


def _validate_status_basic(data: dict, errors: list, warnings: list) -> None:
    # status.json has TWO valid shapes (parallelism Fase A, backward compatible):
    #   - 'aios-status-v1'      : legacy single-run state (13 fields)  [default]
    #   - 'aios-runs-index-v1'  : multi-run index { activeRuns: [...] }
    # The per-run state files (runs/{runId}/status.json) keep 'aios-status-v1'.
    schema = data.get("schema")
    if schema == "aios-runs-index-v1":
        if not isinstance(data.get("activeRuns"), list):
            errors.append("Runs index missing 'activeRuns' array")
        return
    if schema != "aios-status-v1":
        errors.append(
            f"Expected schema 'aios-status-v1' or 'aios-runs-index-v1', got '{schema}'"
        )
    valid_phases = ("idle", "analysis", "strategy", "execution", "review", "checkpoint")
    phase = data.get("phase")
    if phase and phase not in valid_phases:
        errors.append(f"Invalid phase: '{phase}'")


def _validate_memory_basic(data: dict, errors: list, warnings: list) -> None:
    if data.get("schema") != "aios-memory-blocks-v1":
        errors.append(f"Expected schema 'aios-memory-blocks-v1', got '{data.get('schema')}'")
    if "agents" not in data:
        errors.append("Missing 'agents' object")
    elif isinstance(data["agents"], dict):
        for agent_id, blocks in data["agents"].items():
            if not isinstance(blocks, list):
                errors.append(f"Agent '{agent_id}' blocks must be array")
            else:
                for i, block in enumerate(blocks):
                    if not isinstance(block, dict):
                        errors.append(f"Agent '{agent_id}' block[{i}] must be object")
                    elif "label" not in block or "value" not in block:
                        warnings.append(f"Agent '{agent_id}' block[{i}] missing label or value")


def _validate_gotchas_basic(data: dict, errors: list, warnings: list) -> None:
    if "gotchas" not in data:
        errors.append("Missing 'gotchas' array")
    elif not isinstance(data["gotchas"], list):
        errors.append("'gotchas' must be an array")


# ─────────────────────────────────────────────────────────────
# State Graph Manager
# ─────────────────────────────────────────────────────────────

class StateGraphManager:
    """Read/write transitions to state_graph.json."""

    def __init__(self, graph_file: Path):
        self.graph_file = graph_file
        self.data = self._load()

    def _load(self) -> dict:
        if self.graph_file.exists():
            return json.loads(self.graph_file.read_text(encoding="utf-8"))
        return {"schema": "aios-state-graph-v1", "instances": {}, "templates": {}}

    def save(self) -> None:
        self.graph_file.write_text(
            json.dumps(self.data, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    def record_transition(
        self,
        instance_id: str,
        edge_id: str,
        from_node: str,
        to_node: str,
        handoff_request: Optional[dict],
        handoff_response: Optional[dict],
        status: str = "completed",
        error: Optional[str] = None,
    ) -> dict:
        """Record a completed transition in an instance."""
        inst = self.data["instances"].get(instance_id)
        if not inst:
            raise ValueError(f"Instance '{instance_id}' not found")

        transitions = inst.get("transitions", [])
        t_id = f"t{len(transitions) + 1}"
        now = datetime.now(timezone.utc).isoformat()

        transition = {
            "id": t_id,
            "edge": edge_id,
            "from": from_node,
            "to": to_node,
            "timestamp": now,
            "completedAt": now,
            "durationMs": 0,
            "handoffRequest": handoff_request,
            "handoffResponse": handoff_response,
            "status": status,
            "error": error,
        }

        transitions.append(transition)
        inst["transitions"] = transitions
        inst["currentNode"] = to_node
        self.save()
        return transition


# ─────────────────────────────────────────────────────────────
# Handoff Engine (Main Facade)
# ─────────────────────────────────────────────────────────────

class HandoffEngine:
    """
    Main engine that ties everything together.
    ULTRON calls this via Bash CLI commands.
    """

    def __init__(self, aios_root: Optional[Path] = None):
        if aios_root is None:
            aios_root = AIOS_ROOT
        self.aios_root = aios_root
        self.memory = MemoryManager(aios_root / "memory_blocks.json")
        self.prompt_builder = PromptBuilder(self.memory)
        self.validator = ResponseValidator()
        self.graph = StateGraphManager(aios_root / "state_graph.json")

    def build_prompt(self, request_data: dict) -> str:
        """Build complete handoff prompt from request dict."""
        request = HandoffRequest.model_validate(request_data)
        return self.prompt_builder.build(request)

    def validate_response(self, target: str, output: str) -> dict:
        """Validate agent response output."""
        return self.validator.process_output(output, target)

    def execute_transition(
        self,
        instance_id: str,
        edge_id: str,
        from_node: str,
        to_node: str,
        request_data: Optional[dict],
        response_output: Optional[str],
        target: Optional[str] = None,
    ) -> dict:
        """
        Full transition: validate request, validate response, record in graph.
        Returns {transition, validation}.
        """
        # Validate request if provided
        handoff_request = None
        if request_data:
            try:
                req = HandoffRequest.model_validate(request_data)
                handoff_request = req.model_dump(by_alias=True)
            except Exception as e:
                return {"error": f"Invalid request: {e}", "transition": None}

        # Validate response if provided
        handoff_response = None
        validation = None
        if response_output and target:
            result = self.validator.process_output(response_output, target)
            handoff_response = result["data"]
            validation = result["validation"]

        # Record transition
        transition = self.graph.record_transition(
            instance_id=instance_id,
            edge_id=edge_id,
            from_node=from_node,
            to_node=to_node,
            handoff_request=handoff_request,
            handoff_response=handoff_response,
        )

        return {"transition": transition, "validation": validation}


# ─────────────────────────────────────────────────────────────
# CLI Interface
# ─────────────────────────────────────────────────────────────

def cmd_build_prompt(args: argparse.Namespace) -> None:
    engine = HandoffEngine()
    if args.mission_json:
        request_data = json.loads(Path(args.mission_json).read_text(encoding="utf-8"))
    elif args.stdin:
        request_data = json.loads(sys.stdin.read())
    else:
        print("Error: provide --mission-json or --stdin", file=sys.stderr)
        sys.exit(1)

    try:
        prompt = engine.build_prompt(request_data)
        print(prompt)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


def cmd_validate_response(args: argparse.Namespace) -> None:
    engine = HandoffEngine()
    if args.output_file:
        output = Path(args.output_file).read_text(encoding="utf-8")
    elif args.stdin:
        output = sys.stdin.read()
    else:
        print("Error: provide --output-file or --stdin", file=sys.stderr)
        sys.exit(1)

    result = engine.validate_response(args.target, output)
    print(json.dumps(result, indent=2, ensure_ascii=False))

    if result["validation"]["level"] == "invalid":
        sys.exit(2)


def cmd_validate_file(args: argparse.Namespace) -> None:
    result = validate_file(args.filepath)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    if not result["valid"]:
        sys.exit(2)


def cmd_memory(args: argparse.Namespace) -> None:
    engine = HandoffEngine()

    if args.action == "get":
        blocks = engine.memory.get_blocks(args.agent_id)
        output = [b.model_dump() for b in blocks]
        print(json.dumps(output, indent=2, ensure_ascii=False))

    elif args.action == "set":
        try:
            engine.memory.update_block(args.agent_id, args.label, args.value)
            print(json.dumps({"ok": True, "agent": args.agent_id, "label": args.label}))
        except Exception as e:
            print(json.dumps({"error": str(e)}), file=sys.stderr)
            sys.exit(1)

    elif args.action == "list":
        data = engine.memory.data
        for agent_id, blocks in data.items():
            labels = [b["label"] for b in blocks]
            print(f"  {agent_id}: {', '.join(labels)}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="AIOS Handoff Engine",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # build-prompt
    bp = sub.add_parser("build-prompt", help="Build handoff prompt for an agent")
    bp.add_argument("--mission-json", help="Path to JSON file with HandoffRequest")
    bp.add_argument("--stdin", action="store_true", help="Read request from stdin")
    bp.set_defaults(func=cmd_build_prompt)

    # validate-response
    vr = sub.add_parser("validate-response", help="Validate agent response")
    vr.add_argument("--target", required=True, choices=VALID_AGENTS)
    vr.add_argument("--output-file", help="Path to file with agent output")
    vr.add_argument("--stdin", action="store_true", help="Read output from stdin")
    vr.set_defaults(func=cmd_validate_response)

    # validate-file
    vf = sub.add_parser("validate-file", help="Validate an AIOS JSON file")
    vf.add_argument("filepath", help="Path to JSON file to validate")
    vf.set_defaults(func=cmd_validate_file)

    # memory
    mem = sub.add_parser("memory", help="Manage agent memory blocks")
    mem.add_argument("action", choices=["get", "set", "list"])
    mem.add_argument("agent_id", nargs="?", help="Agent ID (vigil, forge, aegis, ultron)")
    mem.add_argument("label", nargs="?", help="Block label (for set)")
    mem.add_argument("value", nargs="?", help="New value (for set)")
    mem.set_defaults(func=cmd_memory)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
