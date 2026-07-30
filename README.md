<p align="center">
  <picture>
    <source srcset="docs/assets/banner-ink.svg" type="image/svg+xml">
    <img src="docs/assets/banner.png" alt="Bloom" width="100%">
  </picture>
</p>

# Bloom

Bloom is an AI-powered study platform that turns course material (uploaded files, pasted links, or YouTube videos) into summaries, flashcards, practice quizzes, two-speaker podcast episodes, adaptive one-on-one tutoring, and live voice roleplay sessions where the student explains the material out loud and is graded against a grounded rubric.

It is built around an agentic backend: every generation step is a multi-stage pipeline with self-verification rather than a single LLM call. Every stage fails open: any verification step that errors out degrades gracefully instead of blocking the student.

## Features

### Ingestion

- File upload for PDF, DOCX, and PPTX, with page-level classification and vision descriptions for diagrams and equations
- URL ingestion: YouTube videos (caption track → yt-dlp/Whisper fallback), direct media files, and articles
- Originals persisted to object storage, so students can read the real document alongside its extracted text
- Multi-document sessions: several sources combined into one study or tutoring context

### Study tools

- Concept-grouped, bullet-point, short, and detailed summaries (draft → critique → revise)
- Interactive flashcards with SM-2 spaced repetition and a due-card review deck
- Multiple-choice quizzes where every question is fact-checked against the source before it is shown
- Two-speaker podcast episodes with synthesized audio and exact per-segment playback offsets for follow-along highlighting
- Pretests: retrieval practice *before* studying, which also seeds the tutor with real mastery evidence

### Tutoring

- Adaptive tutor sessions with per-concept mastery tracking, variant/recheck follow-ups, and difficulty calibration
- Selectable rigor modes: `vibe_check` (0.75 mastery bar) and `locked_in` (0.85, two variants, a hard variant, and a required final success)
- Teach-it-back mode: the tutor states a plausible misconception and the student has to correct it in their own words
- Self-explanation prompts, confidence calibration feedback, and misconception diagnosis rather than plain right/wrong
- Live voice roleplay: a grounded scene, real-time speech in and out over a WebSocket, and a rubric graded against the source at the end
- Concept-level spaced repetition, so mastered concepts resurface on a schedule

### Analytics and persistence

- Supabase Auth accounts; all data scoped per user and stored in CockroachDB
- Persistent quiz history with per-question records
- Performance breakdowns by category, difficulty, and subject
- Score trends and profile statistics across all attempts
- Cross-upload memory that recognizes when new material overlaps documents already studied

## Architecture

```mermaid
flowchart TB
    U[Student] --> FE[Next.js Frontend]

    FE -->|REST| API[FastAPI Backend]
    FE -->|WebSocket| WS["WS /roleplay/live"]

    subgraph Ingestion
        EXTRACT[Extraction Agent<br/>page classification + vision]
        URL[URL Ingest<br/>YouTube / media / article]
    end

    subgraph Generation
        SYNTH[Synthesis Agent<br/>draft, critique, revise]
        QUIZ[Quiz Agent<br/>generate, ground-check, regenerate]
        POD[Podcast Pipeline<br/>script + TTS assembly]
    end

    subgraph Interactive
        PRE[Pretest Agent]
        TUTOR[Tutor Agent<br/>adaptive mastery loop]
        RP[Roleplay Agent<br/>scene + rubric]
    end

    MEMSVC[Memory Service<br/>overlap + weak concepts]

    API --> EXTRACT & URL
    API --> SYNTH & QUIZ & POD
    API --> PRE & TUTOR
    WS --> RP

    EXTRACT -.->|page images| VISION[(Vision LLM)]
    SYNTH & QUIZ & PRE & TUTOR & RP & POD -.-> LLM[(LLM via OpenRouter)]
    POD -.-> TTS[(Deepgram Aura-2 TTS)]
    RP -.-> STT[(Deepgram Flux STT)]
    RP -.-> TTS

    EXTRACT & URL --> MEMSVC
    MEMSVC -.->|local embeddings| VDB[(CockroachDB pgvector)]

    API --> DB[(CockroachDB)]
    RP --> DB
    API --> S3[(S3 / local disk<br/>originals + audio)]
```

### Request lifecycle

