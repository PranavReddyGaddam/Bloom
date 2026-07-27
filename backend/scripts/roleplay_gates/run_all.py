#!/usr/bin/env python
"""Run every offline roleplay verification gate.

    python scripts/roleplay_gates/run_all.py

These cover the parts of ROADMAP_HONEN Phase 4's Gates A-D that can be checked
without a network, a database, or a microphone. They stub the LLM, the DB, and
Supabase auth, so they exercise real handler code against fake edges.

What they do NOT cover, and what still needs a human:
  * Gate A's grounding check — whether each criterion's `evidence` is genuinely
    in the source document. That is a judgment call over real material and the
    whole point of the feature; no assertion substitutes for reading it.
  * Gates E/F/G — audio ordering by ear, echo on laptop speakers, and live
    degradation against a real Deepgram key.
"""
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).parent

# Needs a live DATABASE_URL, so it is opt-in rather than part of the default
# run: `--live` after applying a migration.
LIVE_GATES = [
    ("B-live", "gate_b_live_db.py",
     "005 applied cleanly; existing tutor rows intact"),
]

GATES = [
    ("A", "gate_a_grading.py", "quote enforcement + python-computed score"),
    ("B", "gate_b_landmines.py", "zero question_attempts; tutor fields untouched"),
    ("C", "gate_c_honest_failure.py", "fail-silent grading, never fail-generous"),
    ("D", "gate_d_protocol.py", "WS auth handshake, close codes, frame order"),
    ("E", "gate_e_flux_protocol.py", "Flux client vs a mock Deepgram server"),
]


def main() -> int:
    gates = list(GATES)
    if "--live" in sys.argv:
        gates += LIVE_GATES

    failed = []
    for name, script, blurb in gates:
        print(f"\n{'=' * 70}\nGate {name}: {blurb}\n{'=' * 70}")
        result = subprocess.run([sys.executable, str(HERE / script)])
        if result.returncode != 0:
            failed.append(name)

    print(f"\n{'=' * 70}")
    if failed:
        print(f"FAILED: gate(s) {', '.join(failed)}")
        return 1
    label = "gates" if "--live" in sys.argv else "offline gates"
    print(f"All {len(gates)} {label} pass.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
