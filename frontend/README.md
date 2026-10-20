# FixForward AI — Frontend

A responsive repair-concierge dashboard for the FixForward AI hackathon project. The visual direction uses an editorial, warm-paper canvas, indigo workflow panels, coral details, and small appliance illustrations instead of a generic dark industrial dashboard.

## Run locally

Requirements: Node.js 20+.

```bash
npm install
copy .env.example .env
npm run dev
```

Open `http://localhost:5173`.

Start the backend in a separate terminal first for persistent API-backed workflows:

```powershell
cd ../backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python server.py
```

The frontend checks `GET /health`, `GET /api/appliances`, and `GET /api/slots`. Its default API origin is `http://127.0.0.1:8000`. Set `VITE_API_BASE_URL` in `.env` to change it. If the API is unavailable, the interface stays interactive in explicitly labelled local demo mode; local-only cases are saved in the browser and are not sent anywhere.

## What works in this frontend

- Registered appliance shelf and seeded warranty status.
- Create repair cases through the backend when connected.
- Safety-first troubleshooting lookup and warranty lookup from the guide panel.
- Availability lookup, selected-slot review, and explicit confirmation before booking.
- Demo-only technician cancellation and rescheduling recovery flow.
- Responsive dashboard, case list, appointment view, and home handbook.
- Clear labels for simulated appointment, appliance, technician, and warranty data.

## Current limitation

The guide panel uses deterministic workflow routing and API-backed service functions. LLM-based agent orchestration is not wired in yet. The native Alexa+ environment is also not connected by this frontend alone; it is intended as the browser-based simulated experience and control surface for the hackathon demo.
