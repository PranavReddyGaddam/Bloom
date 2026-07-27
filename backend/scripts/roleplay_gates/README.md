# Roleplay verification gates

Checks for ROADMAP_HONEN Phase 4 (voice roleplay).

```bash
cd backend
venv/bin/python scripts/roleplay_gates/run_all.py          # offline only
venv/bin/python scripts/roleplay_gates/run_all.py --live   # + the live-DB gate
```

The default five stub the LLM, the database, and Supabase auth, so they
exercise real handler code against fake edges — no network, no DB, no
microphone, no Deepgram key. `--live` adds `gate_b_live_db.py`, which needs a
real `DATABASE_URL`.

Related tooling one directory up:

```bash
venv/bin/python scripts/check_schema.py                        # read-only: which migrations are applied
venv/bin/python scripts/apply_migration.py sql/cockroach/005_roleplay.sql
```

`check_schema.py` infers state from tables and columns, since this project has
no migrations table. `apply_migration.py` executes statement by statement so a
partial failure names the statement that failed.

| Gate | Checks |
|---|---|
| A `gate_a_grading.py` | A `met:true` with no `evidence_quote` is downgraded to `met:false`; the score is computed in Python (`round(met/total*100, 1)`); the rubric is server-owned so invented criterion ids are ignored; unparseable and failed grader calls return `None`; transcript budgeting keeps head + tail with an explicit `[…]` marker |
| B `gate_b_landmines.py` | `complete_roleplay_session` writes **zero** `question_attempts` rows — the fix for the confirmed `KeyError`, since the tutor's `executemany` subscripts `e["question_text"]` etc. on every history entry; `_TUTOR_STATE_FIELDS` is byte-for-byte unchanged; `concepts`/`checkpoint_shown` are shared by name across both tuples |
| C `gate_c_honest_failure.py` | Fewer than 2 student turns → ungraded with an honest message and the transcript intact; a `None` grade → empty criteria and a null score, never all-met; `_prune_sessions` never evicts a session holding a live socket; `public_scenario` strips `evidence` while keeping criterion names |
| D `gate_d_protocol.py` | Garbage token, non-auth first frame, and auth timeout all close **4401**; a foreign session closes **4404** (indistinguishable from missing); the `ready` frame carries criterion names but no `evidence`; frame order is `thinking` → `reply_text` → `audio_end`; `audio_end` is still sent when TTS is degraded; an empty utterance never advances a turn |
| E `gate_e_flux_protocol.py` | The Flux client against a mock Deepgram server: `Authorization: Token` (not Bearer), `model`/`encoding`/`sample_rate`/`eot_*` query params, `eager_eot_threshold` absent, one deduped `keyterm` param per grounding concept, 2560-byte chunks, `TurnInfo` normalized with lifecycle events filtered out, `turn_index` monotonic across a reconnect, and `CloseStream` sent on close |
| B-live `gate_b_live_db.py` (`--live`) | Against the real database, after applying `005`: the four columns have the right types and nullability; no pre-existing tutor row gained roleplay state or a NULL in a NOT NULL column; a real tutor row still SELECTs on `_TUTOR_STATE_FIELDS`; and a roleplay session round-trips create → get → save → complete → result, writing **zero** `question_attempts` rows and a `quiz_attempts` row with `difficulty='roleplay'`. Creates one probe session and deletes it in a `finally`. |

## What these do NOT cover

These gates prove the plumbing. They cannot prove the feature works, because
the feature is a judgment about grounding:

- **Gate A's real half.** Start a scene against a real document and grep each
  criterion's `evidence` against the source **by hand** — is that fact actually
  in the document? If not, nothing downstream matters. This is the risk-#3 gate
  and no assertion substitutes for reading it.
- **Gate E's tuning half.** Whether Flux's endpointing feels right in practice.
  Pause mid-sentence for ~2s; if it ends your turn, raise
  `DEEPGRAM_EOT_THRESHOLD` toward 0.8.
- **Gate F — echo.** On laptop speakers, not headphones. If a `transcript`
  appears containing the character's *own* words, mic gating is broken. Flux
  makes this worse than Whisper did: it will confidently emit an `EndOfTurn`
  for the character's audio and trigger a real LLM turn.
- **Gate G — degradation.** Deny the mic, kill the network mid-scene, force a
  402, and sit silent for 3 minutes. Each should degrade to a working scene,
  and `notice{degraded:true}` must arrive **exactly once** per session.
- **Cost.** Run one 10-turn scene and read the Deepgram console; note
  $/session for STT and TTS separately.
