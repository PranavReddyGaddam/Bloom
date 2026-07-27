"""Gate E (offline portion): the Flux client against a mock Deepgram server.

Runs a local websockets server that speaks the Flux wire format, so the URL
construction, auth header, event normalization, turn-index offsetting across a
reconnect, and CloseStream-on-close can all be checked without a real key.

What still needs a real key and a human: whether Flux's endpointing feels right
(Gate E's eot_threshold tuning), echo on laptop speakers (Gate F), and the
$/session cost read.
"""
import asyncio
import json
import os
import sys
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
os.environ['DEEPGRAM_API_KEY'] = 'test-key'

import websockets

from app import stt_service

RECEIVED = {"headers": None, "query": None, "audio_chunks": 0, "close_stream": False}


async def handler(connection):
    RECEIVED["headers"] = dict(connection.request.headers)
    RECEIVED["query"] = parse_qs(urlparse(connection.request.path).query)

    await connection.send(json.dumps({"type": "Connected"}))

    async for message in connection:
        if isinstance(message, bytes):
            RECEIVED["audio_chunks"] += 1
            # After the first chunk, emit a full turn lifecycle.
            if RECEIVED["audio_chunks"] == 1:
                for event in (
                    {"type": "TurnInfo", "event": "StartOfTurn", "turn_index": 0},
                    {"type": "TurnInfo", "event": "Update", "turn_index": 0,
                     "transcript": "warfarin inhib"},
                    {"type": "TurnInfo", "event": "EndOfTurn", "turn_index": 0,
                     "transcript": "warfarin inhibits VKOR",
                     "end_of_turn_confidence": 0.93},
                ):
                    await connection.send(json.dumps(event))
        else:
            if json.loads(message).get("type") == "CloseStream":
                RECEIVED["close_stream"] = True
                return


async def main():
    async with websockets.serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        stt_service.LISTEN_URL = f"ws://127.0.0.1:{port}/v2/listen"

        flux = stt_service.FluxSession(
            keyterms=["warfarin", "VKOR", "warfarin"]  # duplicate on purpose
        )

        events = []

        async def collect():
            async for event in flux.events():
                events.append(event)

        collector = asyncio.create_task(collect())

        await flux.send_audio(b"\x00" * stt_service.CHUNK_BYTES)
        await asyncio.sleep(0.5)

        # --- auth + URL construction ---
        assert RECEIVED["headers"]["authorization"] == "Token test-key", \
            RECEIVED["headers"].get("authorization")
        print("PASS: Authorization uses 'Token', not 'Bearer'")

        q = RECEIVED["query"]
        assert q["model"] == ["flux-general-en"], q
        assert q["encoding"] == ["linear16"], q
        assert q["sample_rate"] == ["16000"], q
        assert q["eot_threshold"] == ["0.7"], q
        assert q["eot_timeout_ms"] == ["5000"], q
        print("PASS: model/encoding/sample_rate/eot params as documented")

        # eager_eot_threshold is deliberately absent — enabling it raises LLM
        # calls 50-70% from speculative drafting.
        assert "eager_eot_threshold" not in q, "eager EOT must stay off"
        print("PASS: eager_eot_threshold not enabled")

        # One keyterm per grounding concept, deduped.
        assert q["keyterm"] == ["warfarin", "VKOR"], q["keyterm"]
        print("PASS: keyterms passed one-per-param and deduped")

        # --- chunk size ---
        assert stt_service.CHUNK_BYTES == 2560, stt_service.CHUNK_BYTES
        print("PASS: 80ms chunk == 2560 bytes at 16kHz s16le")

        # --- event normalization ---
        kinds = [e["event"] for e in events]
        assert "Update" in kinds and "EndOfTurn" in kinds, kinds
        eot = next(e for e in events if e["event"] == "EndOfTurn")
        assert eot["transcript"] == "warfarin inhibits VKOR", eot
        assert eot["turn_index"] == 0
        assert eot["end_of_turn_confidence"] == 0.93
        # Connected is lifecycle noise and must not reach the caller.
        assert "Connected" not in kinds, kinds
        print("PASS: TurnInfo normalized; Connected filtered out")

        # --- turn ids stay monotonic across a reconnect ---
        # Simulate an idle reap, then send again: Flux restarts turn_index at
        # 0, but the caller must never see a repeated id.
        await flux._close_socket()
        RECEIVED["audio_chunks"] = 0
        await flux.send_audio(b"\x00" * stt_service.CHUNK_BYTES)
        await asyncio.sleep(0.5)

        after = [e for e in events if e["event"] == "EndOfTurn"]
        assert len(after) == 2, [e["event"] for e in events]
        assert after[1]["turn_index"] > after[0]["turn_index"], \
            f"turn ids repeated across reconnect: {after[0]['turn_index']} -> {after[1]['turn_index']}"
        print(f"PASS: turn_index monotonic across reconnect "
              f"({after[0]['turn_index']} -> {after[1]['turn_index']})")

        # --- close sends CloseStream ---
        await flux.close()
        await asyncio.sleep(0.3)
        assert RECEIVED["close_stream"], "close() must send CloseStream upstream"
        print("PASS: close() sends CloseStream so Flux flushes its final turn")

        collector.cancel()

    print("\nGate E (offline protocol portion) passes.")


asyncio.run(main())
