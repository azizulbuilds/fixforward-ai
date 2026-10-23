"""Tests for FixForward's conversational router without any AWS credentials."""
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fixforward.agent import _make_action, chat_with_agent, get_agent_status
from fixforward.db import init_db
from fixforward.service import create_repair_case, get_available_appointment_slots, book_repair_appointment


class FixForwardAgentTests(unittest.TestCase):
    def setUp(self):
        self._tempdir = tempfile.TemporaryDirectory()
        os.environ["FIXFORWARD_DB_PATH"] = str(Path(self._tempdir.name) / "agent-test.db")
        os.environ.pop("BEDROCK_MODEL_ID", None)
        os.environ.pop("AWS_BEARER_TOKEN_BEDROCK", None)
        os.environ.pop("OPENAI_API_KEY", None)
        os.environ.pop("AI_PROVIDER", None)
        init_db()
        self.case = create_repair_case("APL-1001", "Washer shakes loudly during spin")

    def tearDown(self):
        self._tempdir.cleanup()
        os.environ.pop("FIXFORWARD_DB_PATH", None)
        os.environ.pop("BEDROCK_MODEL_ID", None)
        os.environ.pop("AWS_BEARER_TOKEN_BEDROCK", None)
        os.environ.pop("OPENAI_API_KEY", None)
        os.environ.pop("AI_PROVIDER", None)

    def test_status_reports_local_mode_when_bedrock_not_configured(self):
        self.assertEqual(get_agent_status()["mode"], "local_rules")


    def test_gpt_oss_runtime_id_is_normalized_for_bedrock_mantle(self):
        os.environ["AI_PROVIDER"] = "bedrock"
        os.environ["BEDROCK_MODEL_ID"] = "openai.gpt-oss-20b-1:0"
        os.environ["AWS_BEARER_TOKEN_BEDROCK"] = "test-only-not-a-real-key"
        try:
            status = get_agent_status()
            self.assertEqual(status["model_id"], "openai.gpt-oss-20b")
            self.assertEqual(status["provider"], "amazon-bedrock-mantle")
        finally:
            os.environ.pop("BEDROCK_MODEL_ID", None)
            os.environ.pop("AWS_BEARER_TOKEN_BEDROCK", None)
            os.environ.pop("AI_PROVIDER", None)

    def test_warranty_query_calls_warranty_service(self):
        response = chat_with_agent("Can you check my washer warranty?")
        self.assertIn("warranty", response["reply"].lower())
        self.assertEqual(response["tool_events"][0]["name"], "check_warranty")
        self.assertEqual(response["mode"], "local_rules")

    def test_vibration_query_returns_safety_guidance(self):
        response = chat_with_agent("My washer has loud vibration during spin")
        self.assertIn("safe first checks", response["reply"].lower())
        self.assertIn("find_troubleshooting_steps", [event["name"] for event in response["tool_events"]])

    def test_appointment_query_opens_confirmation_ui_not_booking(self):
        response = chat_with_agent("Find a technician appointment", case_id=self.case["case_id"])
        self.assertEqual(response["action"]["type"], "open_appointments")
        self.assertIn("get_available_appointment_slots", [event["name"] for event in response["tool_events"]])
        self.assertEqual(self.case["status"], "reported")

    def test_read_only_case_lookup_does_not_open_appointment_modal(self):
        prompt = (
            f"Retrieve repair case {self.case['case_id']} from the database. Show its current status, "
            "saved appointment date and time, technician name, and current slot ID. "
            "Do not change the case or book anything."
        )
        self.assertIsNone(_make_action(prompt, self.case["case_id"]))


    def test_appointment_history_request_is_read_only_and_does_not_open_slots(self):
        prompt = (
            f"Inspect the appointment history for repair case {self.case['case_id']}. "
            "Return appointment records and cancellation timestamps. This is read-only; do not book, cancel, or modify anything."
        )
        self.assertIsNone(_make_action(prompt, self.case["case_id"]))
        response = chat_with_agent(prompt, case_id=self.case["case_id"])
        self.assertIsNone(response["action"])
        self.assertIn("get_appointment_history", [event["name"] for event in response["tool_events"]])
        self.assertIn("read-only appointment history", response["reply"].lower())

    def test_available_slots_request_still_opens_appointment_modal(self):
        prompt = f"Show available demo technician appointment slots for repair case {self.case['case_id']}. Do not book anything yet."
        self.assertEqual(_make_action(prompt, self.case["case_id"])["type"], "open_appointments")

    def test_read_only_case_lookup_uses_status_tool_without_opening_slots(self):
        prompt = (
            f"Retrieve repair case {self.case['case_id']} from the database. Show its current status, "
            "saved appointment date and time, technician name, and current slot ID. "
            "Do not change the case or book anything."
        )
        response = chat_with_agent(prompt, case_id=self.case["case_id"])
        self.assertIsNone(response["action"])
        self.assertIn("get_repair_case_status", [event["name"] for event in response["tool_events"]])
        self.assertIn("current slot id", response["reply"].lower())
        self.assertEqual(self.case["status"], "reported")

    def test_read_only_case_lookup_does_not_open_appointment_modal(self):
        prompt = (
            f"Retrieve repair case {self.case['case_id']} from the database. Show its current status, "
            "saved appointment date and time, technician name, and current slot ID. "
            "Do not change the case or book anything."
        )
        self.assertIsNone(_make_action(prompt, self.case["case_id"]))

    def test_available_slots_request_still_opens_appointment_modal(self):
        prompt = f"Show available demo technician appointment slots for repair case {self.case['case_id']}. Do not book anything yet."
        self.assertEqual(_make_action(prompt, self.case["case_id"])["type"], "open_appointments")

    def test_explicit_case_request_opens_case_form(self):
        response = chat_with_agent("Please open a repair case for my noisy washing machine")
        self.assertEqual(response["action"]["type"], "open_repair_form")

    def test_safety_critical_message_prioritizes_stop_using_machine(self):
        response = chat_with_agent("I smell burning from the washing machine")
        self.assertIn("stop the washing machine", response["reply"].lower())
        self.assertIn("qualified technician", response["reply"].lower())

    def test_appointment_chat_never_books_without_ui_confirmation(self):
        # Booking remains in the explicit-confirmation REST/UI flow, not the agent tool set.
        response = chat_with_agent("Book an appointment now", case_id=self.case["case_id"])
        slots = get_available_appointment_slots()["slots"]
        self.assertTrue(slots)
        self.assertEqual(response["action"]["type"], "open_appointments")
        self.assertNotIn("book_appointment", [event["name"] for event in response["tool_events"]])


    def test_bedrock_tool_loop_executes_troubleshooting_and_returns_final_answer(self):
        """Mock the Bedrock Mantle response to prove the local tool loop works end to end."""
        os.environ["AI_PROVIDER"] = "bedrock"
        os.environ["BEDROCK_MODEL_ID"] = "openai.gpt-oss-20b"
        os.environ["AWS_BEARER_TOKEN_BEDROCK"] = "test-only-not-a-real-key"

        class FakeToolCall:
            id = "call_troubleshooting_1"
            type = "function"

            def __init__(self):
                self.function = SimpleNamespace(
                    name="find_troubleshooting_steps",
                    arguments='{"appliance_id":"APL-1001","symptoms":"heavy vibration during spin"}',
                )

            def model_dump(self, exclude_none=True):
                return {
                    "id": self.id,
                    "type": self.type,
                    "function": {
                        "name": self.function.name,
                        "arguments": self.function.arguments,
                    },
                }

        tool_message = SimpleNamespace(content=None, tool_calls=[FakeToolCall()])
        final_message = SimpleNamespace(
            content="The saved guide recommends checking the load balance and machine level. These are checks, not a diagnosis.",
            tool_calls=[],
        )
        fake_client = MagicMock()
        fake_client.chat.completions.create.side_effect = [
            SimpleNamespace(choices=[SimpleNamespace(message=tool_message)]),
            SimpleNamespace(choices=[SimpleNamespace(message=final_message)]),
        ]

        fake_openai_module = SimpleNamespace(OpenAI=MagicMock(return_value=fake_client))
        with patch.dict("sys.modules", {"openai": fake_openai_module}):
            response = chat_with_agent(
                "My washer vibrates heavily during spin. What should I check?",
                case_id=self.case["case_id"],
            )

        fake_openai_module.OpenAI.assert_called_once()
        self.assertEqual(fake_client.chat.completions.create.call_count, 2)
        self.assertEqual(response["mode"], "bedrock_tool_use")
        self.assertIn("amazon bedrock mantle", response["stamp"].lower())
        self.assertEqual(response["reply"], final_message.content)
        self.assertEqual(response["tool_events"][0]["name"], "find_troubleshooting_steps")
        self.assertEqual(response["tool_events"][0]["status"], "success")
        second_call_messages = fake_client.chat.completions.create.call_args_list[1].kwargs["messages"]
        self.assertTrue(any(item.get("role") == "tool" and "steps" in item.get("content", "") for item in second_call_messages))

    def test_bedrock_model_cannot_create_case_without_explicit_user_request(self):
        """Reject a model-invented case-creation call when user only asked for advice."""
        os.environ["AI_PROVIDER"] = "bedrock"
        os.environ["BEDROCK_MODEL_ID"] = "openai.gpt-oss-20b"
        os.environ["AWS_BEARER_TOKEN_BEDROCK"] = "test-only-not-a-real-key"

        class FakeToolCall:
            id = "call_illegal_case_create"
            type = "function"

            def __init__(self):
                self.function = SimpleNamespace(
                    name="open_repair_case",
                    arguments='{"appliance_id":"APL-1001","issue_description":"Washer makes loud noise"}',
                )

            def model_dump(self, exclude_none=True):
                return {
                    "id": self.id,
                    "type": self.type,
                    "function": {
                        "name": self.function.name,
                        "arguments": self.function.arguments,
                    },
                }

        first_message = SimpleNamespace(content=None, tool_calls=[FakeToolCall()])
        final_message = SimpleNamespace(content="I can offer troubleshooting guidance first.", tool_calls=[])
        fake_client = MagicMock()
        fake_client.chat.completions.create.side_effect = [
            SimpleNamespace(choices=[SimpleNamespace(message=first_message)]),
            SimpleNamespace(choices=[SimpleNamespace(message=final_message)]),
        ]

        fake_openai_module = SimpleNamespace(OpenAI=MagicMock(return_value=fake_client))
        with patch.dict("sys.modules", {"openai": fake_openai_module}):
            response = chat_with_agent("My washer is noisy. What should I do?")

        self.assertIsNone(response["created_case"])
        self.assertEqual(response["tool_events"][0]["name"], "open_repair_case")
        self.assertEqual(response["tool_events"][0]["status"], "error")
        self.assertIn("explicitly requests", response["tool_events"][0]["summary"])


if __name__ == "__main__":
    unittest.main()