Long pipelines run 30+ seconds, so the frontend generates a progress id, sends it with the request, and polls `GET /progress/{id}` while the request is in flight. Pipelines report human-readable stage strings ("Describing page 4 of 12") as they go. Progress is in-memory and best-effort; losing it on restart just falls back to generic spinner text.

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant API as FastAPI
    participant P as Progress store
    participant Pipe as Pipeline

    FE->>FE: Generate progress_id
    FE->>API: POST /generate-* (progress_id)
    API->>Pipe: Run with progress reporter

    loop While in flight
        Pipe->>P: report(stage)
        FE->>API: GET /progress/{id}
        API->>P: get_stage()
        API-->>FE: "Describing page 4 of 12"
    end

    Pipe-->>API: Result
    API->>P: clear(id)
    API-->>FE: Response
```

### Extraction agent

PDF pages are classified individually before use. Text pages are kept as text; visual pages are rendered to images and described by a vision-capable model, so diagrams and equations contribute to generation instead of being silently dropped.

```mermaid
flowchart TD
    START[PDF uploaded] --> LOOP{For each page}
    LOOP --> CLASSIFY[Classify page:<br/>title/agenda, dense text,<br/>diagram/chart, equation]
    CLASSIFY -->|title/agenda| DEWEIGHT[Keep as low-weight context]
    CLASSIFY -->|dense text| KEEPTEXT[Keep full text]
    CLASSIFY -->|diagram/chart/equation| VISIONCALL[Render page image, describe it<br/>with a vision-capable model]
    DEWEIGHT --> NEXT{More pages?}
    KEEPTEXT --> NEXT
    VISIONCALL --> NEXT
    NEXT -->|yes| LOOP
    NEXT -->|no| ASSEMBLE[Assemble structured<br/>document representation]
    ASSEMBLE --> ORIG[Store original file<br/>in object storage]
```

### URL ingestion

A link produces the same plain-text-plus-filename shape a file upload does, so nothing downstream (chunking, embedding, overlap detection, the library, tutor sources) needs to know a document came from a link. YouTube is tiered: the caption track is tried first because it is instant and free, and Whisper transcription is the slow fallback. A caption track under 200 characters is treated as a miss rather than ingested as-is.

```mermaid
flowchart TD
    URLIN[URL submitted] --> KIND{Classify URL}

    KIND -->|YouTube| CAPS[Fetch caption track]
    CAPS --> USABLE{Longer than<br/>200 chars?}
    USABLE -->|yes| NORM[Restore punctuation<br/>in ~3000-char chunks]
    USABLE -->|no| DL

    KIND -->|Media extension| DL[yt-dlp: download audio<br/>cap 90 min]
    DL --> WHISPER[Whisper transcription]
    WHISPER --> NORM

    KIND -->|Other| ART[trafilatura: extract<br/>article text]
    ART --> NORM

    NORM --> BUDGET[Truncate to<br/>extraction char budget]
    BUDGET --> SAME[Same pipeline as<br/>a file upload]
```

### Synthesis agent (draft, critique, revise)

Structured summaries go through a three-step loop: a draft is generated, a critique pass checks it against the source text and a fixed quality checklist (verbatim copying, redundant concepts, thin synthesis, schema violations), and a revision pass fixes any issues found before the result is returned.

```mermaid
sequenceDiagram
    participant Backend
    participant Drafter as LLM (draft)
    participant Critic as LLM (critique)
    participant Reviser as LLM (revise)

    Backend->>Drafter: Extracted content + concept-grouping instructions
    Drafter-->>Backend: Draft summary JSON

    Backend->>Critic: Draft + original source + quality checklist
    Critic-->>Backend: Critique notes (structured)

    alt Critique found issues
        Backend->>Reviser: Draft + critique notes
        Reviser-->>Backend: Revised summary JSON
    else Draft passed
        Backend->>Backend: Use draft as-is
    end
```

### Quiz agent with grounding verification

Every generated question is fact-checked against the source text. Questions whose stated answers are not supported by the source are regenerated with feedback, and persistently ungrounded questions are dropped and backfilled, which suppresses hallucinated quiz content.

```mermaid
flowchart TD
    GEN[Generate candidate question<br/>+ options + answer] --> VERIFY[Verify answer against<br/>source text]
    VERIFY --> FOUND{Answer grounded<br/>in source?}
    FOUND -->|yes| ACCEPT[Accept question]
    FOUND -->|no| REGEN[Regenerate with feedback:<br/>not supported by source<br/>up to 2 retries, then<br/>drop and backfill]
    REGEN --> VERIFY
    ACCEPT --> MORE{More questions<br/>to verify?}
    MORE -->|yes| GEN
    MORE -->|no| RETURN[Return verified quiz]
