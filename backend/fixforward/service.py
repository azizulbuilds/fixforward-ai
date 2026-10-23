"""Business logic for the FixForward AI appliance-repair workflow."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
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


def _record_case_activity(
    conn,
    case_id: str,
    event_type: str,
    from_status: str | None,
    to_status: str | None,
    notes: str,
    occurred_at: str | None = None,
) -> None:
    """Persist a forward-looking case event; never synthesize missing past events."""
    conn.execute(
        """INSERT INTO case_activity
           (activity_id, case_id, event_type, from_status, to_status, notes, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (uuid.uuid4().hex, case_id, event_type, from_status, to_status, notes, occurred_at or _now()),
    )


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


def _replenish_future_demo_slots(conn, *, now: datetime, minimum_available: int) -> bool:
    """Ensure the demo has future slots after repeated tests consume the seed slots.

    This only adds new simulated inventory. Existing slots and repair cases are never
    overwritten. Specific-date lookups do not trigger replenishment.
    """
    now_text = now.replace(microsecond=0).isoformat()
    available_count = conn.execute(
        "SELECT COUNT(*) FROM appointment_slots WHERE status = 'available' AND starts_at > ?",
        (now_text,),
    ).fetchone()[0]
    if available_count >= minimum_available:
        return False

    all_start_times = {
        row[0] for row in conn.execute("SELECT starts_at FROM appointment_slots").fetchall()
    }
    technicians = ["Maya R.", "Arjun K.", "Riya S.", "Kabir P."]
    added = 0

    # Generate a fresh set over the next two weeks so repeated demo runs do not
    # exhaust the appointment picker. Each start time and slot ID remains unique.
    for day_offset in range(1, 15):
        day = (now + timedelta(days=day_offset)).date()
        for hour, minute in ((9, 30), (11, 0), (13, 30), (15, 0)):
            start_at = datetime.combine(day, datetime.min.time(), tzinfo=now.tzinfo).replace(
                hour=hour, minute=minute, second=0, microsecond=0
            )
            if start_at <= now:
                continue
            start_text = start_at.isoformat()
            if start_text in all_start_times:
                continue
            end_text = (start_at + timedelta(minutes=90)).isoformat()
            slot_id = f"SLOT-D{uuid.uuid4().hex[:8].upper()}"
            technician = technicians[(available_count + added) % len(technicians)]
            conn.execute(
                """INSERT INTO appointment_slots
                   (slot_id, service_type, starts_at, ends_at, technician_name, status)
                   VALUES (?, 'washing_machine_repair', ?, ?, ?, 'available')""",
                (slot_id, start_text, end_text, technician),
            )
            all_start_times.add(start_text)
            added += 1
            if available_count + added >= minimum_available:
                return True
    return added > 0


