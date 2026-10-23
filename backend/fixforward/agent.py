"""FixForward conversational agent: Bedrock Mantle tool-use + transparent local fallback.

The agent is intentionally restricted to one demo washing machine. Booking and
rescheduling are excluded from LLM tool execution: the frontend must collect an
explicit user confirmation before invoking those state-changing operations.
"""
from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from .db import DEMO_APPLIANCE_ID
from .service import (
    create_repair_case,
    get_appliance_details,
    get_available_appointment_slots,
    get_appointment_history,
    get_repair_case,
    get_warranty_status,
    search_troubleshooting_guide,
)

# Load backend/.env regardless of the directory used to start the backend.
BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")

logger = logging.getLogger(__name__)
MAX_HISTORY = 12
MAX_TOOL_TURNS = 4

SYSTEM_PROMPT = """You are FixForward AI, a repair concierge for exactly one demo appliance:
WhirlNest WashPro 8kg washing machine (appliance ID APL-1001).

Your job is to help the user understand safe first checks, check the saved demo warranty,
inspect repair-case status and appointment history, find available demo appointment slots, and create a repair case
when the user explicitly asks you to do so.

RULES:
- Appliance, warranty, technician, and appointment data are simulated. Say this clearly when relevant.
- Use tools for factual lookups instead of inventing dates, warranty facts, case IDs, or availability.
- Treat troubleshooting as possibilities and user-safe checks, never as a confirmed diagnosis.
- If there is smoke, a burning smell, damaged wiring, a significant leak near electricity, or harsh
  grinding, advise the user to stop the machine and contact a qualified technician. Never instruct
  the user to remove panels, reach into a moving drum, or work on wiring.
- Never book, cancel, or reschedule an appointment yourself. Those actions require a separate UI
  confirmation flow. You may find slots and tell the user the UI can show them.
- Do not claim a booking exists unless the saved case data says it is scheduled.
- Do not create a case unless the latest user message explicitly asks to open/create/log/register
  a repair case or ticket. If unclear, ask a clarifying question.
- Keep answers concise, specific, and helpful. Do not claim to have contacted a real provider.
"""

# Tool schemas are converted to the OpenAI Chat Completions format used by Bedrock Mantle.
# Only safe lookups are always exposed. Case creation is added dynamically only when explicitly requested.
BASE_TOOL_SPECS: list[dict[str, Any]] = [
    {
        "toolSpec": {
            "name": "get_washing_machine_details",
            "description": "Retrieve the saved details for the one supported demo washer, APL-1001.",
            "inputSchema": {"json": {"type": "object", "properties": {"appliance_id": {"type": "string", "description": "Use APL-1001."}}, "required": ["appliance_id"]}},
        }
    },
    {
        "toolSpec": {
            "name": "check_warranty",
            "description": "Check the saved demo warranty record for the WashPro 8kg. Coverage must be confirmed with the manufacturer.",
            "inputSchema": {"json": {"type": "object", "properties": {"appliance_id": {"type": "string", "description": "Use APL-1001."}}, "required": ["appliance_id"]}},
        }
    },
    {
        "toolSpec": {
            "name": "find_troubleshooting_steps",
            "description": "Retrieve safety-conscious first-line washing machine guidance for the user's symptoms. Does not diagnose the machine.",
            "inputSchema": {"json": {"type": "object", "properties": {"appliance_id": {"type": "string", "description": "Use APL-1001."}, "symptoms": {"type": "string", "minLength": 3, "maxLength": 800}}, "required": ["appliance_id", "symptoms"]}},
        }
    },
    {
        "toolSpec": {
            "name": "get_available_appointment_slots",
            "description": "Retrieve future available simulated technician slots. This does not book a slot.",
            "inputSchema": {"json": {"type": "object", "properties": {"date": {"type": "string", "description": "Optional YYYY-MM-DD date; use empty string if not specified."}, "limit": {"type": "integer", "minimum": 1, "maximum": 6}}, "required": []}},
        }
    },
    {
        "toolSpec": {
            "name": "get_repair_case_status",
            "description": "Retrieve a saved repair case including its status and any saved appointment.",
            "inputSchema": {"json": {"type": "object", "properties": {"case_id": {"type": "string"}}, "required": ["case_id"]}},
        }
    },
    {
        "toolSpec": {
            "name": "get_appointment_history",
            "description": "Read all saved appointment booking, cancellation, and rescheduling events for a repair case. Includes an explicit note when older history could not be reconstructed. Read-only; never changes appointments.",
            "inputSchema": {"json": {"type": "object", "properties": {"case_id": {"type": "string"}}, "required": ["case_id"]}},
        }
    },
]

