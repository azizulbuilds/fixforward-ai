"""SQLite storage and single-washing-machine seed data for FixForward AI."""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


DEMO_APPLIANCE_ID = "APL-1001"


def _db_path() -> Path:
    configured = os.getenv("FIXFORWARD_DB_PATH")
    if configured:
        path = Path(configured).expanduser().resolve()
    else:
        path = Path(__file__).resolve().parents[1] / "data" / "fixforward.db"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(_db_path(), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def init_db() -> None:
    """Create tables and ensure the demo account contains only WashPro 8kg.

    The pruning below is intentional: earlier demo versions seeded a refrigerator
    and dishwasher. Existing local databases are migrated to this project's
    focused, single-appliance scope on startup.
    """
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS appliances (
                appliance_id TEXT PRIMARY KEY,
                brand TEXT NOT NULL,
                model TEXT NOT NULL,
                appliance_type TEXT NOT NULL,
                purchase_date TEXT NOT NULL,
                warranty_expiry TEXT NOT NULL,
                location_label TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS appointment_slots (
                slot_id TEXT PRIMARY KEY,
                service_type TEXT NOT NULL,
                starts_at TEXT NOT NULL,
                ends_at TEXT NOT NULL,
                technician_name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available', 'booked', 'cancelled'))
            );

            CREATE TABLE IF NOT EXISTS repair_cases (
                case_id TEXT PRIMARY KEY,
                appliance_id TEXT NOT NULL REFERENCES appliances(appliance_id),
                issue_description TEXT NOT NULL,
                status TEXT NOT NULL
                    CHECK (status IN ('reported', 'scheduled', 'needs_rescheduling', 'resolved', 'closed')),
                warranty_status TEXT NOT NULL,
                current_slot_id TEXT REFERENCES appointment_slots(slot_id),
                cancellation_reason TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS appointment_history (
                event_id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL REFERENCES repair_cases(case_id) ON DELETE CASCADE,
                event_type TEXT NOT NULL
                    CHECK (event_type IN ('snapshot', 'booked', 'cancelled', 'rescheduled')),
                slot_id TEXT NOT NULL REFERENCES appointment_slots(slot_id),
                previous_slot_id TEXT REFERENCES appointment_slots(slot_id),
                starts_at TEXT NOT NULL,
                ends_at TEXT NOT NULL,
                technician_name TEXT NOT NULL,
                event_at TEXT NOT NULL,
                notes TEXT
            );

            CREATE TABLE IF NOT EXISTS case_activity (
                activity_id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL REFERENCES repair_cases(case_id) ON DELETE CASCADE,
                event_type TEXT NOT NULL,
                from_status TEXT,
                to_status TEXT,
                notes TEXT NOT NULL DEFAULT '',
                occurred_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_slots_status_time
                ON appointment_slots(status, starts_at);
            CREATE INDEX IF NOT EXISTS idx_cases_appliance
                ON repair_cases(appliance_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_appointment_history_case_time
                ON appointment_history(case_id, event_at);
            CREATE INDEX IF NOT EXISTS idx_case_activity_case_time
                ON case_activity(case_id, occurred_at);
            """
        )

        # Release appointments that were attached to out-of-scope appliances,
        # then remove those old demo cases and appliance records.
        conn.execute(
            """UPDATE appointment_slots
               SET status = 'available'
               WHERE status = 'booked'
                 AND slot_id IN (
                   SELECT c.current_slot_id
                   FROM repair_cases c
                   JOIN appliances a ON a.appliance_id = c.appliance_id
                   WHERE c.appliance_id != ? AND c.current_slot_id IS NOT NULL
                 )""",
            (DEMO_APPLIANCE_ID,),
        )
        conn.execute("DELETE FROM repair_cases WHERE appliance_id != ?", (DEMO_APPLIANCE_ID,))
        conn.execute("DELETE FROM appliances WHERE appliance_id != ?", (DEMO_APPLIANCE_ID,))

        today = datetime.now().date()
        conn.execute(
            """INSERT OR IGNORE INTO appliances
               (appliance_id, brand, model, appliance_type, purchase_date,
                warranty_expiry, location_label)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                DEMO_APPLIANCE_ID,
                "WhirlNest",
                "WashPro 8kg",
                "washing_machine",
                (today - timedelta(days=300)).isoformat(),
                (today + timedelta(days=65)).isoformat(),
                "Home · Utility area",
            ),
        )

        # All seeded slots now refer to the single washing-machine service flow.
        conn.execute("UPDATE appointment_slots SET service_type = 'washing_machine_repair' WHERE service_type != 'washing_machine_repair'")

        if conn.execute("SELECT COUNT(*) FROM appointment_slots").fetchone()[0] == 0:
            now = datetime.now().astimezone().replace(second=0, microsecond=0)
            slots: list[tuple[str, str, str, str, str, str]] = []
            slot_no = 1
            for offset, hours in [(1, 10), (1, 14), (2, 9), (2, 13), (3, 11), (3, 15), (4, 10)]:
                start = (now + timedelta(days=offset)).replace(hour=hours, minute=0)
                end = start + timedelta(minutes=90)
                technician = ["Maya R.", "Arjun K.", "Riya S.", "Kabir P."][slot_no % 4]
                slots.append((f"SLOT-{slot_no:03d}", "washing_machine_repair", start.isoformat(), end.isoformat(), technician, "available"))
                slot_no += 1
            conn.executemany(
                """INSERT INTO appointment_slots
                   (slot_id, service_type, starts_at, ends_at, technician_name, status)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                slots,
            )


        # Existing databases predate appointment-history logging. Record a clearly
        # labelled current-state snapshot for any case with a current slot, but do
        # not manufacture historical booking/cancellation events that were never saved.
        migration_time = datetime.now().astimezone().replace(microsecond=0).isoformat()
        cases_to_snapshot = conn.execute(
            """SELECT c.case_id, c.current_slot_id, s.starts_at, s.ends_at, s.technician_name
               FROM repair_cases c
               JOIN appointment_slots s ON s.slot_id = c.current_slot_id
               WHERE c.current_slot_id IS NOT NULL
                 AND NOT EXISTS (
                     SELECT 1 FROM appointment_history h WHERE h.case_id = c.case_id
                 )"""
        ).fetchall()
        for row in cases_to_snapshot:
            conn.execute(
                """INSERT INTO appointment_history
                   (event_id, case_id, event_type, slot_id, previous_slot_id,
                    starts_at, ends_at, technician_name, event_at, notes)
                   VALUES (?, ?, 'snapshot', ?, NULL, ?, ?, ?, ?, ?)""",
                (
                    f"MIGRATION-SNAPSHOT-{row['case_id']}",
                    row['case_id'],
                    row['current_slot_id'],
                    row['starts_at'],
                    row['ends_at'],
                    row['technician_name'],
                    migration_time,
                    "Current appointment snapshot created during history migration; this does not prove the original booking time or recover earlier cancellations.",
                ),
            )
