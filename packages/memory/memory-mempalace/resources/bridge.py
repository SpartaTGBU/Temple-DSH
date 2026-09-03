#!/usr/bin/env python3
"""Private persistent JSONL bridge from DSH to MemPalace direct APIs."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import sys
from datetime import datetime, timezone
from typing import Any

MAX_FRAME_BYTES = 1_048_576
PROTOCOL_OUT = sys.stdout


def bounded_int(payload: dict[str, Any], name: str, minimum: int, maximum: int) -> int:
    value = payload.get(name)
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{name} must be an integer from {minimum} to {maximum}")
    return value


def bounded_text(value: Any, name: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string")
    text = value.strip()
    if not text or len(text.encode("utf-8")) > 128:
        raise ValueError(f"{name} must contain 1 to 128 UTF-8 bytes")
    return text


def field(value: Any, name: str) -> Any:
    if isinstance(value, dict):
        return value.get(name)
    return getattr(value, name, None)


def stable_id(kind: str, *parts: str) -> str:
    digest = hashlib.sha256("\0".join(parts).encode("utf-8")).hexdigest()
    return f"{kind}:{digest}"


def encoded_size(value: Any) -> int:
    return len(json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


def build_bounded_graph(
    rooms: dict[str, dict[str, Any]],
    start_room: str | None,
    max_nodes: int,
    max_edges: int,
    max_hops: int,
    max_bytes: int,
    scanned: int,
    already_truncated: bool,
) -> dict[str, Any]:
    """Construct deterministic renderer data and trim it to all caller limits."""
    wing_rooms: dict[str, set[str]] = {}
    for room, data in rooms.items():
        for wing in data["wings"]:
            wing_rooms.setdefault(wing, set()).add(room)

    candidates: list[dict[str, Any]] = []
    for room in sorted(rooms):
        connected = any(len(wing_rooms[wing]) > 1 for wing in rooms[room]["wings"])
        candidates.append({
            "id": stable_id("room", room), "kind": "room", "label": room,
            "count": rooms[room]["count"], "isolated": not connected,
        })
    for wing in sorted(wing_rooms):
        tunnelled = any(len(rooms[room]["wings"]) > 1 for room in wing_rooms[wing])
        candidates.append({
            "id": stable_id("wing", wing), "kind": "wing", "label": wing,
            "count": sum(rooms[room]["count"] for room in wing_rooms[wing]),
            "isolated": not tunnelled,
        })
    candidates.sort(key=lambda node: (0 if node["kind"] == "room" and node["label"] == start_room else 1, node["id"]))
    selected = candidates[:max_nodes]
    truncated = already_truncated or len(candidates) > len(selected)
    selected_ids = {node["id"] for node in selected}

    edges: list[dict[str, Any]] = []
    edge_limit_reached = False
    for room in sorted(rooms):
        room_id = stable_id("room", room)
        for wing in sorted(rooms[room]["wings"]):
            wing_id = stable_id("wing", wing)
            if room_id in selected_ids and wing_id in selected_ids:
                if len(edges) >= max_edges:
                    edge_limit_reached = True
                    truncated = True
                    break
                edges.append({
                    "id": stable_id("placement", room, wing), "source": wing_id,
                    "target": room_id, "kind": "placement", "count": rooms[room]["count"],
                })
        if edge_limit_reached:
            break
        # Only selected wings can produce an edge. Filtering before pairing
        # prevents one hostile high-degree room from causing quadratic work.
        wings = sorted(
            wing for wing in rooms[room]["wings"]
            if stable_id("wing", wing) in selected_ids
        )
        for index, wing_a in enumerate(wings):
            for wing_b in wings[index + 1:]:
                source, target = stable_id("wing", wing_a), stable_id("wing", wing_b)
                if source in selected_ids and target in selected_ids:
                    if len(edges) >= max_edges:
                        edge_limit_reached = True
                        truncated = True
                        break
                    edges.append({
                        "id": stable_id("tunnel", room, wing_a, wing_b), "source": source,
                        "target": target, "kind": "tunnel", "count": rooms[room]["count"],
                    })
            if edge_limit_reached:
                break
        if edge_limit_reached:
            break

    visits: list[dict[str, Any]] = []
    if start_room is not None and stable_id("room", start_room) in selected_ids:
        visited = {start_room}
        frontier: list[tuple[str, int]] = [(start_room, 0)]
        frontier_offset = 0
        expanded_wings: set[str] = set()
        visits.append({"nodeId": stable_id("room", start_room), "hop": 0, "via": []})
        while frontier_offset < len(frontier):
            current, depth = frontier[frontier_offset]
            frontier_offset += 1
            if depth >= max_hops:
                continue
            for wing in sorted(rooms[current]["wings"]):
                if wing in expanded_wings:
                    continue
                expanded_wings.add(wing)
                for room in sorted(wing_rooms[wing]):
                    if room in visited or stable_id("room", room) not in selected_ids:
                        continue
                    visited.add(room)
                    frontier.append((room, depth + 1))
                    visits.append({
                        "nodeId": stable_id("room", room), "hop": depth + 1,
                        "parentNodeId": stable_id("room", current), "via": [wing],
                    })
                    if len(edges) < max_edges:
                        edges.append({
                            "id": stable_id("path", current, room), "source": stable_id("room", current),
                            "target": stable_id("room", room), "kind": "path", "count": 1,
                        })
                    else:
                        truncated = True
    edges.sort(key=lambda edge: edge["id"])
    visits.sort(key=lambda visit: (visit["hop"], visit["nodeId"]))


    def result(nodes: list[dict[str, Any]], kept_edges: list[dict[str, Any]], kept_visits: list[dict[str, Any]], cut: bool) -> dict[str, Any]:
        return {
            "format": "dsh.memory.graph.v1", "nodes": sorted(nodes, key=lambda node: node["id"]),
            "edges": kept_edges, "visits": kept_visits, "truncated": cut,
            "stats": {
                "scannedRecords": scanned, "nodeCount": len(nodes), "edgeCount": len(kept_edges),
                "maxHop": max((visit["hop"] for visit in kept_visits), default=0),
            },
        }

    # Keep the largest deterministic node prefix whose empty graph fits.
    low, high = 0, len(selected)
    while low < high:
        middle = (low + high + 1) // 2
        if encoded_size(result(selected[:middle], [], [], True)) <= max_bytes:
            low = middle
        else:
            high = middle - 1
    if low < len(selected):
        selected = selected[:low]
        selected_ids = {node["id"] for node in selected}
        edges = [edge for edge in edges if edge["source"] in selected_ids and edge["target"] in selected_ids]
        visits = [visit for visit in visits if visit["nodeId"] in selected_ids and visit.get("parentNodeId") in (None, *selected_ids)]
        truncated = True

    low, high = 0, len(edges)
    while low < high:
        middle = (low + high + 1) // 2
        if encoded_size(result(selected, edges[:middle], [], True)) <= max_bytes:
            low = middle
        else:
            high = middle - 1
    if low < len(edges):
        edges = edges[:low]
        truncated = True

    low, high = 0, len(visits)
    while low < high:
        middle = (low + high + 1) // 2
        if encoded_size(result(selected, edges, visits[:middle], True)) <= max_bytes:
            low = middle
        else:
            high = middle - 1
    if low < len(visits):
        visits = visits[:low]
        truncated = True
    final = result(selected, edges, visits, truncated)
    if encoded_size(final) > max_bytes:
        raise ValueError("maxBytes is too small for the graph envelope")
    return final


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--palace")
    parser.add_argument("--collection")
    parser.add_argument("--backend")
    parser.add_argument("--wing", default="wing_general")
    parser.add_argument("--max-frame-bytes", type=int, default=MAX_FRAME_BYTES)
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

    def graph(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Read a bounded graph directly from the already-open collection."""
        self.open()
        max_nodes = bounded_int(payload, "maxNodes", 1, 5_000)
        max_edges = bounded_int(payload, "maxEdges", 1, 20_000)
        max_hops = bounded_int(payload, "maxHops", 0, 16)
        max_bytes = bounded_int(
            payload, "maxBytes", 1_024, max(1_024, self.args.max_frame_bytes - 1_024)
        )
        max_scan = bounded_int(payload, "maxScanRecords", 1, 100_000)
        start_room = payload.get("startRoom")
        if start_room is not None:
            start_room = bounded_text(start_room, "startRoom")

        rooms: dict[str, dict[str, Any]] = {}
        scanned = 0
        offset = 0
        truncated = False
        while scanned < max_scan:
            limit = min(500, max_scan - scanned)
            batch = self.collection.get(limit=limit, offset=offset, include=["metadatas"])
            metadatas = field(batch, "metadatas") or []
            ids = field(batch, "ids") or []
            if not isinstance(ids, list) or not isinstance(metadatas, list):
                raise ValueError("collection page must contain id and metadata lists")
            if not ids:
                break
            inspected = min(len(ids), limit)
            if len(ids) > limit:
                truncated = True
            for index in range(inspected):
                scanned += 1
                metadata = metadatas[index] if index < len(metadatas) else None
                if not isinstance(metadata, dict):
                    truncated = True
                    continue
                try:
                    room = bounded_text(metadata.get("room"), "room")
                    wing = bounded_text(metadata.get("wing"), "wing")
                except ValueError:
                    truncated = True
                    continue
                node = rooms.setdefault(room, {"wings": set(), "count": 0})
                node["wings"].add(wing)
                node["count"] += 1
            offset += inspected
            if len(ids) < limit:
                break
        if scanned >= max_scan and len(ids) >= limit:
            truncated = True

        if start_room is not None and start_room not in rooms:
            raise ValueError("startRoom was not found in the bounded palace scan")
        graph = build_bounded_graph(
            rooms, start_room, max_nodes, max_edges, max_hops, max_bytes - 64, scanned, truncated
        )
        return graph

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
        if method == "graph":
            return self.graph(payload), False
        if method == "flush":
            return {"flushed": True}, False
        if method == "shutdown":
            self.close()
            return {"stopped": True}, True
        raise ValueError(f"unknown method: {method}")