CREATE_CASE_TOOL_SPEC = {
    "toolSpec": {
        "name": "open_repair_case",
        "description": "Create and persist a demo repair case. Only use when the latest user message explicitly asks to open/create/log/register a repair case or ticket. Does not book an appointment.",
        "inputSchema": {"json": {"type": "object", "properties": {"appliance_id": {"type": "string", "description": "Use APL-1001."}, "issue_description": {"type": "string", "minLength": 8, "maxLength": 1200}}, "required": ["appliance_id", "issue_description"]}},
    }
}

EXPLICIT_CREATE_CASE = re.compile(
    r"\b(open|create|log|register|raise|start|submit)\b.{0,60}\b(repair\s+case|case|ticket|repair request)\b|"
    r"\b(repair\s+case|case|ticket|repair request)\b.{0,40}\b(open|create|log|register|raise|start|submit)\b",
    re.IGNORECASE,
)


def get_agent_status() -> dict[str, Any]:
    """Report whether GPT-OSS is configured through the Bedrock Mantle endpoint.

    GPT-OSS tool calling is supported through Bedrock Mantle's OpenAI-compatible API.
    The Runtime model ID has a different form, so accept it as a migration convenience
    and normalize it to the Mantle model ID.
    """
    raw_model_id = os.getenv("BEDROCK_MODEL_ID", "").strip()
    model_id = raw_model_id
    if raw_model_id == "openai.gpt-oss-20b-1:0":
        model_id = "openai.gpt-oss-20b"

    region = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "us-east-1")).strip()
    api_key_present = bool(
        os.getenv("AWS_BEARER_TOKEN_BEDROCK", "").strip()
        or os.getenv("OPENAI_API_KEY", "").strip()
    )
    provider_setting = os.getenv("AI_PROVIDER", "").strip().lower()
    provider_allows_bedrock = provider_setting in {"", "bedrock", "amazon-bedrock", "amazon-bedrock-mantle"}
    configured = bool(model_id and api_key_present and provider_allows_bedrock)

    if configured:
        note = "Bedrock Mantle configured. Ensure the API key, model access, and region are valid."
    elif provider_setting == "local":
        note = "Local workflow router explicitly selected. Set AI_PROVIDER=bedrock, BEDROCK_MODEL_ID=openai.gpt-oss-20b, and a Bedrock API key to enable GPT-OSS."
    elif not model_id:
        note = "Local workflow router active. Set AI_PROVIDER=bedrock, BEDROCK_MODEL_ID=openai.gpt-oss-20b, and a Bedrock API key to enable GPT-OSS."
    elif not api_key_present:
        note = "BEDROCK_MODEL_ID is set, but AWS_BEARER_TOKEN_BEDROCK (or OPENAI_API_KEY) is missing; using the local workflow router."
    else:
        note = "AI_PROVIDER must be set to bedrock to enable the configured Bedrock model; using the local workflow router."

    return {
        "provider": "amazon-bedrock-mantle" if configured else "local-rules",
        "mode": "bedrock_tool_use" if configured else "local_rules",
        "bedrock_configured": configured,
        "model_id": model_id or None,
        "region": region,
        "note": note,
    }


