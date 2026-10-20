# FixForward AI — Backend (Step 1)

FixForward AI is a demo appliance-repair coordinator. This first increment establishes a working REST API plus an MCP tool server using Streamable HTTP, with persistent SQLite state and a cancellation-recovery workflow.

## What is implemented

- REST API and MCP server on one ASGI app/process.
- MCP endpoint at `/mcp/`, using **Streamable HTTP** (not legacy SSE).
- REST API docs at `/docs` and health endpoint at `/health`.
- Seeded simulated appliances, warranty records, technicians, and future appointment slots.
- Appliance lookup and warranty lookup.
- Safety-conscious first-line troubleshooting guides.
- Persistent repair cases.
- Appointment booking that requires explicit confirmation (`user_confirmed=true`).
- A demo-only technician-cancellation tool and rescheduling flow.
- Unit tests for persistence, confirmation gating, and recovery after cancellation.

**All appliance, warranty, technician, and appointment records are simulated.** This server does not contact manufacturers or real service providers.

## Run on Windows PowerShell

Python 3.11+ is recommended.

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python server.py
```

Then open:

- REST health: `http://127.0.0.1:8000/health`
- Interactive REST docs: `http://127.0.0.1:8000/docs`
- MCP Streamable HTTP endpoint: `http://127.0.0.1:8000/mcp/`

The server seeds its SQLite database on first startup at `backend/data/fixforward.db`.

## Run tests

From the `backend` directory:

```powershell
$env:PYTHONPATH = "."
python -m unittest discover -s tests -v
```

## Quick demo sequence

1. `GET /api/appliances` — inspect seeded appliances.
2. `GET /api/appliances/APL-1001/troubleshooting?symptoms=loud%20vibration%20during%20spin` — get a safe first-line guide.
3. `POST /api/cases` with `{ "appliance_id": "APL-1001", "issue_description": "Washer shakes loudly during spin" }`.
4. `GET /api/slots` — get available demo slots.
5. `POST /api/cases/{case_id}/book` with `user_confirmed: false` — verify that no booking happens.
6. Re-submit with `user_confirmed: true` only after showing the exact slot to the user and obtaining approval.
7. `POST /api/cases/{case_id}/simulate-cancellation` — show a simulated provider cancellation.
8. `GET /api/slots`, then `POST /api/cases/{case_id}/reschedule` after confirming a replacement slot with the user.

## Alexa+ readiness note

This is the **functional MCP foundation**, not yet a complete native Alexa+ add-on integration. Amazon's current integration guidance additionally calls for a public HTTPS endpoint, OAuth 2.1 authorization-code flow with PKCE, Protected Resource Metadata, authorization-server metadata, and Alexa AI CLI/add-on configuration. Those should be implemented and tested as a later step if native Alexa+ onboarding is available. A browser-based Alexa+-style simulation can use the REST API and this MCP server for the hackathon demo.
