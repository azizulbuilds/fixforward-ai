"""Smoke-test the live FixForward API and confirm GPT-OSS actually calls a tool.

Run from the backend directory after starting `python server.py` and configuring
BEDROCK_MODEL_ID + a Bedrock API key in backend/.env.
"""
from __future__ import annotations

import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE_URL = os.getenv("FIXFORWARD_API_URL", "http://127.0.0.1:8000").rstrip("/")


def request_json(path: str, *, payload: dict | None = None, timeout: int = 60) -> dict:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        f"{BASE_URL}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST" if data is not None else "GET",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from {path}: {body[:500]}") from exc
    except URLError as exc:
        raise RuntimeError(
            f"Cannot reach {BASE_URL}. Start the backend with `python server.py` first. Details: {exc.reason}"
        ) from exc


def main() -> int:
    print(f"FixForward GPT-OSS smoke test → {BASE_URL}")
    try:
        health = request_json("/health", timeout=10)
        agent = health.get("agent") or {}
        print(f"Backend status: {health.get('status', 'unknown')}")
        print(f"Configured provider: {agent.get('provider', 'unknown')}")
        print(f"Configured model: {agent.get('model_id') or 'not set'}")
        if not agent.get("bedrock_configured"):
            print("FAIL: Backend reports local mode, so this request cannot verify live GPT-OSS.")
            print(f"Reason: {agent.get('note', 'Check backend/.env and restart the backend.')}")
            return 2

        result = request_json(
            "/api/assistant/chat",
            payload={
                "message": "My WhirlNest WashPro 8kg washing machine vibrates heavily during spin. Use the troubleshooting guide and tell me safe first checks.",
                "appliance_id": "APL-1001",
                "case_id": None,
                "history": [],
            },
            timeout=90,
        )
        print(f"Actual response mode: {result.get('mode', 'unknown')}")
        print(f"Assistant stamp: {result.get('stamp', 'unknown')}")
        for event in result.get("tool_events", []):
            print(f"Tool: {event.get('name')} | {event.get('status')} | {event.get('summary')}")
        print("\nAssistant response:\n" + str(result.get("reply", "(empty response)")))

        tool_events = result.get("tool_events") or []
        used_guide = any(
            event.get("name") == "find_troubleshooting_steps" and event.get("status") == "success"
            for event in tool_events
        )
        if result.get("mode") != "bedrock_tool_use":
            print("\nFAIL: The response used a fallback rather than the configured Bedrock tool-use path.")
            print(f"Fallback detail: {result.get('provider_notice') or 'See backend logs.'}")
            return 3
        if not used_guide:
            print("\nFAIL: GPT-OSS responded without a successful find_troubleshooting_steps tool event.")
            print("Try again, inspect the response and backend logs, and confirm tool-calling/model access.")
            return 4

        print("\nPASS: the live Bedrock path ran and the troubleshooting tool completed successfully.")
        return 0
    except RuntimeError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