def _normalise_history(history: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Convert frontend history into OpenAI-compatible Chat Completions messages."""
    clean: list[dict[str, Any]] = []
    for item in (history or [])[-MAX_HISTORY:]:
        role = item.get("role")
        content = str(item.get("text", item.get("content", ""))).strip()
        if role in {"user", "assistant"} and content:
            clean.append({"role": role, "content": content[:2000]})
    return clean


def _is_read_only_case_lookup(message: str) -> bool:
    """Identify case-record questions that must not trigger appointment UI actions."""
    lower = re.sub(r"\s+", " ", str(message or "").casefold()).strip()
    has_case_reference = bool(re.search(r"\b(?:repair\s+)?case\b", lower) or re.search(r"\bcase id\b", lower))
    asks_for_saved_fields = bool(re.search(
        r"\b(current status|case status|status of (?:the )?(?:repair )?case|saved appointment|appointment date|"
        r"technician name|current slot id|slot id|from the database|repair database|saved repair case|"
        r"appointment history|cancellation history|booking history|appointment records|event log|original appointment|"
        r"previous cancelled appointment|previous canceled appointment)\b",
        lower,
    ))
    asks_for_lookup = bool(re.search(r"\b(retrieve|look up|lookup|check|show|fetch|get|tell me|confirm|inspect)\b", lower))
    explicitly_read_only = bool(re.search(
        r"\b(?:do not|don't|dont|without)\b.{0,60}\b(?:change|modify|update|book|schedule|create|cancel|reschedule)\b",
        lower,
    ))
    # A request to display available slots is an availability request, even if the
    # user says not to book yet. Do not suppress that intended UI flow.
    explicit_availability_request = bool(
        re.search(r"\b(?:available|availability|open)\b.{0,50}\b(?:appointment|slots?|visits?|technicians?)\b", lower)
        or re.search(r"\b(?:appointment|technician|visit)\s+(?:availability|slots?)\b", lower)
    )
    return bool(
        has_case_reference
        and not explicit_availability_request
        and ((asks_for_lookup and asks_for_saved_fields) or explicitly_read_only)
    )


def _make_action(message: str, case_id: str | None, created_case_id: str | None = None) -> dict[str, Any] | None:
    lower = message.casefold()
    if created_case_id:
        return {"type": "case_created", "case_id": created_case_id}
    # Status/record lookup prompts often mention appointments and technicians as
    # fields to READ. They must not open the appointment chooser.
    if _is_read_only_case_lookup(message):
        return None
    if ("cancel" in lower and ("simulate" in lower or "demo" in lower or "recovery demo" in lower)):
        return {"type": "simulate_cancellation", "case_id": case_id} if case_id else {"type": "open_repair_form"}
    if any(word in lower for word in ("appointment", "book", "technician", "schedule", "reschedul", "available slot")):
        return {"type": "open_appointments", "case_id": case_id} if case_id else {"type": "open_repair_form"}
    if EXPLICIT_CREATE_CASE.search(message):
        return {"type": "open_repair_form"}
    return None


def _event(name: str, result: Any) -> dict[str, str]:
    ok = not (isinstance(result, dict) and result.get("ok") is False)
    summaries = {
        "get_washing_machine_details": "Loaded WashPro 8kg details",
        "check_warranty": "Checked saved demo warranty",
        "find_troubleshooting_steps": "Retrieved safety-first troubleshooting guidance",
        "get_available_appointment_slots": "Checked simulated technician availability",
        "get_repair_case_status": "Retrieved saved repair-case status",
        "get_appointment_history": "Retrieved read-only appointment history",
        "open_repair_case": "Created a persistent demo repair case",
    }
    return {"name": name, "status": "success" if ok else "error", "summary": summaries.get(name, "Tool executed") if ok else str(result.get("error", "Tool failed"))[:180]}


def _execute_tool(name: str, arguments: dict[str, Any], *, allow_create_case: bool) -> dict[str, Any]:
    appliance_id = DEMO_APPLIANCE_ID  # Enforce the single-appliance scope server-side.
    if name == "get_washing_machine_details":
        return get_appliance_details(appliance_id)
    if name == "check_warranty":
        return get_warranty_status(appliance_id)
    if name == "find_troubleshooting_steps":
        symptoms = str(arguments.get("symptoms", "unusual noise during spin"))[:800]
        if len(symptoms.strip()) < 3:
            symptoms = "unusual noise during spin"
        return search_troubleshooting_guide(appliance_id, symptoms)
    if name == "get_available_appointment_slots":
        date = str(arguments.get("date", "") or "")[:10]
        limit = max(1, min(int(arguments.get("limit", 4) or 4), 6))
        return get_available_appointment_slots(date=date, limit=limit)
    if name == "get_repair_case_status":
        return get_repair_case(str(arguments.get("case_id", ""))[:40])
    if name == "get_appointment_history":
        return get_appointment_history(str(arguments.get("case_id", ""))[:40])
    if name == "open_repair_case":
        if not allow_create_case:
            return {"ok": False, "error": "Case creation is disabled unless the current user message explicitly requests it."}
        description = str(arguments.get("issue_description", "")).strip()[:1200]
        result = create_repair_case(appliance_id, description)
        if result.get("ok"):
            details = get_repair_case(result["case_id"])
            if details.get("ok"):
                result["case"] = details["case"]
        return result
    return {"ok": False, "error": f"Tool {name!r} is not available."}


def _openai_tool_specs(allow_create_case: bool) -> list[dict[str, Any]]:
    """Convert this module's provider-neutral tool schemas to OpenAI function format."""
    specs = list(BASE_TOOL_SPECS)
    if allow_create_case:
        specs.append(CREATE_CASE_TOOL_SPEC)

    converted: list[dict[str, Any]] = []
    for item in specs:
        spec = item["toolSpec"]
        converted.append({
            "type": "function",
            "function": {
                "name": spec["name"],
                "description": spec["description"],
                "parameters": spec["inputSchema"]["json"],
            },
        })
    return converted


def _bedrock_chat(message: str, history: list[dict[str, Any]] | None, case_id: str | None) -> dict[str, Any]:
    """Use GPT-OSS via Bedrock Mantle's OpenAI-compatible Chat Completions API.

    This is intentional: AWS documents GPT-OSS client-side tool calling on the
    Bedrock Mantle endpoint. The Runtime Converse endpoint accepts the model, but
    the GPT-OSS model card does not list Runtime client-side tool calling as a
    supported feature.
    """
    from openai import OpenAI

    status = get_agent_status()
    if not status["bedrock_configured"]:
        raise RuntimeError("Bedrock Mantle requires a model ID and Bedrock API key.")

    api_key = (
        os.getenv("AWS_BEARER_TOKEN_BEDROCK", "").strip()
        or os.getenv("OPENAI_API_KEY", "").strip()
    )
    base_url = os.getenv(
        "BEDROCK_MANTLE_BASE_URL",
        f"https://bedrock-mantle.{status['region']}.api.aws/v1",
    ).rstrip("/")
    client = OpenAI(api_key=api_key, base_url=base_url)

    messages: list[dict[str, Any]] = [{
        "role": "system",
        "content": SYSTEM_PROMPT + f"\nSelected appliance: APL-1001. Current selected case ID: {case_id or 'none'}.",
    }]
    messages.extend(_normalise_history(history))
    messages.append({"role": "user", "content": message})

    allow_create_case = bool(EXPLICIT_CREATE_CASE.search(message))
    tools = _openai_tool_specs(allow_create_case)
    tool_events: list[dict[str, str]] = []
    created_case: dict[str, Any] | None = None
    final_text = ""

    for _ in range(MAX_TOOL_TURNS + 1):
        response = client.chat.completions.create(
            model=status["model_id"],
            messages=messages,
            tools=tools,
            tool_choice="auto",
            max_completion_tokens=700,
            temperature=0.2,
        )
        assistant_message = response.choices[0].message
        requested_tools = assistant_message.tool_calls or []

        if not requested_tools:
            final_text = (assistant_message.content or "").strip()
            break

        assistant_payload: dict[str, Any] = {"role": "assistant"}
        if assistant_message.content is not None:
            assistant_payload["content"] = assistant_message.content
        assistant_payload["tool_calls"] = [
            tool_call.model_dump(exclude_none=True)
            if hasattr(tool_call, "model_dump")
            else tool_call.dict(exclude_none=True)
            for tool_call in requested_tools
        ]
        messages.append(assistant_payload)

        for tool_call in requested_tools:
            name = tool_call.function.name
            try:
                arguments = json.loads(tool_call.function.arguments or "{}")
                if not isinstance(arguments, dict):
                    raise ValueError("Tool arguments must be a JSON object.")
                result = _execute_tool(name, arguments, allow_create_case=allow_create_case)
            except (json.JSONDecodeError, ValueError) as exc:
                result = {"ok": False, "error": f"Invalid tool arguments: {str(exc)[:160]}"}

            tool_events.append(_event(name, result))
            if name == "open_repair_case" and result.get("ok") and result.get("case"):
                created_case = result["case"]

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(result, ensure_ascii=False, default=str),
            })

    if not final_text:
        final_text = (
            "I checked the available repair information. I can help with safe troubleshooting, "
            "the saved demo warranty, repair-case status, or appointment availability."
        )

    created_case_id = created_case.get("case_id") if created_case else None
    return {
        "reply": final_text,
        "stamp": "GPT-OSS · AMAZON BEDROCK MANTLE",
        "mode": "bedrock_tool_use",
        "tool_events": tool_events,
        "action": _make_action(message, case_id, created_case_id),
        "created_case": created_case,
        "provider_notice": None,
    }