def get_available_appointment_slots(date: str = "", limit: int = 6) -> dict[str, Any]:
    """List future simulated slots; refill the general picker when demo stock is low.

    Undated lookups (used by the workspace Refresh button) maintain enough future
    simulated slots for the requested page size. Date-filtered lookups only return
    actual slots for that date and never silently invent date-specific availability.
    """
    if date:
        try:
            datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            return {"ok": False, "error": "date must use YYYY-MM-DD format."}

    safe_limit = max(1, min(int(limit), 20))
    now = datetime.now().astimezone().replace(microsecond=0)
    now_text = now.isoformat()
    replenished = False

    with connect() as conn:
        if not date:
            # Serialize replenishment so two simultaneous refreshes cannot create a race.
            conn.execute("BEGIN IMMEDIATE")
            replenished = _replenish_future_demo_slots(
                conn, now=now, minimum_available=safe_limit
            )
            conn.commit()

        if date:
            rows = conn.execute(
                """SELECT * FROM appointment_slots
                   WHERE status = 'available' AND starts_at > ? AND substr(starts_at, 1, 10) = ?
                   ORDER BY starts_at LIMIT ?""",
                (now_text, date, safe_limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM appointment_slots
                   WHERE status = 'available' AND starts_at > ?
                   ORDER BY starts_at LIMIT ?""",
                (now_text, safe_limit),
            ).fetchall()

    result: dict[str, Any] = {
        "ok": True,
        "count": len(rows),
        "slots": [dict(row) for row in rows],
        "demo_notice": "Appointment slots are simulated for this demo.",
        "slots_replenished": replenished,
    }
    if replenished:
        result["availability_note"] = (
            "Fresh simulated future slots were generated because earlier demo slots had been exhausted."
        )
    return result


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
        _record_case_activity(
            conn, case_id, "case_opened", None, "reported",
            "Repair case created. No appointment has been booked.", now,
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



def get_appointment_history(case_id: str) -> dict[str, Any]:
    """Return saved appointment events for a case without changing any records."""
    normalized_case_id = str(case_id or "").strip().upper()
    with connect() as conn:
        case_row = conn.execute(
            """SELECT c.case_id, c.status AS case_status, c.current_slot_id,
                      c.cancellation_reason, c.updated_at
               FROM repair_cases c WHERE c.case_id = ?""",
            (normalized_case_id,),
        ).fetchone()
        if not case_row:
            return {"ok": False, "error": f"Repair case {normalized_case_id!r} was not found."}
        rows = conn.execute(
            """SELECT event_id, case_id, event_type, slot_id, previous_slot_id,
                      starts_at, ends_at, technician_name, event_at, notes
               FROM appointment_history WHERE case_id = ?
               ORDER BY event_at ASC, rowid ASC""",
            (normalized_case_id,),
        ).fetchall()

    history = [dict(row) for row in rows]
    has_snapshot = any(item["event_type"] == "snapshot" for item in history)
    note = None
    if has_snapshot:
        note = (
            "This database had an existing appointment when history logging was introduced. "
            "The snapshot records the current saved appointment only; earlier booking or cancellation "
            "events were not stored by the old schema and cannot be reliably reconstructed."
        )
    elif not history:
        note = "No appointment-history events have been recorded for this case yet."

    return {
        "ok": True,
        "case": dict(case_row),
        "history": history,
        "historical_events_complete": not has_snapshot,
        "history_note": note,
        "read_only": True,
        "demo_notice": "All appointment and technician information is simulated demo data.",
    }


def get_repair_case_activity(case_id: str) -> dict[str, Any]:
    """Return saved case lifecycle events. Older cases may have no pre-logging events."""
    normalized_case_id = str(case_id or "").strip().upper()
    with connect() as conn:
        case = conn.execute(
            "SELECT case_id FROM repair_cases WHERE case_id = ?",
            (normalized_case_id,),
        ).fetchone()
        if not case:
            return {"ok": False, "error": f"Repair case {normalized_case_id!r} was not found."}
        rows = conn.execute(
            """SELECT activity_id, case_id, event_type, from_status, to_status, notes, occurred_at
               FROM case_activity WHERE case_id = ? ORDER BY occurred_at ASC, rowid ASC""",
            (normalized_case_id,),
        ).fetchall()
    activity = [dict(row) for row in rows]
    return {
        "ok": True,
        "case_id": normalized_case_id,
        "activity": activity,
        "activity_note": None if activity else (
            "No case-activity events were saved for this case before lifecycle logging was introduced. "
            "New actions will be recorded from this point forward."
        ),
        "read_only": True,
    }


def update_repair_case_status(case_id: str, target_status: str, notes: str = "") -> dict[str, Any]:
    """Resolve an active case or close a resolved case, recording each transition."""
    normalized_case_id = str(case_id or "").strip().upper()
    target_status = str(target_status or "").strip().lower()
    notes = str(notes or "").strip()
    allowed_targets = {"resolved", "closed"}
    if target_status not in allowed_targets:
        return {"ok": False, "error": "Supported lifecycle actions are resolve and close."}
    if target_status == "resolved" and len(notes) < 8:
        return {"ok": False, "error": "Add a brief resolution note of at least 8 characters."}

    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        case = conn.execute(
            "SELECT case_id, status, current_slot_id FROM repair_cases WHERE case_id = ?",
            (normalized_case_id,),
        ).fetchone()
        if not case:
            conn.rollback()
            return {"ok": False, "error": f"Repair case {normalized_case_id!r} was not found."}

        current_status = case["status"]
        if target_status == "resolved":
            if current_status not in ("reported", "scheduled", "needs_rescheduling"):
                conn.rollback()
                return {"ok": False, "error": f"Case {normalized_case_id} is already {current_status}."}
            if current_status == "scheduled" and case["current_slot_id"]:
                slot = conn.execute(
                    "SELECT ends_at FROM appointment_slots WHERE slot_id = ?",
                    (case["current_slot_id"],),
                ).fetchone()
                if slot:
                    try:
                        appointment_end = datetime.fromisoformat(slot["ends_at"])
                        now_dt = datetime.now().astimezone()
                        if appointment_end.tzinfo is None:
                            appointment_end = appointment_end.astimezone()
                        if appointment_end > now_dt:
                            conn.rollback()
                            return {
                                "ok": False,
                                "error": "This case has a future booked visit. Resolve it after the appointment ends, or use the appointment recovery flow if the visit cannot go ahead.",
                            }
                    except ValueError:
                        conn.rollback()
                        return {"ok": False, "error": "The saved appointment time could not be validated; the case was not changed."}
        elif current_status != "resolved":
            conn.rollback()
            return {"ok": False, "error": "A case must be resolved before it can be closed."}

        occurred_at = _now()
        conn.execute(
            "UPDATE repair_cases SET status = ?, cancellation_reason = NULL, updated_at = ? WHERE case_id = ?",
            (target_status, occurred_at, normalized_case_id),
        )
        _record_case_activity(
            conn,
            normalized_case_id,
            "case_resolved" if target_status == "resolved" else "case_closed",
            current_status,
            target_status,
            notes or ("Homeowner confirmed the resolved case can be closed." if target_status == "closed" else "Repair marked resolved."),
            occurred_at,
        )
        conn.commit()

    latest = get_repair_case(normalized_case_id)
    if not latest.get("ok"):
        return latest
    return {"ok": True, "case": latest["case"], "status": target_status, "message": f"Repair case {normalized_case_id} marked {target_status}.", "activity_recorded": True}


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
        fresh_case = conn.execute(
            "SELECT case_id, status, current_slot_id FROM repair_cases WHERE case_id = ?",
            (case_id,),
        ).fetchone()
        if not fresh_case:
            conn.rollback()
            return {"ok": False, "error": f"Repair case {case_id!r} was not found."}
        if fresh_case["status"] not in ("reported", "needs_rescheduling"):
            conn.rollback()
            return {"ok": False, "error": f"Case {case_id} is {fresh_case['status']}; it cannot be booked in its current state."}

        slot = conn.execute("SELECT * FROM appointment_slots WHERE slot_id = ?", (slot_id,)).fetchone()
        if not slot:
            conn.rollback()
            return {"ok": False, "error": f"Slot {slot_id} does not exist."}
        if slot["status"] != "available" or slot["starts_at"] <= _now():
            conn.rollback()
            return {"ok": False, "status": "slot_unavailable", "message": "That slot is no longer available. Fetch fresh slots and ask the user to choose again."}

        event_time = _now()
        is_reschedule = fresh_case["status"] == "needs_rescheduling"
        previous_slot_id = fresh_case["current_slot_id"] if is_reschedule else None
        conn.execute("UPDATE appointment_slots SET status = 'booked' WHERE slot_id = ?", (slot_id,))
        conn.execute(
            """UPDATE repair_cases SET current_slot_id = ?, status = 'scheduled',
               cancellation_reason = NULL, updated_at = ? WHERE case_id = ?""",
            (slot_id, event_time, case_id),
        )
        conn.execute(
            """INSERT INTO appointment_history
               (event_id, case_id, event_type, slot_id, previous_slot_id,
                starts_at, ends_at, technician_name, event_at, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                uuid.uuid4().hex,
                case_id,
                "rescheduled" if is_reschedule else "booked",
                slot["slot_id"],
                previous_slot_id,
                slot["starts_at"],
                slot["ends_at"],
                slot["technician_name"],
                event_time,
                "Replacement slot confirmed by user." if is_reschedule else "Appointment confirmed by user.",
            ),
        )
        _record_case_activity(
            conn,
            case_id,
            "appointment_rescheduled" if is_reschedule else "appointment_booked",
            fresh_case["status"],
            "scheduled",
            (f"Replacement visit confirmed: {slot['slot_id']} with {slot['technician_name']}." if is_reschedule
             else f"Visit confirmed: {slot['slot_id']} with {slot['technician_name']}.") ,
            event_time,
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
    """Record a demo-only cancellation and preserve its appointment event in history."""
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
        if not slot:
            conn.rollback()
            return {"ok": False, "error": "The scheduled case references a missing appointment slot; no cancellation was made."}
        if slot["status"] != "booked":
            conn.rollback()
            return {"ok": False, "error": f"The saved appointment slot is {slot['status']!r}, not booked; no cancellation was made."}

        event_time = _now()
        reason = "Technician unavailable (simulated demo event)"
        conn.execute("UPDATE appointment_slots SET status = 'cancelled' WHERE slot_id = ?", (slot["slot_id"],))
        conn.execute(
            """UPDATE repair_cases SET status = 'needs_rescheduling',
               cancellation_reason = ?, updated_at = ? WHERE case_id = ?""",
            (reason, event_time, case_id),
        )
        conn.execute(
            """INSERT INTO appointment_history
               (event_id, case_id, event_type, slot_id, previous_slot_id,
                starts_at, ends_at, technician_name, event_at, notes)
               VALUES (?, ?, 'cancelled', ?, NULL, ?, ?, ?, ?, ?)""",
            (
                uuid.uuid4().hex,
                case_id,
                slot["slot_id"],
                slot["starts_at"],
                slot["ends_at"],
                slot["technician_name"],
                event_time,
                reason,
            ),
        )
        _record_case_activity(
            conn, case_id, "technician_cancelled", "scheduled", "needs_rescheduling",
            f"{reason}; original slot {slot['slot_id']}.", event_time,
        )
        conn.commit()
    return {
        "ok": True,
        "case_id": case_id,
        "status": "needs_rescheduling",
        "cancelled_slot_id": slot["slot_id"],
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