```

### Podcast pipeline

The script and the audio fail independently, on purpose. Writing and grounding the script is the expensive, valuable part; synthesis is a separate service that can be out of credit or misconfigured, so a synthesis failure still returns a full readable script with an `audio_error` the player shows.

Deepgram has no multi-speaker mode, so assembly is owned here. Segments are requested as raw linear16 PCM at 24 kHz and concatenated as samples, with a single MP3 encode at the end. Encoding per segment would put MP3 frame boundaries mid-episode, which is exactly where audible seams come from. Per-segment sample counts give exact playback offsets rather than word-count estimates.

```mermaid
flowchart TD
    SRC[Source text] --> SCRIPT[Generate two-speaker<br/>script: host + explainer]
    SCRIPT --> ROW[Create podcast row<br/>id names the audio object]
    ROW --> CONF{TTS configured?}

    CONF -->|no| SCRIPTONLY[Return script-only episode<br/>with audio_error]

    CONF -->|yes| FANOUT[Synthesize segments concurrently<br/>semaphore-bounded, 2000 chars/request]
    FANOUT --> JOIN[Concatenate raw PCM<br/>+ inter-turn silence]
    JOIN --> ENC[Single MP3 encode]
    ENC --> STORE[Store in S3 / local disk]
    STORE --> OFFSETS[Fold measured offsets<br/>back into stored script]
    OFFSETS --> DONE[Presigned playback URL]

    FANOUT -.->|TTSError| SCRIPTONLY
    STORE -.->|StorageError| SCRIPTONLY
```

### Memory layer

Each upload is chunked on paragraph boundaries and embedded locally with fastembed (BAAI/bge-small-en-v1.5, 384 dimensions), then stored in CockroachDB's vector columns scoped to the user. New uploads are compared against stored chunks by cosine similarity; substantial overlap with prior documents is surfaced in the UI before the student generates duplicate study material, and the same index answers "what is this student weak on in this material?" for the tutor and roleplay agents. Embedding runs on the backend CPU, so this layer needs no external embedding API.

```mermaid
flowchart LR
    UPLOAD[New document] --> CHUNK[Chunk on paragraph<br/>boundaries]
    CHUNK --> EMBED[Embed locally<br/>fastembed, 384-dim]
    EMBED --> STORE[(document_chunks<br/>VECTOR, per user)]
    EMBED --> QUERY{Cosine similarity vs.<br/>stored chunks above<br/>thresholds?}
    QUERY -->|yes| SURFACE[Surface overlapping<br/>prior documents]
    QUERY -->|no| PROCEED[Proceed normally]
    SURFACE --> WEAK[Join to concept_mastery:<br/>weak concepts in this material]
    WEAK --> TUTOR[Seeds tutor + roleplay]
```

### Adaptive tutor

A tutor session extracts key concepts, initializes a per-concept mastery estimate, and makes a fresh decision after every answer. The central rule is that **one correct answer is never mastery evidence on its own**: multiple choice has a 25% guess rate, and repeating a question tests memory of the question, not the concept. So every answer schedules a follow-up in a different framing, landing 2-4 questions later, unannounced:

- A **correct** answer queues a *variant* of the same knowledge point. Passing variants is what actually moves a concept toward mastered.
- A **wrong** answer shows the correct answer plus a diagnosis and queues a *recheck*. Failing rechecks three times parks the concept: the tutor stops drilling it and the summary says to re-read that material.
- Failing a variant after getting the original right is memorization-detected, and is punished harder than a plain miss.

Mastery deltas combine a difficulty base, an evidence-quality weight, and the student's self-reported confidence. A confidently-wrong answer moves further than an unsure one; an unsure-but-right answer moves less, since it may be a lucky guess. No live knowledge state is exposed during the session, only in the end summary.

| Mode | Mastery bar | Variants required | Hard variant | Last answer must be correct |
|---|---|---|---|---|
| `vibe_check` (default) | 0.75 | 1 | no | no |
| `locked_in` | 0.85 | 2 | yes | yes |
| `teach_back` | 0.80 | 1 | no | no |

```mermaid
sequenceDiagram
    participant Student
    participant Tutor as Tutor Agent
    participant KS as Knowledge state
    participant Q as Follow-up queue

    Tutor->>KS: Seed from concepts + prior concept_mastery rows

    loop Until every concept clears the mode's bar
        Tutor->>Q: Due follow-up?
        alt Follow-up due
            Q-->>Tutor: Variant or recheck
        else
            Tutor->>KS: Weighted-random pick of a weak concept<br/>(never twice in a row when avoidable)
        end

        Tutor->>Student: Ask (answer stays server-side)
        Student->>Tutor: Answer + confidence
        Tutor->>Tutor: Grade, diagnose the wrong option chosen
        Tutor->>KS: delta = base(difficulty)<br/>x evidence weight x confidence
        Tutor->>Q: Queue variant (correct) or recheck (wrong),<br/>2-4 questions out

        opt Correct multiple choice, p rises as mastery falls
            Tutor->>Student: "Justify that in one sentence"
            Student->>Tutor: Free text
            Tutor->>KS: Revoke credit if it doesn't hold
        end
    end

    Tutor->>KS: Schedule concept reviews (SM-2)
    Tutor->>Student: Summary: mastered, weak, parked,<br/>misconceptions, calibration
