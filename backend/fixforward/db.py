"""SQLite storage and seed data for FixForward AI's demo backend."""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


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
    """Create tables and insert repeatable demo records when the DB is empty."""
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

            CREATE INDEX IF NOT EXISTS idx_slots_status_time
                ON appointment_slots(status, starts_at);
            CREATE INDEX IF NOT EXISTS idx_cases_appliance
                ON repair_cases(appliance_id, created_at);
            """
        )

        if conn.execute("SELECT COUNT(*) FROM appliances").fetchone()[0] == 0:
            today = datetime.now().date()
            appliances = [
                ("APL-1001", "WhirlNest", "WashPro 8kg", "washing_machine",
                 (today - timedelta(days=300)).isoformat(), (today + timedelta(days=65)).isoformat(), "Home · Utility area"),
                ("APL-1002", "CoolHaven", "FrostGuard 350", "refrigerator",
                 (today - timedelta(days=950)).isoformat(), (today - timedelta(days=220)).isoformat(), "Home · Kitchen"),
                ("APL-1003", "SparkHome", "CleanWave D12", "dishwasher",
                 (today - timedelta(days=140)).isoformat(), (today + timedelta(days=225)).isoformat(), "Home · Kitchen"),
            ]
            conn.executemany(
                """INSERT INTO appliances
                   (appliance_id, brand, model, appliance_type, purchase_date,
                    warranty_expiry, location_label) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                appliances,
            )

        if conn.execute("SELECT COUNT(*) FROM appointment_slots").fetchone()[0] == 0:
            now = datetime.now().astimezone().replace(second=0, microsecond=0)
            slots: list[tuple[str, str, str, str, str, str]] = []
            slot_no = 1
            for offset, hours in [(1, 10), (1, 14), (2, 9), (2, 13), (3, 11), (3, 15), (4, 10)]:
                start = (now + timedelta(days=offset)).replace(hour=hours, minute=0)
                end = start + timedelta(minutes=90)
                technician = ["Maya R.", "Arjun K.", "Riya S.", "Kabir P."][slot_no % 4]
                slots.append((f"SLOT-{slot_no:03d}", "appliance_repair", start.isoformat(), end.isoformat(), technician, "available"))
                slot_no += 1
            conn.executemany(
                """INSERT INTO appointment_slots
                   (slot_id, service_type, starts_at, ends_at, technician_name, status)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                slots,
            )