def _local_chat(message: str, case_id: str | None) -> dict[str, Any]:
    """Reliable deterministic fallback; transparently labelled and uses real service logic."""
    lower = message.casefold()
    events: list[dict[str, str]] = []
    created_case: dict[str, Any] | None = None
    action = _make_action(message, case_id)

    urgent_terms = (
        "burning", "smoke", "sparking", "electric shock", "burnt smell",
        "burning smell", "damaged wiring", "damaged wire", "grinding",
        "water near electricity", "water near socket", "water near outlet",
        "leak near electrics", "leaking near power", "near electrical connection",
    )
    if any(word in lower for word in urgent_terms):
        result = search_troubleshooting_guide(DEMO_APPLIANCE_ID, message)
        events.append(_event("find_troubleshooting_steps", result))
        if result.get("ok"):
            steps = "\n".join(f"{index + 1}. {step}" for index, step in enumerate(result["steps"][:4]))
            reply = (
                f"{result.get('guide_title', 'Stop-use safety guidance')}.\n{steps}\n\n"
                f"Safety: {result.get('safety_note', 'Do not open the washer or work on wiring.')} "
                "This is precautionary guidance, not a confirmed diagnosis; service records in this demo are simulated."
            )
        else:
            reply = "For safety, stop using the washing machine and do not run another cycle. Keep clear of wet or damaged electrical equipment and contact a qualified technician."
    elif "warranty" in lower or "coverage" in lower:
        result = get_warranty_status(DEMO_APPLIANCE_ID)
        events.append(_event("check_warranty", result))
        if result.get("ok"):
            reply = f"The saved demo record for {result['appliance']} shows the warranty as {result['warranty_status']} through {result['warranty_expiry']}. This is simulated information; confirm actual coverage, exclusions, and dates with the manufacturer."
        else:
            reply = result.get("error", "I couldn't retrieve the warranty record.")
    elif any(word in lower for word in (
        "vibrat", "shake", "noise", "noisy", "rattl", "banging", "spin", "drain",
        "won't drain", "wont drain", "water remains", "water left", "standing water",
        "pump", "leak", "puddle", "door", "locked", "won't open", "will not open",
        "won't unlock", "won't start", "wont start", "will not start", "doesn't start",
        "doesnt start", "not starting", "no display", "no power", "not powering",
        "troubleshoot", "what should i do", "grinding",
    )):
        result = search_troubleshooting_guide(DEMO_APPLIANCE_ID, message)
        events.append(_event("find_troubleshooting_steps", result))
        if result.get("ok"):
            steps = "\n".join(f"{index + 1}. {step}" for index, step in enumerate(result["steps"][:4]))
            reply = f"Here are safe first checks for your WashPro 8kg. These steps don't confirm the underlying fault:\n{steps}\n\nSafety: {result['safety_note']}"
        else:
            reply = result.get("error", "I couldn't load the troubleshooting guide.")
    elif action and action["type"] == "simulate_cancellation":
        reply = "I can run the cancellation-recovery demo for the selected repair case. I'll keep the same case open, mark the original slot as cancelled in the simulated system, and show replacement times. No real technician is being contacted."
    elif re.search(r"\b(?:appointment|booking|cancellation|rescheduling)\s+(?:history|records?|log)\b|\b(?:event log|history of appointments)\b", lower):
        requested_case_id = re.search(r"\bFF-[A-Z0-9-]+\b", message, re.IGNORECASE)
        history_case_id = requested_case_id.group(0) if requested_case_id else case_id
        result = get_appointment_history(history_case_id or "")
        events.append(_event("get_appointment_history", result))
        if not result.get("ok"):
            reply = result.get("error", "I couldn't retrieve the appointment history.")
        else:
            case_record = result["case"]
            history_rows = result.get("history", [])
            lines = []
            for item in history_rows:
                when = item.get("event_at", "timestamp unavailable")
                start = item.get("starts_at", "time unavailable")
                end = item.get("ends_at", "time unavailable")
                technician = item.get("technician_name", "technician unknown")
                slot_id = item.get("slot_id", "slot unknown")
                event_type = item.get("event_type", "unknown")
                previous = f"; previous slot {item['previous_slot_id']}" if item.get("previous_slot_id") else ""
                lines.append(f"- {event_type}: {slot_id} · {start}–{end} · {technician} · recorded {when}{previous}")
            reply = f"Read-only appointment history for {case_record['case_id']} (case status: {case_record['case_status']})."
            reply += "\n" + ("\n".join(lines) if lines else "No appointment-history events have been recorded yet.")
            if result.get("history_note"):
                reply += "\n\nHistory note: " + result["history_note"]
            reply += "\n\nThis lookup did not change any records. Appointment and technician data are simulated."
    elif case_id and (
        _is_read_only_case_lookup(message)
        or any(word in lower for word in ("case status", "repair status", "my case", "status update", "progress"))
    ):
        # Handle record/status lookups before the broader appointment keyword branch.
        # This avoids treating saved appointment fields as a request to open the slot picker.
        result = get_repair_case(case_id)
        events.append(_event("get_repair_case_status", result))
        if result.get("ok"):
            case = result["case"]
            reply = f"Repair case {case['case_id']} is currently {case['status'].replace('_', ' ')}. Issue: {case['issue_description']}. "
            if case.get("starts_at"):
                reply += f"Saved appointment: {case['starts_at']} with {case.get('technician_name')}. "
            else:
                reply += "No appointment is saved. "
            reply += f"Current slot ID: {case.get('current_slot_id') or case.get('slot_id') or 'None'}. Case status is from the local demo database."
        else:
            reply = result.get("error", "I couldn't find that repair case.")
    elif any(word in lower for word in ("appointment", "book", "technician", "schedule", "reschedul", "available slot")):
        result = get_available_appointment_slots(limit=4)
        events.append(_event("get_available_appointment_slots", result))
        slots = result.get("slots", [])
        if slots:
            lines = [f"• {slot['starts_at'][:16].replace('T', ' ')} — {slot['technician_name']} ({slot['slot_id']})" for slot in slots[:3]]
            reply = "I found these simulated technician slots:\n" + "\n".join(lines) + "\n\nI'll open the appointment chooser so you can review a slot and explicitly confirm before anything is booked."
        else:
            reply = "There are no available future demo slots right now. Please try again later or reset the demo database."
        if not case_id:
            action = {"type": "open_repair_form"}
            reply += " First, open a repair case so the appointment is tied to the washer issue."
        else:
            action = {"type": "open_appointments", "case_id": case_id}
    elif action and action["type"] == "open_repair_form":
        reply = "I'll open the repair-case form for your WashPro 8kg. Add the symptoms, review the details, and submit to save a repair case. No appointment will be booked at this stage."
    else:
        reply = ("I can help with your WhirlNest WashPro 8kg by checking its saved demo warranty, retrieving safety-first troubleshooting steps, "
                 "checking a repair case, or finding simulated technician availability. Try: ‘What should I do about vibration?’, ‘Check my warranty’, "
                 "or ‘Find an appointment’. Tell me explicitly if you'd like to open a repair case.")

    return {
        "reply": reply,
        "stamp": "LOCAL WORKFLOW ROUTER",
        "mode": "local_rules",
        "tool_events": events,
        "action": action,
        "created_case": created_case,
        "provider_notice": None,
    }


