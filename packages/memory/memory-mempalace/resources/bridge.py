#!/usr/bin/env python3
"""Private persistent JSONL bridge from DSH to MemPalace direct APIs."""
from __future__ import annotations

import argparse
import contextlib
import json
import sys
from datetime import datetime, timezone
from typing import Any

MAX_FRAME_BYTES = 1_048_576
PROTOCOL_OUT = sys.stdout


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--palace")
    parser.add_argument("--collection")
    parser.add_argument("--backend")
    parser.add_argument("--wing", default="wing_general")
    return parser.parse_args()


class Bridge:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.backend = None
        self.collection = None
        self.palace_path = ""
        self.collection_name = ""

    def open(self) -> None:
        if self.collection is not None:
            return
        with contextlib.redirect_stdout(sys.stderr):
            from mempalace.backends.registry import get_backend, resolve_backend_for_palace
            from mempalace.config import MempalaceConfig

            config = MempalaceConfig(palace_path=self.args.palace)
            self.palace_path = str(config.palace_path)
            self.collection_name = self.args.collection or config.collection_name
            backend_name = resolve_backend_for_palace(
                explicit=self.args.backend,
                config_value=config.backend,
                env_value=None,
                palace_path=self.palace_path,
            )
            if self.args.backend:
                import os
                os.environ["MEMPALACE_BACKEND"] = self.args.backend
            self.backend = get_backend(backend_name)
            self.collection = self.backend.get_or_create_collection(
                self.palace_path, self.collection_name
            )

    def configuration(self) -> dict[str, Any]:
        """Resolve the same configuration as open() without opening or creating storage."""
        with contextlib.redirect_stdout(sys.stderr):
            from mempalace.backends.registry import resolve_backend_for_palace
            from mempalace.config import MempalaceConfig

            config = MempalaceConfig(palace_path=self.args.palace)
            palace_path = str(config.palace_path)
            backend_name = resolve_backend_for_palace(
                explicit=self.args.backend,
                config_value=config.backend,
                env_value=None,
                palace_path=palace_path,
            )
        return {
            "kind": "mempalace",
            "palacePath": palace_path,
            "collectionName": self.args.collection or config.collection_name,
            "storageBackend": backend_name,
            "wing": self.args.wing,
        }

    def status(self) -> dict[str, Any]:
        self.open()
        return {
            "state": "ready",
            "palacePath": self.palace_path,
            "collectionName": self.collection_name,
            "backend": type(self.backend).__name__,
        }

    def recall(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.open()
        query = str(payload.get("query") or "").strip()
        limit = max(1, min(int(payload.get("limit") or 3), 20))
        if not query:
            return {"items": [], "truncated": False}
        with contextlib.redirect_stdout(sys.stderr):
            from mempalace.searcher import search_memories

            result = search_memories(
                query,
                palace_path=self.palace_path,
                n_results=limit,
                collection_name=self.collection_name,
            )
        raw_items = result.get("results", []) if isinstance(result, dict) else []
        items: list[dict[str, Any]] = []
        for raw in raw_items:
            if not isinstance(raw, dict):
                continue
            text = str(raw.get("text") or raw.get("document") or "").strip()
            if not text:
                continue
            item: dict[str, Any] = {"text": text}
            metadata = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else raw
            for source, target in (
                ("drawer_id", "drawerId"),
                ("wing", "wing"),
                ("room", "room"),
                ("source_file", "sourceFile"),
                ("distance", "distance"),
            ):
                value = metadata.get(source)
                if isinstance(value, (str, int, float)):
                    item[target] = value
            items.append(item)
        return {"items": items, "truncated": len(raw_items) > len(items)}

    def capture(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.open()
        user_text = str(payload.get("userText") or "").strip()
        assistant_text = str(payload.get("assistantText") or "").strip()
        if not user_text and not assistant_text:
            return {"captured": False}
        text = f"User: {user_text}\n\nAssistant: {assistant_text}".strip()
        session_id = str(payload.get("sessionId") or "unknown")
        turn = int(payload.get("turn") or 0)
        completed_at = payload.get("completedAt")
        authored_at = (
            datetime.fromtimestamp(completed_at / 1000, tz=timezone.utc).isoformat()
            if isinstance(completed_at, (int, float))
            else None
        )
        extra = {"source": "temple-dsh", "session_id": session_id, "turn": turn}
        if authored_at is not None:
            extra["completed_at"] = authored_at
        cwd = payload.get("cwd")
        if isinstance(cwd, str) and cwd:
            extra["cwd"] = cwd
        with contextlib.redirect_stdout(sys.stderr):
            from mempalace.convo_miner import file_conversation_exchange

            drawer_id = file_conversation_exchange(
                self.collection,
                wing=self.args.wing,
                room="conversations",
                text=text,
                source_file=f"dsh-session:{session_id}",
                agent="temple-dsh",
                authored_at=authored_at,
                extra_metadata=extra,
            )
        return {"captured": drawer_id is not None, "drawerId": drawer_id}

    def close(self) -> None:
        if self.backend is not None and self.palace_path:
            with contextlib.suppress(Exception), contextlib.redirect_stdout(sys.stderr):
                close = getattr(self.backend, "close_palace", None)
                if callable(close):
                    close(self.palace_path)
        self.collection = None
        self.backend = None

    def dispatch(self, method: str, payload: dict[str, Any]) -> tuple[Any, bool]:
        if method == "configuration":
            return self.configuration(), False
        if method == "status":
            return self.status(), False
        if method == "recall":
            return self.recall(payload), False
        if method == "capture":
            return self.capture(payload), False
        if method == "flush":
            return {"flushed": True}, False
        if method == "shutdown":
            self.close()
            return {"stopped": True}, True
        raise ValueError(f"unknown method: {method}")


def emit(response: dict[str, Any]) -> None:
    PROTOCOL_OUT.write(json.dumps(response, separators=(",", ":"), ensure_ascii=False) + "\n")
    PROTOCOL_OUT.flush()


def main() -> int:
    bridge = Bridge(parse_args())
    try:
        for raw in sys.stdin.buffer:
            if len(raw) > MAX_FRAME_BYTES:
                emit({"id": -1, "ok": False, "error": "request frame too large"})
                continue
            request: Any = None
            try:
                request = json.loads(raw)
                if not isinstance(request, dict):
                    raise ValueError("request must be an object")
                request_id = request.get("id")
                if not isinstance(request_id, int):
                    raise ValueError("request id must be an integer")
                method = request.get("method")
                if not isinstance(method, str):
                    raise ValueError("method must be a string")
                payload = request.get("payload")
                if not isinstance(payload, dict):
                    payload = {}
                result, stop = bridge.dispatch(method, payload)
                emit({"id": request_id, "ok": True, "result": result})
                if stop:
                    return 0
            except Exception as exc:
                request_id = request.get("id", -1) if isinstance(request, dict) else -1
                emit({"id": request_id, "ok": False, "error": f"request failed ({type(exc).__name__})"})
    finally:
        bridge.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
