"""Business logic for the FixForward AI appliance-repair workflow."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from .db import connect, row_to_dict


GUIDES: dict[str, dict[str, Any]] = {
    "washing_machine": {
        "title": "WashPro 8kg vibration and unusual-noise checklist",
        "matches": ["noise", "noisy", "vibration", "shake", "shaking", "rattle", "spin", "drum", "not draining", "water left", "door", "won't start", "not starting"],
        "steps": [
            "If the machine is shaking heavily, smells burnt, leaks near a power connection, or makes a harsh grinding sound, stop the cycle and do not keep testing it.",
            "For vibration during spinning, pause the cycle and check whether the laundry load is bunched to one side. Redistribute the load only after the drum has stopped.",
            "Check from the outside that the machine is standing level and is not touching a wall or cabinet. Do not pull a heavy machine out alone.",
            "When the machine is stopped, check only user-accessible areas for obvious loose items or a kinked visible hose; follow the manufacturer's manual.",
            "If the symptom persists, or there is burning, smoke, leaking near electrics, or a harsh grinding sound, stop using the machine and arrange a qualified technician inspection.",
        ],
        "safety_note": "Do not remove panels, reach into a moving drum, or work on wiring. Disconnect power before any permitted external inspection. For smoke, burning smells, damaged wiring, or significant leaks, stop using the appliance and seek qualified assistance.",
    },
}


def _now() -> str:
    return datetime.now().astimezone().replace(microsecond=0).isoformat()


def _warranty_status(expiry: str) -> str:
    today = datetime.now().date().isoformat()
    return "active" if expiry >= today else "expired"


def list_appliances() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM appliances WHERE appliance_id = 'APL-1001' AND appliance_type = 'washing_machine' ORDER BY appliance_id").fetchall()
    result = []
    for row in rows:
        item = dict(row)
        item["warranty_status"] = _warranty_status(item["warranty_expiry"])
        result.append(item)
    return result


def get_appliance_details(appliance_id: str) -> dict[str, Any]:
    with connect() as conn:
        row = conn.execute("SELECT * FROM appliances WHERE appliance_id = ? AND appliance_id = 'APL-1001' AND appliance_type = 'washing_machine'", (appliance_id,)).fetchone()
    appliance = row_to_dict(row)
    if not appliance:
        return {"ok": False, "error": f"No appliance found with ID {appliance_id!r}.", "available_ids": ["APL-1001"], "supported_appliance": "WhirlNest WashPro 8kg washing machine"}
    appliance["warranty_status"] = _warranty_status(appliance["warranty_expiry"])
    return {"ok": True, "appliance": appliance}


def get_warranty_status(appliance_id: str) -> dict[str, Any]:
    details = get_appliance_details(appliance_id)
    if not details["ok"]:
        return details
    appliance = details["appliance"]
    return {
        "ok": True,
        "appliance_id": appliance_id,
        "appliance": f"{appliance['brand']} {appliance['model']}",
        "purchase_date": appliance["purchase_date"],
        "warranty_expiry": appliance["warranty_expiry"],
        "warranty_status": appliance["warranty_status"],
        "note": "Demo warranty record. Confirm coverage and exclusions with the manufacturer before relying on it.",
    }


def search_troubleshooting_guide(appliance_id: str, symptoms: str) -> dict[str, Any]:
    details = get_appliance_details(appliance_id)
    if not details["ok"]:
        return details
    appliance = details["appliance"]
    guide = GUIDES.get(appliance["appliance_type"])
    if not guide:
        return {"ok": False, "error": "No troubleshooting guide is available for this appliance type yet."}

    normalized = symptoms.casefold()
    matched_terms = [term for term in guide["matches"] if term in normalized]
    # Return the safe, relevant guide; do not claim to diagnose the actual fault.
    return {
        "ok": True,
        "appliance_id": appliance_id,
        "appliance": f"{appliance['brand']} {appliance['model']}",
        "symptoms_received": symptoms,
        "guide_title": guide["title"],
        "matched_terms": matched_terms,
        "steps": guide["steps"],
        "safety_note": guide["safety_note"],
        "assessment": "These are initial user-safe checks, not a confirmed diagnosis. Stop if the appliance appears unsafe.",
    }


def get_available_appointment_slots(date: str = "", limit: int = 6) -> dict[str, Any]:
    if date:
        try:
            datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            return {"ok": False, "error": "date must use YYYY-MM-DD format."}
    safe_limit = max(1, min(int(limit), 20))
    now = _now()
    with connect() as conn:
        if date:
            rows = conn.execute(
                """SELECT * FROM appointment_slots
                   WHERE status = 'available' AND starts_at > ? AND substr(starts_at, 1, 10) = ?
                   ORDER BY starts_at LIMIT ?""",
                (now, date, safe_limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM appointment_slots
                   WHERE status = 'available' AND starts_at > ?
                   ORDER BY starts_at LIMIT ?""",
                (now, safe_limit),
            ).fetchall()
    return {"ok": True, "count": len(rows), "slots": [dict(row) for row in rows], "demo_notice": "Appointment slots are simulated for this demo."}


