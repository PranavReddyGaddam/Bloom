# Bloom: Supabase → CockroachDB data-layer migration

> **Status: complete.** Executed 2026-07-25 against a CockroachDB Basic cluster running
> **v26.2.1**. `db.py` and `memory_service.py` hold zero Supabase calls; Supabase remains only as
> the identity provider.
>
> This document is kept as the design record for the port — the rationale behind the driver and
> schema choices, the three plan claims that a real cluster disproved, and the pre-existing bugs
> the migration surfaced. It is history plus rationale, not a set of instructions to follow.
> Line references were accurate against the pre-migration tree on 2026-07-25 and are not
> maintained; treat them as provenance, not navigation.

## Context

Bloom stores everything in Supabase Postgres today, reached through `supabase-py`. The
CockroachDB × AWS hackathon (deadline **Aug 18 2026**, `HACKATHON.md`) requires CockroachDB as
the app's persistent memory layer, so the data layer has to move.

**Why now rather than after the remaining roadmap** (Phases 2-4 in `ROADMAP_HONEN_FEATURES.md`:
link/video ingestion, podcast, voice roleplay): Phases 3 and 4 add new tables and roughly eight
new `db.py` functions — written against `supabase-py`, then rewritten against SQL. Migrating
first means writing them once. Verifying a port against features you already know work is also
far easier than debugging it underneath a WebSocket audio pipeline. Decision confirmed with the
user.

**Two decisions already settled — do not revisit:**

| Decision | Choice | Consequence |
|---|---|---|
| Embedding model | **Keep fastembed `BAAI/bge-small-en-v1.5`, 384-dim** | Schema ports unchanged; no re-embedding; no cost. Bedrock still handles LLM work (summaries/quiz/tutor) under HACKATHON B5 — that is where "Bedrock understands documents better" is satisfied, not in the embedding vectors. |
| Auth | **Supabase Auth stays permanently** | `auth.py` (38 lines) is untouched by this migration. HACKATHON **B4 (Cognito) is dropped**. The AWS requirement is met by S3 / App Runner / Bedrock. |

Intended outcome: the FastAPI backend reads and writes **only** CockroachDB for all application
data, with Supabase remaining solely as an identity provider.

## What makes this tractable

Verified by inspection, not assumption:

- **Supabase's runtime surface is exactly two things:** Postgres via `supabase-py`, and Supabase
  Auth. **No Supabase Storage** — uploads go to a temp file (`main.py:84-86`) deleted in a
  `finally` (`main.py:127`). There are no blobs to move.
- **Only two files import supabase:** `db.py:5` and `auth.py:4`. Every agent module
  (`tutor_agent`, `pretest_agent`, `extraction_agent`, …) reaches the database only through
  `db.*` / `memory_service.*` function calls. The module boundary already holds.
- **No hard patterns to port.** Across all 59 `.table()` calls there are **zero** `.upsert()`,
  zero `on_conflict`, zero `.or_()`, zero `.range()`. Verb split: 38 select / 11 insert /
  7 update / 3 delete.
- **RLS is already bypassed.** The backend uses the service-role key; every migration file says
  so explicitly (e.g. `migrate_memory_layer.sql:65-67`). Authorization lives in Python as
  `.eq("user_id", …)` predicates. Dropping RLS loses nothing.

## CockroachDB facts (checked against the docs, 2026-07-25)

Also recorded in `HACKATHON.md`'s migration reference section. **Re-verify against the version
your cluster actually runs** — the vector index is new enough that details move between
releases; `stable` resolved to v26.2 when checked.

- `VECTOR` type is **pgvector-compatible**; `<=>` cosine operator works unchanged.
- Cosine queries **are** index-accelerated via `vector_cosine_ops` (all three opclasses
  accelerate their operator).
- No `CREATE EXTENSION vector` needed. `feature.vector_index.enabled` was **already `true`** on
  a fresh Basic cluster (v26.2.1, checked 2026-07-25), and `SET CLUSTER SETTING` on it is
  permitted but a no-op — B1's "enable the setting" step is not needed.