```

### Voice roleplay

The student practices explaining their material out loud to a character who has a reason to ask about it, and a grounded rubric grades the transcript at the end. The scene is the delivery mechanism; the rubric is the feature.

Roleplay runs parallel to the tutor agent and deliberately shares none of its state machine: a tutor session is a question/answer loop with mastery gates, while a roleplay session is a conversation with one terminal grading pass. The structural difference is a **persisted/live split**: a session holds a websocket, an upstream Deepgram Flux socket, and an in-flight TTS task, none of which are serializable and all of which are meaningless after a disconnect. Those live under `session["live"]`, so the persistence layer never has to know they exist and a reconnect rebuilds them without touching `session["persisted"]`.

Four rules carry the feature:

1. **The rubric's `evidence` is never sent to the client.** Criterion *names* are shown up front, because knowing what a good explanation covers is the pedagogy, but `evidence` names the source fact that makes each one checkable, which is the answer key.
2. **Grading is fail-silent, not fail-generous.** An ungradeable scene returns null score, empty criteria, and an honest message. Marking every criterion met would tell a student they demonstrated things they never said.
3. **Ownership is checked twice**: in SQL on the cold path, and explicitly on a cache hit where no query ran at all.
4. **Mastery moves weakly.** A criterion graded by a model reading a conversation is softer evidence than an answer key, so a scene nudges mastery by a fraction of a graded question, and never schedules a spaced-repetition review.

Scenes are capped at 20 turns with a soft checkpoint nudge at 12, and a scene with fewer than two student turns isn't graded at all.

```mermaid
sequenceDiagram
    participant B as Browser
    participant WS as FastAPI WebSocket
    participant RP as Roleplay Agent
    participant Flux as Deepgram Flux (STT)
    participant LLM
    participant TTS as Deepgram Aura-2

    Note over B,WS: Auth is a first-frame protocol, not a query param:<br/>a token in the URL lands in access logs and history

    B->>WS: {"type":"auth","token":...}
    WS->>RP: Load session, check ownership
    alt Bad token
        WS-->>B: close 4401
    else Foreign or missing session
        WS-->>B: close 4404
    end
    WS-->>B: {"type":"ready", scenario, transcript, turns_taken}

    loop Each turn
        B->>WS: Binary PCM, 16kHz mono, 80ms chunks
        WS->>Flux: Stream audio
        Flux-->>WS: TurnInfo: StartOfTurn / Update / EndOfTurn
        WS-->>B: {"type":"transcript", partial/final}

        WS->>RP: handle_utterance(final text)
        RP->>LLM: Character reply, grounded in source
        LLM-->>RP: Reply text
        RP->>RP: Append to transcript, persist once
        WS-->>B: {"type":"reply", text, turn_id}

        RP->>TTS: Synthesize reply
        TTS-->>WS: MP3
        WS-->>B: Binary MP3 down
    end

    Note over B,WS: Binary = audio (PCM up, MP3 down).<br/>Text = JSON control. Nothing is base64'd.

    B->>WS: {"type":"end"}
    WS->>RP: grade_session()
    RP->>LLM: Grade transcript against rubric evidence
    RP->>RP: Weak mastery nudge, complete session
    WS-->>B: {"type":"result", score, criteria, transcript}