def create_repair_case(appliance_id: str, issue_description: str) -> dict[str, Any]:
    issue_description = issue_description.strip()
    if len(issue_description) < 8:
        return {"ok": False, "error": "Describe the issue in at least 8 characters so the case is useful."}
    details = get_appliance_details(appliance_id)
    if not details["ok"]:
        return details
    case_id = f"FF-{uuid.uuid4().hex[:8].upper()}"
    now = _now()
    warranty = details["appliance"]["warranty_status"]
    with connect() as conn:
        conn.execute(
            """INSERT INTO repair_cases
               (case_id, appliance_id, issue_description, status, warranty_status,
                current_slot_id, cancellation_reason, created_at, updated_at)
               VALUES (?, ?, ?, 'reported', ?, NULL, NULL, ?, ?)""",
            (case_id, appliance_id, issue_description, warranty, now, now),
        )
    return {
        "ok": True,
        "case_id": case_id,
        "status": "reported",
        "appliance_id": appliance_id,
        "issue_description": issue_description,
        "warranty_status": warranty,
        "next_steps": ["Review the troubleshooting guidance", "Choose an appointment slot if you want a technician"],
        "message": "Repair case created. No appointment has been booked.",
    }


def get_repair_case(case_id: str) -> dict[str, Any]:
    with connect() as conn:
        row = conn.execute(
            """SELECT c.*, a.brand, a.model, a.appliance_type, a.warranty_expiry,
                      s.starts_at, s.ends_at, s.technician_name, s.status AS slot_status
               FROM repair_cases c JOIN appliances a ON a.appliance_id = c.appliance_id
               LEFT JOIN appointment_slots s ON s.slot_id = c.current_slot_id
               WHERE c.case_id = ?""",
            (case_id.strip().upper(),),
        ).fetchone()
    case = row_to_dict(row)
    if not case:
        return {"ok": False, "error": f"Repair case {case_id!r} was not found."}
    return {"ok": True, "case": case}


def book_repair_appointment(case_id: str, slot_id: str, user_confirmed: bool = False) -> dict[str, Any]:
    case_id, slot_id = case_id.strip().upper(), slot_id.strip().upper()
    case_result = get_repair_case(case_id)
    if not case_result["ok"]:
        return case_result
    case = case_result["case"]
    if case["status"] not in ("reported", "needs_rescheduling"):
        return {"ok": False, "error": f"Case {case_id} is {case['status']}; it cannot be booked in its current state."}
    if not user_confirmed:
        return {
            "ok": False,
            "status": "confirmation_required",
            "case_id": case_id,
            "slot_id": slot_id,
            "message": "No booking was made. Show the time and technician to the user, then call again with user_confirmed=true only after explicit approval.",
        }

    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        slot = conn.execute("SELECT * FROM appointment_slots WHERE slot_id = ?", (slot_id,)).fetchone()
        if not slot:
            conn.rollback()
            return {"ok": False, "error": f"Slot {slot_id} does not exist."}
        if slot["status"] != "available" or slot["starts_at"] <= _now():
            conn.rollback()
            return {"ok": False, "status": "slot_unavailable", "message": "That slot is no longer available. Fetch fresh slots and ask the user to choose again."}
        conn.execute("UPDATE appointment_slots SET status = 'booked' WHERE slot_id = ?", (slot_id,))
        conn.execute(
            """UPDATE repair_cases SET current_slot_id = ?, status = 'scheduled',
               cancellation_reason = NULL, updated_at = ? WHERE case_id = ?""",
            (slot_id, _now(), case_id),
        )
        conn.commit()
    return {
        "ok": True,
        "case_id": case_id,
        "status": "scheduled",
        "slot": {"slot_id": slot_id, "starts_at": slot["starts_at"], "ends_at": slot["ends_at"], "technician_name": slot["technician_name"]},
        "message": "Demo appointment booked and saved to the local database.",
    }


def simulate_technician_cancellation(case_id: str) -> dict[str, Any]:
    """Hackathon demo control: simulate a provider cancellation for a scheduled case."""
    case_id = case_id.strip().upper()
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        case = conn.execute("SELECT * FROM repair_cases WHERE case_id = ?", (case_id,)).fetchone()
        if not case:
            conn.rollback()
            return {"ok": False, "error": f"Repair case {case_id!r} was not found."}
        if case["status"] != "scheduled" or not case["current_slot_id"]:
            conn.rollback()
            return {"ok": False, "error": "Only a scheduled repair case can be used for the cancellation demo."}
        slot = conn.execute("SELECT * FROM appointment_slots WHERE slot_id = ?", (case["current_slot_id"],)).fetchone()
        conn.execute("UPDATE appointment_slots SET status = 'cancelled' WHERE slot_id = ?", (case["current_slot_id"],))
        conn.execute(
            """UPDATE repair_cases SET status = 'needs_rescheduling',
               cancellation_reason = ?, updated_at = ? WHERE case_id = ?""",
            ("Technician unavailable (simulated demo event)", _now(), case_id),
        )
        conn.commit()
    return {
        "ok": True,
        "case_id": case_id,
        "status": "needs_rescheduling",
        "cancelled_slot_id": slot["slot_id"] if slot else None,
        "message": "Simulated cancellation recorded. The case remains open and needs a replacement appointment.",
        "demo_only": True,
    }


def reschedule_repair_appointment(case_id: str, slot_id: str, user_confirmed: bool = False) -> dict[str, Any]:
    case_id, slot_id = case_id.strip().upper(), slot_id.strip().upper()
    case_result = get_repair_case(case_id)
    if not case_result["ok"]:
        return case_result
    if case_result["case"]["status"] != "needs_rescheduling":
        return {"ok": False, "error": "This case is not currently waiting for rescheduling."}
    return book_repair_appointment(case_id, slot_id, user_confirmed=user_confirmed)
