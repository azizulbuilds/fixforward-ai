"""Service-layer tests use a temporary SQLite database and no external services."""
import os
import tempfile
import unittest
from pathlib import Path

from fixforward.db import init_db
from fixforward.service import (
    book_repair_appointment,
    create_repair_case,
    get_available_appointment_slots,
    get_repair_case,
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


if __name__ == "__main__":
    unittest.main()