```

### Spaced repetition

Flashcards and concepts both carry SM-2 scheduling state: `(interval_days, ease, repetitions)` with an ease floor of 1.3. Flashcard reviews are graded by the student's self-report; concept reviews are scheduled by the tutor when a session confirms or fails a concept against its mastery bar. Due items surface through `/me/flashcards/due` and `/me/concepts/due`.

```mermaid
flowchart LR
    REVIEW[Review event] --> GRADE{Grade}
    GRADE -->|again| RESET[interval = 1d<br/>ease -= 0.2, floor 1.3]
    GRADE -->|hard| HARD[Small interval bump<br/>ease -= 0.15]
    GRADE -->|good / easy| PROG[1d -> 6d -> interval x ease]
    RESET & HARD & PROG --> DUE[Set due_at]
    DUE --> QUEUE["GET /me/flashcards/due<br/>GET /me/concepts/due"]
```

## Data model

CockroachDB, with pgvector-compatible `VECTOR` columns for the memory layer. Auth is Supabase; `users.external_id` maps a Supabase Auth user onto a local row, and every other table is scoped through it.

```mermaid
erDiagram
    users ||--o{ subjects : owns
    users ||--o{ documents : owns
    users ||--o{ document_chunks : owns
    users ||--o{ quiz_attempts : owns
    users ||--o{ concept_mastery : owns
    users ||--o{ tutor_sessions : owns
    users ||--o{ flashcard_sets : owns
    users ||--o{ podcasts : owns

    documents ||--o{ document_chunks : "chunked into"
    subjects ||--o{ quiz_attempts : categorizes
    quiz_attempts ||--o{ question_attempts : "records"
    concept_mastery ||--o{ misconceptions : "diagnosed"
    flashcard_sets ||--o{ flashcards : contains
    tutor_sessions ||--o| roleplay : "roleplay state columns"
```

Key columns worth knowing:

- `documents.source_key` / `source_content_type`: the object-storage key for the original upload
- `document_chunks.embedding`: 384-dim `VECTOR`, indexed separately in `002_vector_indexes.sql`
- `concept_mastery`: mastery estimate plus `interval_days` / `ease` / `review_due_at` for concept-level spaced repetition
- `tutor_sessions`: six `jsonb` columns holding the full knowledge state, so a session survives a backend restart; roleplay adds scenario, transcript, and rubric columns to the same table
- `flashcards.due_at`: indexed with `user_id` for the due-card query

### Database layer

The port off Supabase's client to CockroachDB is documented in `MIGRATION_COCKROACHDB.md`. Three choices shape `database.py`:

- **psycopg 3, synchronous.** Every `db.py` function is sync and callers already wrap blocking work in `asyncio.to_thread`. Going async would mean rewriting every signature and every caller: a whole-app refactor rather than a port.
- **`row_factory=dict_row`**, which makes every query return `list[dict]` with string keys, exactly what `supabase-py`'s `.execute().data` returned. This is the single choice that kept consumers working untouched.
- **Client-side retry on SQLSTATE 40001.** CockroachDB uses `SERIALIZABLE` isolation and aborts conflicting transactions rather than blocking, so retry with exponential backoff and jitter is a requirement of the database, not defensive padding.

One CockroachDB-specific wrinkle: pgvector's *input* adapter doesn't bind, because Cockroach reports the vector type under its own OID rather than the one pgvector discovers. Embeddings are therefore rendered through `database.to_vector()` on the way in and normalized back with `from_vector()` on the way out.

## Tech stack

### Backend

- FastAPI with Uvicorn; one WebSocket route for live roleplay
- OpenRouter as the LLM provider: `openai/gpt-oss-120b` for text, load-balanced across Cerebras, Groq, and Amazon Bedrock (a single pinned provider rate-limits under concurrent bursts); `google/gemma-4-31b-it` for vision page descriptions, left unpinned for the same reason
- CockroachDB via psycopg 3 with a connection pool, for all persistence and vector search
- Supabase Auth for identity only
- Deepgram Aura-2 for TTS (podcasts and roleplay), Deepgram Flux (`v2/listen`) for streaming STT
- fastembed for local ONNX embeddings (no external embedding API)
- PyMuPDF, python-docx, python-pptx for document parsing
- yt-dlp, youtube-transcript-api, trafilatura, Whisper for URL ingestion
- boto3 for S3, with a local-disk fallback using the same key layout
- numpy + soundfile for podcast audio assembly

### Frontend

- Next.js 16 (App Router, Turbopack) with React 19 and TypeScript
- Tailwind CSS with Radix primitives and a custom component library
- recharts for analytics, KaTeX for math rendering, react-markdown + remark-gfm for content
- motion, GSAP, and OGL for the landing and background visuals
- Supabase JS client (`@supabase/ssr`) for authentication

## Getting started

### Prerequisites

- Node.js 18 or higher
- Python 3.10 or higher
- A CockroachDB cluster (or `cockroach start-single-node` locally)
- A Supabase project (used for auth only)
- An OpenRouter API key
- Optional: a Deepgram API key (podcast audio and voice roleplay), an S3 bucket (originals and audio), `ffmpeg` on PATH (Whisper fallback for URL ingestion)

### Backend setup

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Create `backend/.env`:

```env
# Required
OPENROUTER_API_KEY=your_openrouter_api_key
DATABASE_URL=postgresql://user:pass@host:26257/bloom?sslmode=verify-full
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Optional, audio features. Without this, podcasts are script-only
# and voice roleplay falls back to text.
DEEPGRAM_API_KEY=your_deepgram_key

# Optional, object storage. Without a bucket, originals and podcast
# audio are written to backend/media/ under the same key layout.
AWS_S3_BUCKET=your-bucket
AWS_REGION=us-west-2

# Optional, tuning
DB_POOL_MAX_SIZE=10
WHISPER_MODEL=base
PUBLIC_API_URL=http://localhost:8000
```

Apply the SQL in `backend/sql/cockroach/` in numeric order:

| File | Adds |
|---|---|
| `001_schema.sql` | Every table, index, and UDF (collapsed final state) |
| `002_vector_indexes.sql` | The two vector indexes, kept separate so a bulk load can precede them |
| `003_podcasts.sql` | Podcast episodes and segment offsets |
| `004_document_originals.sql` | `documents.source_key` / `source_content_type` |
| `005_roleplay.sql` | Roleplay state columns on `tutor_sessions` |

Each file is idempotent (`IF NOT EXISTS` throughout), so re-applying is safe. `backend/sql/` (unnumbered) is the pre-CockroachDB Supabase history and is no longer applied.

Run the API:

```bash
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Note: the first upload after a fresh install downloads the local embedding model (approximately 100 MB) to the machine's cache.

### Frontend setup

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

Run the development server:

```bash
npm run dev
```

The application is served at http://localhost:3000; interactive API documentation is available at http://localhost:8000/docs.

### Roleplay gate suite

Roleplay's load-bearing invariants have an offline check suite that needs no API keys and no running server:

```bash
cd backend
python -m scripts.roleplay_gates.run_all
```

| Gate | Proves |
|---|---|
| `gate_a_grading` | Rubric grading maps criteria to scores correctly |
| `gate_b_landmines` | `evidence` never reaches the client; ownership is enforced on both paths |
| `gate_b_live_db` | The same checks against a live database |
| `gate_c_honest_failure` | An ungradeable scene fails silent, not generous |
| `gate_d_protocol` | WebSocket framing, auth, and close codes |
| `gate_e_flux_protocol` | Deepgram Flux event handling and turn mapping |

## API overview

All endpoints except `/` and `/health` require a Supabase Auth bearer token. The WebSocket authenticates with a first JSON frame instead.

### Ingestion and documents

| Endpoint | Method | Description |
| --- | --- | --- |
| `/upload-pdf` | POST | Upload a PDF/DOCX/PPTX; returns extracted text and overlapping prior documents |
| `/ingest-url` | POST | Ingest a YouTube video, media file, or article URL |
| `/me/documents` | GET | The user's document library |
| `/documents/{id}/content` | GET | Extracted text for a document |
| `/documents/{id}/original` | GET | The original uploaded file |
| `/documents/{id}/original/meta` | GET | Page count and content type for the viewer |
| `/documents/{id}/page/{n}` | GET | A rendered page image |
| `/documents/{id}` | DELETE | Delete a document |

### Generation

| Endpoint | Method | Description |
| --- | --- | --- |
| `/generate-summary` | POST | Generate a summary (short, bullet points, or detailed) |
| `/generate-quiz` | POST | Generate a grounding-verified multiple-choice quiz |
| `/generate-flashcards` | POST | Generate a flashcard set |
| `/generate-podcast` | POST | Generate a two-speaker episode; returns script even if audio fails |
| `/me/podcasts` | GET | The user's episodes, newest first |
| `/podcasts/{id}` | GET | One episode with segments and offsets |
| `/podcasts/{id}/audio` | GET | Episode audio (presigned or token-signed) |
| `/progress/{id}` | GET | Current stage of an in-flight pipeline |

### Study and review

| Endpoint | Method | Description |
| --- | --- | --- |
| `/check-answers` | POST | Grade a quiz and persist the attempt |
| `/me/flashcards/due` | GET | Flashcards due for review |
| `/flashcards/{id}/review` | POST | Record a review and reschedule (SM-2) |
| `/me/concepts/due` | GET | Concepts due for review |
| `/pretest/start` | POST | Start a pretest over extracted concepts |
| `/pretest/submit` | POST | Grade a pretest in one batch and seed mastery |

### Tutoring and roleplay

| Endpoint | Method | Description |
| --- | --- | --- |
| `/tutor/start` | POST | Start an adaptive tutor session; returns the first question |
| `/tutor/answer` | POST | Submit an answer; returns feedback, diagnosis, and what's next |
| `/tutor/wrap` | POST | End a session early and get the summary |
| `/tutor/session/{id}` | GET | Resume an in-progress session |
| `/roleplay/start` | POST | Generate a grounded scene and open a session |
| `/roleplay/live/{id}` | WS | Live audio + control channel for the scene |
| `/roleplay/end` | POST | End a scene and grade it |
| `/roleplay/{id}/result` | GET | The rubric result and transcript |

### Subjects and analytics

| Endpoint | Method | Description |
| --- | --- | --- |
| `/subjects` | GET, POST | List or create the user's subjects |
| `/subjects/{id}` | DELETE | Delete a subject |
| `/me/stats` | GET | Aggregate profile statistics |
| `/me/analytics` | GET | Chart-ready performance datasets |
| `/me/recent-attempts` | GET | Recent quiz attempts |
| `/quiz-attempts/{id}/breakdown` | GET | Per-category and per-difficulty breakdown |
| `/quiz-attempts/{id}/recap` | GET | Full question-by-question recap |

## Project structure

```
bloom/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI routes + the roleplay websocket
│   │   ├── models.py            # Pydantic request/response models
│   │   ├── ai_service.py        # LLM calls: synthesis, grounding, tutor, roleplay, podcast script
│   │   ├── extraction_agent.py  # Page-by-page extraction with vision descriptions
│   │   ├── url_ingest.py        # YouTube / media / article ingestion
│   │   ├── pdf_render.py        # Page image rendering for the viewer
│   │   ├── tutor_agent.py       # Adaptive tutor state machine and mastery model
│   │   ├── roleplay_agent.py    # Scene sessions, persisted/live split, rubric grading
│   │   ├── pretest_agent.py     # Pre-study retrieval practice
│   │   ├── memory_service.py    # Per-user vector memory over uploads
│   │   ├── tts_service.py       # Deepgram Aura-2 synthesis and audio assembly
│   │   ├── stt_service.py       # Deepgram Flux streaming transcription
│   │   ├── storage_service.py   # S3 / local-disk object storage boundary
│   │   ├── progress.py          # Stage reporting for long pipelines
│   │   ├── database.py          # CockroachDB pool, cursors, retry, vector adapters
│   │   ├── db.py                # All queries
│   │   └── auth.py              # Supabase Auth verification + media tokens
│   ├── scripts/
│   │   ├── roleplay_gates/      # Offline invariant checks for roleplay
│   │   └── ...                  # Migration and schema utilities
│   ├── sql/cockroach/           # Numbered, idempotent schema files
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/                 # Next.js App Router pages
│   │   ├── components/
│   │   │   ├── study/           # Study flow, tutor, analytics, podcast player
│   │   │   └── study/roleplay/  # Scene brief, mic orb, conversation log, results
│   │   ├── hooks/               # Audio recorder, roleplay socket, audio player
│   │   ├── lib/                 # API client and Supabase clients
│   │   └── types/               # Shared TypeScript types
│   └── package.json
├── MIGRATION_COCKROACHDB.md     # Supabase → CockroachDB port rationale
├── ROADMAP.md                   # Planned improvements, in build order
├── ROADMAP_LEARNING.md          # Learning-science features
├── ROADMAP_HONEN_FEATURES.md    # Podcast, roleplay, and related work
└── README.md
```

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