def emit(response: dict[str, Any], max_frame_bytes: int) -> None:
    encoded = json.dumps(response, separators=(",", ":"), ensure_ascii=False).encode("utf-8") + b"\n"
    if len(encoded) > max_frame_bytes:
        request_id = response.get("id", -1)
        encoded = json.dumps(
            {"id": request_id, "ok": False, "error": "response frame too large"},
            separators=(",", ":"),
        ).encode("utf-8") + b"\n"
    PROTOCOL_OUT.buffer.write(encoded)
    PROTOCOL_OUT.flush()


def input_frames(max_frame_bytes: int):
    """Yield complete frames without retaining an oversized input line."""
    while True:
        raw = sys.stdin.buffer.readline(max_frame_bytes + 1)
        if not raw:
            return
        if len(raw) <= max_frame_bytes and raw.endswith(b"\n"):
            yield raw
            continue
        while raw and not raw.endswith(b"\n"):
            raw = sys.stdin.buffer.readline(max_frame_bytes + 1)
        yield None


def main() -> int:
    bridge = Bridge(parse_args())
    try:
        for raw in input_frames(bridge.args.max_frame_bytes):
            if raw is None:
                emit({"id": -1, "ok": False, "error": "request frame too large"}, bridge.args.max_frame_bytes)
                continue
            request: Any = None
            try:
                request = json.loads(raw)
                if not isinstance(request, dict):
                    raise ValueError("request must be an object")
                request_id = request.get("id")
                if isinstance(request_id, bool) or not isinstance(request_id, int):
                    raise ValueError("request id must be an integer")
                method = request.get("method")
                if not isinstance(method, str):
                    raise ValueError("method must be a string")
                payload = request.get("payload")
                if not isinstance(payload, dict):
                    payload = {}
                result, stop = bridge.dispatch(method, payload)
                emit({"id": request_id, "ok": True, "result": result}, bridge.args.max_frame_bytes)
                if stop:
                    return 0
            except Exception as exc:
                request_id = request.get("id", -1) if isinstance(request, dict) else -1
                emit(
                    {"id": request_id, "ok": False, "error": f"request failed ({type(exc).__name__})"},
                    bridge.args.max_frame_bytes,
                )
    finally:
        bridge.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