- **CockroachDB Basic supports vector indexes.** `VECTOR(384)` columns and
  `CREATE VECTOR INDEX` both work on the free tier; no Standard/Advanced plan required. The
  dimension **is** enforced (a 3-dim insert into a `VECTOR(384)` column is rejected with
  `DataException`) even though `information_schema.columns` reports the type as bare `vector`.
- Index is **k-means partitioned (C-SPANN), not HNSW** — different implementation, same
  interface. It is **approximate**, unlike the exhaustive scan we have today.
- `language sql` and PL/pgSQL UDFs with `RETURNS TABLE` are supported — our match functions port
  as functions.
- "Index acceleration with filters is only supported if the filters match prefix columns."
- **"Large batch inserts of `VECTOR` types can cause performance degradation."**
- `IMPORT INTO` unsupported on tables with vector indexes.

## Driver: psycopg 3, **sync**, with a connection pool

Add `psycopg[binary,pool]` and `pgvector`. Reject asyncpg, SQLAlchemy, and
`langchain-cockroachdb`.

- **The codebase is sync.** All 59 call sites are sync functions; callers already wrap blocking
  work in `asyncio.to_thread` (`memory_service.py:203`). Going async means rewriting every
  `db.*` signature *and* every caller in `tutor_agent.py` (1200+ lines) — a whole-app refactor,
  not a port. Sync keeps the diff inside two files.
- **`dict_row` preserves the return contract.** `row_factory=psycopg.rows.dict_row` makes every
  query return `list[dict]` with string keys — exactly what `.execute().data` returned. This is
  the single choice that makes the rest mechanical: consumers like `row["front"]` and
  `row.get("category")` keep working untouched.
- **JSONB round-trips correctly.** psycopg3 adapts `dict`/`list` ↔ `jsonb` automatically.
  `asyncpg` does **not** — it returns jsonb as `str` and needs a manual codec per connection,
  which would silently break tutor-session rehydration at `db.py:599`. With no test suite, that
  class of bug is exactly what to design against.
- **`pgvector.psycopg.register_vector()` covers only the read direction on CockroachDB.**
  ~~handles `list[float]` ↔ `VECTOR` both ways~~ — **wrong, verified 2026-07-25.** It succeeds
  without raising, and reads work (a `VECTOR` column returns a numpy `ndarray`), but the *input*
  adapter never binds: CockroachDB reports its vector type at **OID 90006**, not the OID pgvector
  discovers from `CREATE EXTENSION vector`. A plain `list[float]` is therefore adapted as a
  Postgres array and renders `{0.1,0.2}` where the server demands `[0.1,0.2]`, failing with
  `InvalidTextRepresentation: malformed vector literal`. Use `database.to_vector()` on **every**
  embedding write.
- **Reads return `ndarray`, not `list[float]`** — a return-contract change with the same shape as
  the `datetime` problem below. `if embedding:` raises `ValueError` on an ndarray and
  `json.dumps()` refuses it, so call `database.from_vector()` on any embedding leaving the data
  layer.
- SQLAlchemy would mean either an ORM rewrite or `text()` everywhere (a pool with ceremony);
  `langchain-cockroachdb` imposes its own schema and Bloom uses no LangChain.

> This contradicts `HACKATHON.md` B3 ("SQLAlchemy async / asyncpg"), written before the sync
> structure was understood. **Update that line as part of this work.**

## Implementation

### 1. `backend/app/database.py` — **done** (2026-07-25), infrastructure only

