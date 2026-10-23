"""Service-layer tests use a temporary SQLite database and no external services."""
import os
import tempfile
import unittest
from pathlib import Path

from fixforward.db import connect, init_db
from fixforward.service import (
    book_repair_appointment,
    create_repair_case,
    get_available_appointment_slots,
    get_appointment_history,
    get_appliance_details,
    get_repair_case,
    list_appliances,
    reschedule_repair_appointment,
    simulate_technician_cancellation,
)


class FixForwardServiceTests(unittest.TestCase):
    def setUp(self):
        self._tempdir = tempfile.TemporaryDirectory()
        os.environ["FIXFORWARD_DB_PATH"] = str(Path(self._tempdir.name) / "test.db")
        init_db()

    def tearDown(self):
        self._tempdir.cleanup()
        os.environ.pop("FIXFORWARD_DB_PATH", None)

    def test_demo_supports_only_washpro_washing_machine(self):
        appliances = list_appliances()
        self.assertEqual(len(appliances), 1)
        self.assertEqual(appliances[0]["appliance_id"], "APL-1001")
        self.assertEqual(appliances[0]["model"], "WashPro 8kg")
        self.assertEqual(appliances[0]["appliance_type"], "washing_machine")
        unsupported = get_appliance_details("APL-1002")
        self.assertFalse(unsupported["ok"])
        self.assertEqual(unsupported["available_ids"], ["APL-1001"])

    def test_startup_migration_removes_old_appliance_records(self):
        with connect() as conn:
            conn.execute(
                """INSERT INTO appliances
                   (appliance_id, brand, model, appliance_type, purchase_date,
                    warranty_expiry, location_label)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                ("APL-1002", "CoolHaven", "FrostGuard 350", "refrigerator", "2024-01-01", "2025-01-01", "Kitchen"),
            )
        init_db()
        with connect() as conn:
            appliance_rows = conn.execute("SELECT appliance_id, appliance_type FROM appliances").fetchall()
        self.assertEqual([(row["appliance_id"], row["appliance_type"]) for row in appliance_rows], [("APL-1001", "washing_machine")])

    def test_case_creation_persists(self):
        created = create_repair_case("APL-1001", "Washer shakes loudly during spin")
        self.assertTrue(created["ok"])
        self.assertEqual(created["status"], "reported")
        self.assertEqual(get_repair_case(created["case_id"])["case"]["status"], "reported")

    def test_booking_requires_explicit_confirmation(self):
        created = create_repair_case("APL-1001", "Washer shakes loudly during spin")
        slot = get_available_appointment_slots()["slots"][0]
        denied = book_repair_appointment(created["case_id"], slot["slot_id"], user_confirmed=False)
        self.assertEqual(denied["status"], "confirmation_required")
        self.assertEqual(get_repair_case(created["case_id"])["case"]["status"], "reported")
        booked = book_repair_appointment(created["case_id"], slot["slot_id"], user_confirmed=True)
        self.assertTrue(booked["ok"])
        self.assertEqual(booked["status"], "scheduled")

    def test_cancellation_recovery_flow(self):
        created = create_repair_case("APL-1001", "Washer shakes loudly during spin")
        first_slot = get_available_appointment_slots()["slots"][0]
        booked = book_repair_appointment(created["case_id"], first_slot["slot_id"], user_confirmed=True)
        self.assertTrue(booked["ok"])
        cancelled = simulate_technician_cancellation(created["case_id"])
        self.assertEqual(cancelled["status"], "needs_rescheduling")
        alternate = next(slot for slot in get_available_appointment_slots()["slots"] if slot["slot_id"] != first_slot["slot_id"])
        rescheduled = reschedule_repair_appointment(created["case_id"], alternate["slot_id"], user_confirmed=True)
        self.assertEqual(rescheduled["status"], "scheduled")
        self.assertEqual(get_repair_case(created["case_id"])["case"]["current_slot_id"], alternate["slot_id"])

        history = get_appointment_history(created["case_id"])
        self.assertTrue(history["ok"])
        self.assertEqual([event["event_type"] for event in history["history"]], ["booked", "cancelled", "rescheduled"])
        self.assertEqual(history["history"][0]["slot_id"], first_slot["slot_id"])
        self.assertEqual(history["history"][1]["slot_id"], first_slot["slot_id"])
        self.assertEqual(history["history"][2]["slot_id"], alternate["slot_id"])
        self.assertEqual(history["history"][2]["previous_slot_id"], first_slot["slot_id"])
        self.assertTrue(history["historical_events_complete"])

    def test_existing_scheduled_case_gets_truthful_snapshot_during_migration(self):
        created = create_repair_case("APL-1001", "Washer shakes loudly during spin")
        slot = get_available_appointment_slots()["slots"][0]
        booked = book_repair_appointment(created["case_id"], slot["slot_id"], user_confirmed=True)
        self.assertTrue(booked["ok"])
        # Simulate an old database where the history table exists but has no event records.
        with connect() as conn:
            conn.execute("DELETE FROM appointment_history WHERE case_id = ?", (created["case_id"],))
        init_db()
        history = get_appointment_history(created["case_id"])
        self.assertEqual(len(history["history"]), 1)
        self.assertEqual(history["history"][0]["event_type"], "snapshot")
        self.assertFalse(history["historical_events_complete"])
        self.assertIn("cannot be reliably reconstructed", history["history_note"])


if __name__ == "__main__":
    unittest.main()
