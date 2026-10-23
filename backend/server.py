"""FixForward AI: browser-demo REST API plus a Streamable HTTP MCP server."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from mcp.server import MCPServer

from fixforward.db import init_db
from fixforward.agent import chat_with_agent, get_agent_status
from fixforward.service import (
    book_repair_appointment,
    create_repair_case,
    get_appliance_details,
    get_available_appointment_slots,
    get_appointment_history,
    get_repair_case,
    get_repair_case_activity,
    update_repair_case_status,
    get_warranty_status,
    list_appliances,
    reschedule_repair_appointment,
    search_troubleshooting_guide,
    simulate_technician_cancellation,
)

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

mcp = MCPServer(
    "FixForward AI",
    title="FixForward AI Repair Coordinator",
    description="A stateful demo workflow for safe appliance troubleshooting and repair coordination.",
    instructions=(
        "You are the tool server for FixForward AI, a demo washing-machine repair coordinator. "
        "Use tools to inspect saved WashPro 8kg data, retrieve safe first-line troubleshooting steps, "
        "create persistent repair cases, and find appointment slots. Never claim that an appointment "
        "is booked unless the booking tool returns status=scheduled. Before booking or rescheduling, "
        "show the user the exact slot and technician and obtain explicit approval. A booking tool call "
        "must pass user_confirmed=true only after that approval. Clearly disclose that all appliance, "
        "warranty, technician, and appointment data are simulated demo data. Do not present troubleshooting "
        "as a confirmed diagnosis or recommend opening electrical panels or sealed components."
    ),
    version="0.1.0",
)


# ---- MCP tools: these are the actual tools a compatible agent can discover and call. ----
@mcp.tool()
def list_registered_appliances() -> list[dict[str, Any]]:
    """List the single supported demo appliance (WhirlNest WashPro 8kg), including its warranty status."""
    return list_appliances()


@mcp.tool()
def get_appliance(appliance_id: str) -> dict[str, Any]:
    """Get saved model, location, and warranty status for the supported WashPro 8kg appliance ID APL-1001."""
    return get_appliance_details(appliance_id)


@mcp.tool()
def check_appliance_warranty(appliance_id: str) -> dict[str, Any]:
    """Check the demo warranty record for an appliance. The manufacturer must confirm real coverage."""
    return get_warranty_status(appliance_id)


@mcp.tool()
def find_troubleshooting_steps(appliance_id: str, symptoms: str) -> dict[str, Any]:
    """Retrieve basic safety-conscious troubleshooting steps for the selected appliance and described symptoms."""
    return search_troubleshooting_guide(appliance_id, symptoms)


@mcp.tool()
def get_available_slots(date: str = "", limit: int = 6) -> dict[str, Any]:
    """List simulated future technician appointment slots. Optional date format: YYYY-MM-DD."""
    return get_available_appointment_slots(date=date, limit=limit)


@mcp.tool()
def open_repair_case(appliance_id: str, issue_description: str) -> dict[str, Any]:
    """Create and persist a repair case. This does not book an appointment or contact a real service provider."""
    return create_repair_case(appliance_id, issue_description)


@mcp.tool()
def get_case_status(case_id: str) -> dict[str, Any]:
    """Retrieve the saved repair case, current status, appointment details, and cancellation reason if any."""
    return get_repair_case(case_id)


@mcp.tool()
def get_appointment_history_for_case(case_id: str) -> dict[str, Any]:
    """Read the saved appointment and cancellation event history for a repair case; does not modify records."""
    return get_appointment_history(case_id)


@mcp.tool()
def book_appointment(case_id: str, slot_id: str, user_confirmed: bool = False) -> dict[str, Any]:
    """Book a demo appointment only after explicit user approval; pass user_confirmed=true only after approval."""
    return book_repair_appointment(case_id, slot_id, user_confirmed=user_confirmed)


@mcp.tool()
def simulate_technician_cancellation_for_demo(case_id: str) -> dict[str, Any]:
    """DEMO-ONLY: simulate a technician cancelling an existing appointment so the recovery workflow can be shown."""
    return simulate_technician_cancellation(case_id)


@mcp.tool()
def reschedule_appointment(case_id: str, slot_id: str, user_confirmed: bool = False) -> dict[str, Any]:
    """Reschedule a case marked needs_rescheduling. Explicit user approval is required before confirming the new slot."""
    return reschedule_repair_appointment(case_id, slot_id, user_confirmed=user_confirmed)


# ---- REST API: powers the web demo without bypassing the same business logic. ----
class CreateCaseRequest(BaseModel):
    appliance_id: str = Field(min_length=1, max_length=40)
    issue_description: str = Field(min_length=8, max_length=1200)


class BookingRequest(BaseModel):
    slot_id: str = Field(min_length=1, max_length=40)
    user_confirmed: bool = False


class CaseStatusRequest(BaseModel):
    status: str = Field(pattern="^(resolved|closed)$")
    notes: str = Field(default="", max_length=500)


class ChatHistoryMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    text: str = Field(min_length=1, max_length=2000)


class AssistantChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[ChatHistoryMessage] = Field(default_factory=list, max_length=12)
    appliance_id: str = Field(default="APL-1001", max_length=40)
    case_id: str | None = Field(default=None, max_length=40)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # The parent ASGI app owns the MCP session manager when the MCP app is mounted.
    async with mcp.session_manager.run():
        yield


app = FastAPI(
    title="FixForward AI API",
    version="0.1.0",
    description="REST endpoints for the web demo and an MCP Streamable HTTP endpoint at /mcp/.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://fixforward-ai.vercel.app",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "project": "FixForward AI",
        "mcp_endpoint": "/mcp/",
        "demo_data": True,
        "notice": "Appliance, warranty, technician, and appointment information is simulated.",
        "agent": get_agent_status(),
    }


@app.post("/api/assistant/chat")
def api_assistant_chat(request: AssistantChatRequest) -> dict[str, Any]:
    """Conversational repair assistant. Uses Bedrock tool calling when configured, local fallback otherwise."""
    result = chat_with_agent(
        message=request.message,
        history=[item.model_dump() for item in request.history],
        appliance_id=request.appliance_id,
        case_id=request.case_id,
    )
    return result


@app.get("/api/appliances")
def api_list_appliances() -> list[dict[str, Any]]:
    return list_appliances()


@app.get("/api/appliances/{appliance_id}")
def api_get_appliance(appliance_id: str) -> dict[str, Any]:
    result = get_appliance_details(appliance_id)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result["error"])
    return result["appliance"]


@app.get("/api/appliances/{appliance_id}/warranty")
def api_get_warranty(appliance_id: str) -> dict[str, Any]:
    result = get_warranty_status(appliance_id)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@app.get("/api/appliances/{appliance_id}/troubleshooting")
def api_troubleshooting(
    appliance_id: str,
    symptoms: str = Query(min_length=3, max_length=800),
) -> dict[str, Any]:
    result = search_troubleshooting_guide(appliance_id, symptoms)
    if not result.get("ok"):
        raise HTTPException(status_code=404 if "No appliance" in result.get("error", "") else 422, detail=result["error"])
    return result


@app.get("/api/slots")
def api_get_slots(
    date: str = Query(default="", description="Optional date in YYYY-MM-DD format"),
    limit: int = Query(default=6, ge=1, le=20),
) -> dict[str, Any]:
    result = get_available_appointment_slots(date=date, limit=limit)
    if not result.get("ok"):
        raise HTTPException(status_code=422, detail=result["error"])
    return result


@app.post("/api/cases", status_code=201)
def api_create_case(request: CreateCaseRequest) -> dict[str, Any]:
    result = create_repair_case(request.appliance_id, request.issue_description)
    if not result.get("ok"):
        raise HTTPException(status_code=422, detail=result["error"])
    return result


@app.get("/api/cases/{case_id}")
def api_get_case(case_id: str) -> dict[str, Any]:
    result = get_repair_case(case_id)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@app.get("/api/cases/{case_id}/activity")
def api_get_case_activity(case_id: str) -> dict[str, Any]:
    """Read persisted lifecycle activity for a repair case."""
    result = get_repair_case_activity(case_id)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@app.post("/api/cases/{case_id}/status")
def api_update_case_status(case_id: str, request: CaseStatusRequest) -> dict[str, Any]:
    """Resolve an active repair case or close a resolved case."""
    result = update_repair_case_status(case_id, request.status, request.notes)
    if not result.get("ok"):
        status_code = 404 if "was not found" in result.get("error", "") else 409
        raise HTTPException(status_code=status_code, detail=result["error"])
    return result


@app.get("/api/cases/{case_id}/history")
def api_get_case_appointment_history(case_id: str) -> dict[str, Any]:
    """Read-only saved appointment history for a repair case."""
    result = get_appointment_history(case_id)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@app.post("/api/cases/{case_id}/book")
def api_book_case(case_id: str, request: BookingRequest) -> dict[str, Any]:
    result = book_repair_appointment(case_id, request.slot_id, user_confirmed=request.user_confirmed)
    if not result.get("ok") and result.get("status") != "confirmation_required":
        raise HTTPException(status_code=409 if result.get("status") == "slot_unavailable" else 422, detail=result.get("error", result.get("message")))
    return result


@app.post("/api/cases/{case_id}/simulate-cancellation")
def api_simulate_cancellation(case_id: str) -> dict[str, Any]:
    result = simulate_technician_cancellation(case_id)
    if not result.get("ok"):
        raise HTTPException(status_code=409, detail=result["error"])
    return result


@app.post("/api/cases/{case_id}/reschedule")
def api_reschedule_case(case_id: str, request: BookingRequest) -> dict[str, Any]:
    result = reschedule_repair_appointment(case_id, request.slot_id, user_confirmed=request.user_confirmed)
    if not result.get("ok") and result.get("status") != "confirmation_required":
        raise HTTPException(status_code=409 if result.get("status") == "slot_unavailable" else 422, detail=result.get("error", result.get("message")))
    return result


# Mount the official MCP SDK's ASGI app so REST and MCP run on one host/process.
# streamable_http_path="/" makes the public MCP URL `/mcp/`.
app.mount("/mcp", mcp.streamable_http_app(streamable_http_path="/"))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("RELOAD", "false").lower() == "true",
    )