def chat_with_agent(
    message: str,
    history: list[dict[str, Any]] | None = None,
    appliance_id: str = DEMO_APPLIANCE_ID,
    case_id: str | None = None,
) -> dict[str, Any]:
    """Respond via Bedrock tool-use when configured, otherwise use local service-backed routing."""
    del appliance_id  # The MVP deliberately permits only the seeded washer.
    message = str(message or "").strip()[:2000]
    if not message:
        return {"reply": "Tell me what's happening with your WashPro 8kg washing machine.", "stamp": "FIXFORWARD GUIDE", "mode": "local_rules", "tool_events": [], "action": None, "created_case": None, "provider_notice": None}

    if get_agent_status()["bedrock_configured"]:
        try:
            return _bedrock_chat(message, history, case_id)
        except Exception as exc:  # Cloud credentials/model access vary by developer account.
            logger.warning("Amazon Bedrock call failed; falling back to local workflow router: %s", type(exc).__name__)
            result = _local_chat(message, case_id)
            result["stamp"] = "LOCAL FALLBACK · BEDROCK UNAVAILABLE"
            result["mode"] = "local_fallback"
            result["provider_notice"] = "Amazon Bedrock could not be reached or configured. The local workflow router answered instead. Check the Bedrock API key, region, model access, and server logs."
            return result
    return _local_chat(message, case_id)