Keeps `db.py`'s diff 100% query translation. Contains: a lazy module-global `ConnectionPool`
from `DATABASE_URL` (mirroring `_get_client()`'s existing lazy-singleton shape at `db.py:14-22`);
a `cursor()` contextmanager yielding a `dict_row` cursor; a `transaction()` contextmanager for
compound writes; `register_vector` in the pool's `configure=` hook (read path only — see below);
`to_vector()` / `from_vector()` for the write and read directions of embeddings; and a
`@retry_on_serialization_failure` decorator catching `psycopg.errors.SerializationFailure`
(40001) with exponential backoff + jitter.

Most `db.py` functions are single statements and need no explicit transaction. Apply the retry
decorator to the compound ones: `record_quiz_attempt`, `complete_tutor_session`,
`save_flashcards`, `_store_document`.

**Verified against the live cluster** (18 checks, all passing): `dict_row` returns string-keyed
dicts; `VECTOR(384)` round-trips and enforces its dimension; `match_document_chunks` returns
similarity 1.0 for an identical vector with the same keys as the Supabase RPC; **jsonb
round-trips as `dict`/`list` with `NULL` → `None`** (risk #1, now closed); `transaction()`
commits on clean exit and rolls back on exception.

**Embeddings must go through the helpers:**

```python
cur.execute("... VALUES (%s)", (to_vector(embedding),))   # write
embedding = from_vector(row["embedding"])                 # read, if it leaves the layer
```

### 2. `backend/app/db.py` — the bulk of the work

Three rules cover all 59 sites. Reference case, `get_or_create_user` (`db.py:25-36`):

```python
# before
existing = client.table("users").select("id").eq("external_id", external_id).execute()
if existing.data:
    return existing.data[0]["id"]
created = client.table("users").insert({"external_id": external_id}).execute()
return created.data[0]["id"]

# after
with cursor() as cur:
    cur.execute("SELECT id FROM users WHERE external_id = %s", (external_id,))
    row = cur.fetchone()
    if row:
        return row["id"]
    cur.execute(
        "INSERT INTO users (external_id) VALUES (%s) ON CONFLICT (external_id) DO NOTHING RETURNING id",
        (external_id,),
    )
    ...
```

- `.eq/.lte/.gte/.ilike/.in_/.not_.is_` → `WHERE` clauses with **`%s` placeholders only** — never
  f-strings. `.ilike("name", name)` → `WHERE name ILIKE %s`.
- `.insert({...}).execute().data[0]["id"]` → `INSERT … RETURNING id` + `cur.fetchone()`. Most
  repeated pattern in the file.
- Returns stay `list[dict]` / `dict` / `None`; callers never change.

Add small `_fetch` / `_fetch_one` / `_execute` helpers so functions stay one statement long.

**The read-then-write races** (`get_or_create_user:31-36`, `create_subject:48-59`) are
non-atomic today. Converting them to `INSERT … ON CONFLICT DO NOTHING RETURNING` is a free
correctness win — take it, but keep it in its own commit so it isn't confused with a port bug.

**The four non-trivial patterns:**

| Site | Pattern | Port |
|---|---|---|
| `db.py:737` | embedded `flashcard_sets(subject)` + `count="exact"` | `JOIN flashcard_sets` + `count(*) OVER ()` for the pre-LIMIT total. Flatten `(row.get("flashcard_sets") or {}).get("subject")` → `row["subject"]`. |
| `db.py:943` | embedded `documents(filename)` + `count="exact"` + `.not_.is_(…, "null")` | `JOIN documents` (inner join enforces the NOT NULL intent — matches the docstring: concepts whose source doc was deleted are skipped) + `d.filename AS document_filename`. |
| `db.py:309`, `db.py:388` | `.in_("quiz_attempt_id", attempt_ids)` | `= ANY(%s)` with the list as **one** array parameter — avoids an unbounded IN-list, a genuine Cockroach anti-pattern. |
| `db.py:576` | dynamic select from `_TUTOR_STATE_FIELDS` | f-string building the column list. The **only** acceptable non-parameterized interpolation here, because the tuple is a module-level constant of literals — comment saying so. Same tuple drives `INSERT` (`:559`) and `UPDATE` (`:607`, `:620`). |

**Timestamps AND uuids — confirmed biting, worse than first described.** psycopg returns
`datetime` for timestamptz *and* `uuid.UUID` for uuid columns, where supabase-py returned strings
for both. Two distinct failures:

1. `db.py:958` does `datetime.fromisoformat(last_seen.replace("Z", "+00:00"))` and **will crash**
   on a `datetime`. Grep `fromisoformat`, `.replace("Z"`, `.isoformat()` and audit each.
2. **The response models reject both types.** `Subject` declares `id: str` / `created_at: str`
   (`models.py:97-100`) and `main.py:494` does `Subject(**subject)`. Pydantic v2 is strict, so a
   `UUID` or `datetime` raises `ValidationError` → **500 on `GET /subjects`**. Verified 2026-07-25.
   This is broader than a single crash site: it hits *any* endpoint whose model declares `str`.

**Every ported function that returns rows must pass them through `db._row()` / `db._rows()`**,
which convert `UUID` → `str` and `datetime` → ISO-8601 with a `Z` suffix (matching Supabase's
rendering exactly, so frontend date parsing is unaffected). Fixing it in the data layer rather
than loosening the models keeps the port a pure data-layer change.

> **Testing note.** Behavioral tests on `db.*` return values do **not** catch this — they pass
> while the app 500s, because they never construct a response model. Assert
> `SomeModel(**row)` explicitly for each ported slice.

### 3. `backend/app/memory_service.py`

- Three `.rpc(…)` → `SELECT * FROM fn(%s, %s, %s, %s)`. Note there are **three**, not two:
  `match_document_chunks` (`memory_service.py:92`), `match_weak_concepts`
  (`memory_service.py:233`), and **`match_concept_mastery` at `db.py:817`** — the last one is
  easy to miss because it lives in a different file.
  Result shape is identical under `dict_row`, so consumers are unchanged.
- **`_store_document` (`:166-175`) is the priority fix.** It inserts *every* chunk embedding in
  one statement with **no cap on list length** — `MAX_CHUNKS_CHECKED = 12` bounds only the
  similarity check, not storage (`:33-34`). CockroachDB documents that large batched `VECTOR`
  inserts degrade performance. Replace with `cur.executemany(…)`, which pipelines statements,
  and add a tunable `CHUNKS_PER_INSERT_BATCH = 64`.
- Wrap `_store_document` in one transaction under the retry decorator. Today the
  `DELETE` (`:158`) and insert (`:166`) are separate calls — a failure between them leaves a
  document with zero chunks. Free correctness win. **Preserve the stable-`document_id` behavior
  exactly** (`:134-140` explains why: `concept_mastery.document_id` references it).
- Both RPC loops issue **one round trip per chunk** (up to 12 at `:91`, up to 3 at `:232`).
  Collapsing them into a single query is a worthwhile follow-up, but keep it out of the port
  commit.

### 4. Schema: `backend/sql/cockroach/` — consolidate, don't replay

Do **not** port the 14 migration files one-to-one. `match_concept_mastery` is defined **twice** —
`migrate_concept_mastery.sql:32` creates it, `migrate_calibration.sql:15` drops and recreates it
with calibration columns. Replaying in filename order breaks. Write one collapsed
`001_schema.sql` (final state of every table/index/function) plus `002_vector_indexes.sql`.
Leave `sql/` untouched as Supabase history.

| Item | Change |
|---|---|
| `create extension "pgcrypto"` / `vector` | **Drop both** — `gen_random_uuid()` and `VECTOR` are built in |
| `vector(384)` | `VECTOR(384)` |
| `using hnsw (embedding vector_cosine_ops)` | `VECTOR INDEX … (user_id, embedding vector_cosine_ops)` — see prefix note |
| `feature.vector_index.enabled` | Cluster-level op, run once in B1 — **not** in the schema file |
| `timestamptz`, `jsonb`, `uuid`, FKs, `ON DELETE CASCADE/SET NULL`, `unique(…)`, `if not exists`, `on conflict do nothing` | All supported, unchanged |
| RLS policies | **Drop entirely** (justification below) |

Keep the two vector indexes in a **separate file** (`002_`) so they can be created *after* a bulk
load — `IMPORT INTO` is unsupported on tables that already have a vector index.

**Keep all three UDFs as functions.** They are `language sql stable` single-statement SELECTs —
the easiest possible port — and keeping them makes each call site a one-line change. Define
`match_concept_mastery` **once**, in its 10-column calibration form.

**Prefix column:** every similarity query filters `WHERE user_id = target_user_id`
(`migrate_memory_layer.sql:59`), and CockroachDB accelerates filtered vector search only when
filters match index prefix columns. Hence `(user_id, embedding vector_cosine_ops)`. **Treat as a
hypothesis to verify with `EXPLAIN`, not settled fact.**

**RLS drop is safe, and say so in the README.** Ownership is enforced in application code on
every query (`delete_subject:95`, `review_flashcard:773-774`, `get_tutor_session:577-579`,
`delete_document:524`); after migration there is no direct client→DB path at all. Product
Readiness is an explicitly judged criterion (`HACKATHON.md`) — "access control is enforced
with user-scoped predicates on every query; the database is reachable only by the API, which
holds the only credential" is a good answer *if written down*.

## Ordering — nothing is ever half-broken

`db.py` is a module boundary with zero external Supabase leakage, so it ports function-by-function
behind a stable interface. **Do not dual-write.** Point dev at an empty CockroachDB schema and
re-create test data through the UI; Bloom has no production users and no data worth migrating.

> **Amended 2026-07-25.** "Empty schema" turned out to block the B2b spike — recall cannot be
> measured without vectors. The Supabase corpus (2 users, 5 documents, 95 chunks, 6 concepts) was
> therefore copied into CockroachDB as a **test fixture** via `copy_fixture.py`, which also
> restores the golden diff's usefulness for reads. This is not dual-writing and not an app-data
> migration: nothing writes back to Supabase, and the fixture is disposable — re-running the
> script rebuilds it. Clear these tables before any demo recording so the seeded data is yours.

| # | Status | Commit | State after |
|---|---|---|---|
| B1 | Done | Cluster provisioned (**Basic**, AWS `us-east-1`, v26.2.1). `feature.vector_index.enabled` already true | App unchanged |
| B2a | Done | `001_schema.sql` + `002_vector_indexes.sql` applied; 11 tables, 3 functions, 2 vector indexes; idempotent across two passes | App still on Supabase; schema exists in parallel |
| B2b | Done | **Spikes** (throwaway, see below) — needed chunks loaded into Cockroach, so it followed B3c | Decisions made before app code moves |
| B3a | Done | `database.py` + deps added and verified; `scripts/dbdump.py` written, Supabase baseline captured (17 read paths). Nothing imports `database.py` yet | App unchanged and running |
| B3b | Done | All six slices ported; 137 behavioral checks pass | Each slice individually runnable |
| B3c | Done | `memory_service.py` ported: 2 RPCs, `_store_document` batched + transactional; 24 checks pass | **Migration done** — `db.py` and `memory_service.py` hold zero supabase calls |
| B3d | Done | `datetime`/`UUID` fallout fixed via `_row()`/`_rows()`; `db.py:958` crash site resolved | Clean |
| B3e | Open | Optional follow-ups: `ON CONFLICT` idempotency, `.in_()` → `JOIN`, collapse RPC loops | Behavior changes isolated from the port |

`requirements.txt`: add `psycopg[binary,pool]`, `pgvector`. **Keep `supabase==2.31.0`** — auth
still needs it.

## Spike results (B2b) — run 2026-07-25, **all green**

Run against a fixture copy of the real Supabase corpus (2 users, 5 documents, 95 chunks,
6 concepts) loaded into CockroachDB so both databases answered identical queries.

**1. The vector index IS used, and the `user_id` prefix works as hypothesized.** `EXPLAIN` of the
user-filtered similarity query:

```
• vector search
    table: document_chunks@idx_document_chunks_embedding
    target count: 5
    prefix spans: [/'aee71848-…' - /'aee71848-…']
```

The `prefix spans` line confirms `user_id` narrows the search before the vector comparison — no
full scan, no post-filter. **The `(user_id, embedding vector_cosine_ops)` index shape is
correct**; that hypothesis is now settled fact.

**2. Recall vs. Supabase's exhaustive scan: 93.7% identical top-3 (ordered), 98.6% mean overlap**
across all 95 chunks. Every mismatch is a reordering of near-identical adjacent chunks from the
same lecture (`[13,12,11]` vs `[12,13,11]`), not a missed neighbour. No result is meaningfully
lost.

**3. The overlap feature reaches identical verdicts on all 5 documents** — same ratios to two
decimals, same fire/no-fire decision:

| Document | Supabase | CockroachDB |
|---|---|---|
| lecture2 | 0.17 → no banner | 0.17 → no banner |
| lecture3 | 0.42 → **fires** | 0.42 → **fires** |
| lecture4 | 0.75 → **fires** | 0.75 → **fires** |
| lecture5 | 0.58 → **fires** | 0.58 → **fires** |
| lecture6 | 0.08 → no banner | 0.08 → no banner |

**Conclusion: the approximate index is safe for the demo (HACKATHON.md D3 shot 2).** Risk #2 in
the ranked list below is closed.

> **Scope limit, stated deliberately.** 95 vectors is small enough that C-SPANN may not be
> partitioning meaningfully yet, so this validates demo-scale behavior, **not** recall at 10k+
> chunks. Re-run this spike if the corpus grows by an order of magnitude.

> **The spike scripts were throwaway and were not committed.** `spike_recall.py` (recall
> comparison) and `copy_fixture.py` (Supabase corpus → CockroachDB fixture) ran once from a
> scratch directory and no longer exist. Re-deriving them from the questions below is a couple of
> hours; the numbers above are the part worth keeping.

### What the spike was designed to answer (B2b)

Run against a real cluster with real chunks loaded. These four answers determined the schema and
the insert strategy:

1. **`EXPLAIN`** the user-filtered similarity query — confirm a vector index scan, not a full
   scan + sort.
2. **Same query through the UDF boundary** — confirm the function doesn't block index use. If it
   does, inline that one function's SQL at the call site (the body is 10 lines).
3. **Recall vs. brute force** — the k-means index is *approximate*. Compare top-3 against
   `ORDER BY` with the index dropped. **Highest-value check in the migration:** the overlap-
   detection demo (`HACKATHON.md` D3 shot 2) depends on it, and a recall regression is invisible
   until it embarrasses you on camera.
4. **`executemany` timing** for a 200-chunk document.

Questions 1 and 3 were answered directly and are recorded above. Question 2 was answered
implicitly — the ported call sites query the UDFs and the `EXPLAIN` in result 1 was taken through
that boundary, so no inlining was needed. Question 4 was not measured; `executemany` with
`CHUNKS_PER_INSERT_BATCH = 64` shipped on the strength of CockroachDB's documented warning about
large batched `VECTOR` inserts rather than on a local timing, and upload latency has not been a
complaint since.

## Verification (there is no test suite)

**The golden-output diff harness exists: `backend/scripts/dbdump.py`.** It calls every read path
in `db.py` for a fixed user and prints canonical JSON (sorted keys, normalized timestamps and
UUIDs). **The Supabase baseline was captured on 2026-07-25** — 17 read paths, all succeeding —
against test user `5b6b4246-e213-4920-baae-d78ff84a36e7` (5 attempts, 5 documents, 95 chunks,
6 concepts, 10 flashcards, 4 tutor sessions, so every path returns real rows).

```bash
python scripts/dbdump.py --user <external_id> > /tmp/after.json
diff /tmp/golden_supabase.json /tmp/after.json
```

One caveat on interpreting the diff: `_canon()` deliberately renders `datetime` and ISO strings
to the same form, so the diff shows **shape and value** changes (missing keys, flattened embeds,
row order, wrong counts) but will **not** show `datetime`-vs-string type drift. That is by design
— otherwise every timestamp would diff and drown the real signal — but it means the `datetime`
audit below is a separate, manual pass. Do not treat a clean diff as evidence that timestamps
are fine.

Per stage:

- **B1** — v26.2.1; `feature.vector_index.enabled` already true; `VECTOR(384)` column and
  `CREATE VECTOR INDEX` both confirmed working on Basic.
- **B2a** — schema applied twice cleanly (idempotent); 11 tables matching the Supabase list;
  3 functions; both vector indexes present with the `user_id` prefix; placeholder user seeded
  once (`ON CONFLICT DO NOTHING` held on the second pass).
- **B3b, per slice** — golden diff, then exercise that UI path by hand (subjects CRUD; take a
  quiz and check analytics; upload and open the library; run a tutor session; review a flashcard).
- **B3c** — upload document A, then a near-duplicate A′; **confirm the overlap banner fires**
  with a sensible number, compared against what Supabase produced for the same pair (keep the
  Supabase project alive for exactly this). Then re-upload A with different content and confirm
  the document id is stable and old chunks are gone.
- **Whole-phase gate** — restart the backend mid-tutor-session and confirm it resumes from the
  DB. This checks the jsonb round-trip **and** is literally the D3 video shot.

Run with `cd backend && uvicorn app.main:app --reload` and `cd frontend && npm run dev`.

## Risks, ranked

1. ~~**JSONB round-trip on `tutor_sessions`**~~ — **CLOSED 2026-07-25.** Tested directly against
   v26.2.1: nested `dict`/`list` values round-trip unchanged and `NULL` returns as `None`. The
   driver choice did its job. Still worth the restart-mid-session test at the whole-phase gate,
   but this is no longer the thing most likely to break.

   **Replaced as the top risk by: embedding writes.** `register_vector()` does not bind an input
   adapter on CockroachDB (see the driver section), so any embedding write that skips
   `to_vector()` fails at runtime with `malformed vector literal`. It fails loudly rather than
   silently, which is the good case — but there are writes in both `db.py`
   (`create_concept_mastery:826`) and `memory_service.py` (`_store_document`), so grep for every
   `embedding` parameter when porting those slices.
2. ~~**Vector index recall/acceleration**~~ — **CLOSED 2026-07-25** by the spike above: index
   confirmed used with prefix spans, 98.6% mean top-3 overlap, and identical overlap verdicts on
   all 5 documents. No fallback needed. (Re-open only if the corpus grows 10x.)
3. **`datetime` vs ISO-string leakage** — certain at `db.py:958`, likely elsewhere. Only the
   golden diff catches it.
4. **Vector insert latency** — affects upload UX and C4 demo seeding.
5. **Scope creep into async** — resist. Converts a ~2-day port into a 5-day refactor with no
   demo-visible benefit.

## Bugs the port exposed (2026-07-25)

Three pre-existing defects, all in the **silent wrong data** class — none raised an error, and
none would have been caught by clicking through the UI. All were found by the golden diff, and
all are fixed.

| Bug | Why it happened | Fix |
|---|---|---|
| **`best_category` was arbitrary.** Ten categories tie at 1/1 in the real corpus; the winner depended on the database's row order and differed between Supabase and CockroachDB. | `max()` returns the first maximum it sees, and dict insertion order followed row order. Supabase was never stable here either — the port just made it visible. | Rank by accuracy → **sample size** → name. A 5/5 category now beats a 1/1, which is also the more honest answer to "what are you best at". |
| **Flashcard review order was undefined.** A freshly generated set has every card due at the same instant, so `ORDER BY due_at` was a total tie. | No tiebreak column. The review screen could reshuffle between loads. | `ORDER BY f.due_at, f.id`. |
| **Every analytics aggregate was unordered.** `by_category`, `by_difficulty`, `by_subject`, `by_subject_accuracy` all followed row order. | Built by iterating rows into a dict. | `sorted(buckets.items())` at each site. |

Verified: two consecutive `dbdump.py` runs against CockroachDB are now **byte-identical**
(19/19 paths), a property Supabase never provided.

## Corrections from B1-B3a (2026-07-25)

Three claims in the original plan were wrong when tested against a real cluster. Each is
corrected in place above; collected here so nothing is acted on from memory of the first draft.

| Claim as written | What is actually true |
|---|---|
| `register_vector()` handles `list[float]` ↔ `VECTOR` **both ways** | **Read direction only.** Cockroach reports `vector` at OID 90006, so pgvector's input adapter never binds and a `list[float]` renders as `{…}` instead of `[…]`. Every write goes through `database.to_vector()`. |
| (not mentioned) | **Reads return numpy `ndarray`**, not `list[float]`. Breaks `if embedding:` (ValueError) and `json.dumps()`. Use `database.from_vector()` on embeddings leaving the layer. |
| B1 must `SET CLUSTER SETTING feature.vector_index.enabled = true` | Already `true` on a fresh Basic cluster. The `SET` is permitted but redundant. |

Also confirmed, which the plan left open:

- **`VECTOR(384)` enforces its dimension.** `information_schema.columns` reports bare `vector`,
  which looks like the dimension was dropped — it wasn't; a 3-dim insert is rejected.
- **CockroachDB secondary indexes append the primary key**, so `SHOW INDEXES` lists
  `idx_document_chunks_embedding (id, user_id, embedding)`. The `user_id` prefix is present as
  intended; the leading `id` is not a schema error.
- The **prefix-acceleration hypothesis is still unverified** — `CREATE VECTOR INDEX` succeeding
  proves syntax, not that `EXPLAIN` chooses the index for the user-filtered query. That remains
  spike B2b, and it needs real chunks in Cockroach first.

### Plan choice: Basic, not Standard

Recorded because the hackathon rules make this a correctness issue, not a cost preference.
Official rules: *"The Entrant must make the Project available free of charge and without any
restriction, for testing, evaluation and use by the Sponsor, Administrator and Judges **until the
Judging Period ends**"* — **September 15 2026**. The $400 trial credit expires **August 24 2026**,
and Standard has no free tier ($146/month at 2 vCPUs). A trial-backed Standard cluster would enter
a 30-day throttled grace period on Aug 24 — throttled is not "without any restriction" — during
the exact window judges may be testing. Basic's **$15/month resource allowance (≈50M RUs +
10 GiB storage) renews every billing cycle and does not expire**, and Bloom's demo load is far
below it. A payment method should still be on file: with no card, exceeding the allowance
disables the cluster rather than billing a few dollars.

## Outcome

The migration landed on 2026-07-25, ahead of the Aug 1-8 window `HACKATHON.md` reserved for it.
Pulling it forward was the point: Phases 3 and 4 of `ROADMAP_HONEN_FEATURES.md` (podcast, voice
roleplay) added roughly eight new `db.py` functions afterwards, and those were written directly
against SQL instead of being written twice.

What shipped, and where to read it now:

| Artifact | Location | What it holds |
|---|---|---|
| Connection infrastructure | `backend/app/database.py` | Pool, `cursor()` / `transaction()`, `to_vector()` / `from_vector()`, the 40001 retry decorator |
| Queries | `backend/app/db.py` | All SQL. No Supabase imports |
| Vector memory | `backend/app/memory_service.py` | Three former RPCs as direct `SELECT`s; batched, transactional chunk storage |
| Schema | `backend/sql/cockroach/` | Numbered, idempotent. `001` collapses the 14 Supabase migrations to final state; `002` holds the vector indexes separately so a bulk load can precede them |
| Golden-diff harness | `backend/scripts/dbdump.py` | Canonical JSON dump of every read path, per user |
| Supabase history | `backend/sql/` (unnumbered) | Retained for provenance. No longer applied |

The durable design decisions are summarized in the README's "Database layer" section; the
reasoning behind each one is in the driver and schema sections above.

### Divergences from `HACKATHON.md`

`HACKATHON.md` was written before the codebase's sync structure was understood, and it has not
been amended. Where the two documents disagree, this one reflects what was built:

| `HACKATHON.md` | What was actually done |
|---|---|
| **B3** — "SQLAlchemy async / asyncpg", described as also completing the async story | psycopg 3, **sync**, with a connection pool. All 59 call sites were sync and already wrapped in `asyncio.to_thread`; going async meant rewriting every `db.*` signature and every caller in `tutor_agent.py`. See the driver section for the full argument |
| **B4** — auth swap to Amazon Cognito | **Dropped.** Supabase Auth is permanent; `auth.py` was untouched by the migration. The AWS requirement is met by S3, App Runner, and Bedrock |
| **B5** — embeddings via Bedrock Titan or fastembed, "decide by" | **Settled: fastembed `BAAI/bge-small-en-v1.5`, 384-dim, stays.** The schema ports unchanged, nothing needs re-embedding, and there is no per-call cost. Bedrock covers LLM work only |
| **Timeline** — Phase B at Aug 1-8 | Completed 2026-07-25 |

### Left open

`B3e` is the only unfinished item, and it is deliberately out of scope for the port: `ON CONFLICT`
idempotency on the two read-then-write races, `.in_()` → `JOIN` at the two `= ANY` sites, and
collapsing the per-chunk RPC loops into single queries. Each changes behavior rather than
preserving it, which is why they were kept out of the migration commits — a port and a behavior
change in the same diff are indistinguishable when one of them turns out to be wrong.

The recall spike validated demo-scale behavior at 95 vectors, not production scale. If the corpus
grows by an order of magnitude, re-run it before trusting the approximate index.
