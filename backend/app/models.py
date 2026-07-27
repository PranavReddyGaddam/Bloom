from pydantic import BaseModel
from typing import List, Optional

class SummaryRequest(BaseModel):
    text_content: str
    summary_type: str  # "short", "bullet_points", "detailed"
    subject: Optional[str] = None

class SummaryResponse(BaseModel):
    summary: str
    tags: List[str]
    summary_type: str
    word_count: int

class QuizQuestion(BaseModel):
    question: str
    options: List[str]
    correct_answer: str
    explanation: Optional[str] = None
    category: Optional[str] = None
    difficulty: Optional[str] = None

class QuizRequest(BaseModel):
    text_content: str
    num_questions: int
    subject: str
    difficulty: str  # "easy", "medium", "hard"

class QuizResponse(BaseModel):
    questions: List[QuizQuestion]
    total_questions: int
    difficulty: str
    subject: str
    estimated_time: int  # in minutes

class AnswerCheckRequest(BaseModel):
    questions: List[QuizQuestion]
    user_answers: List[str]
    subject_id: str
    difficulty: str

class AnswerCheckResponse(BaseModel):
    score: float
    correct_answers: int
    total_questions: int
    feedback: str
    suggestion: str
    passed: bool
    attempt_id: Optional[str] = None

class BreakdownEntry(BaseModel):
    label: str
    correct: int
    total: int

class AttemptBreakdownResponse(BaseModel):
    by_category: List[BreakdownEntry]
    by_difficulty: List[BreakdownEntry]

class RecentAttempt(BaseModel):
    id: str
    subject: str
    difficulty: str
    score: float
    total_questions: int
    created_at: str

class UserStatsResponse(BaseModel):
    total_attempts: int
    average_score: float
    best_category: Optional[str] = None
    recent_attempts: List[RecentAttempt]

class ScoreTrendPoint(BaseModel):
    attempt_id: str
    subject: str
    score: float
    created_at: str

class AccuracyEntry(BaseModel):
    label: str
    correct: int
    total: int
    accuracy: float

class SubjectCount(BaseModel):
    label: str
    count: int

class UserAnalyticsResponse(BaseModel):
    score_trend: List[ScoreTrendPoint]
    by_category: List[AccuracyEntry]
    by_difficulty: List[AccuracyEntry]
    by_subject: List[SubjectCount]
    by_subject_accuracy: List[AccuracyEntry]

class Subject(BaseModel):
    id: str
    name: str
    created_at: str

class CreateSubjectRequest(BaseModel):
    name: str

class RecapQuestion(BaseModel):
    question_text: str
    category: Optional[str] = None
    difficulty: Optional[str] = None
    user_answer: str
    correct_answer: str
    is_correct: bool
    question_index: int

class AttemptRecapResponse(BaseModel):
    id: str
    subject: str
    difficulty: str
    score: float
    total_questions: int
    created_at: str
    questions: List[RecapQuestion]

class SimilarDocument(BaseModel):
    document_id: str
    filename: str
    uploaded_at: str
    similarity: float  # 0-1, best matching chunk pair
    overlap: float  # 0-1, fraction of the new upload's chunks that matched

class DocumentInfo(BaseModel):
    id: str
    filename: str
    created_at: str
    chunk_count: int
    # Whether the original file was kept, and whether it can be paged through.
    # Defaulted false so anything constructing these without the new columns
    # keeps working, and so a document predating the feature reads correctly.
    has_original: bool = False
    is_pdf: bool = False

class DocumentContent(BaseModel):
    id: str
    filename: str
    created_at: str
    text_content: str
    word_count: int
    has_original: bool = False
    is_pdf: bool = False

class DocumentOriginalMeta(BaseModel):
    """What the viewer needs before it can render anything.

    `available` is false for every degraded case — no stored file, a storage
    read failure, or a PDF we can't open — so the client has one branch rather
    than one per cause.
    """
    available: bool
    is_pdf: bool
    filename: str
    page_count: Optional[int] = None
    content_type: Optional[str] = None
    # Ready-to-use URLs rather than a bare token. A browser <img src> can't
    # send an Authorization header, so the grant has to travel in the query
    # string — and the server is the only side that already knows both the
    # user id and the API's public base, so building them here saves the
    # client from reassembling something it has no other reason to know.
    # `page_url_template` contains the literal "{page}" for the client to
    # substitute; every page shares one token.
    page_url_template: Optional[str] = None
    download_url: Optional[str] = None

class TutorSource(BaseModel):
    """One document in a tutor session's material (ROADMAP_LEARNING 3).

    Material arrives in sets — a week of a course is three decks plus a
    reading — so a session's source is a list of these, not one blob.
    """
    text_content: str
    # Shown to the student: a weak concept is only actionable if the summary
    # can name *which* file to go re-read.
    filename: str
    # Library id, when the material came from the library rather than a
    # fresh upload. Concepts remember it for spaced-repetition refreshers.
    document_id: Optional[str] = None

class TutorStartRequest(BaseModel):
    # Material for the session. `documents` is the general form; the singular
    # text_content/document_id below are the one-file shorthand, kept so the
    # upload path and older clients keep working. Exactly one is required —
    # the route normalizes both into a single list before anything downstream
    # sees them.
    documents: Optional[List[TutorSource]] = None
    text_content: str = ""
    subject: str
    # Session mode sets the mastery bar, not a question count:
    # "vibe_check" (lighter) or "locked_in" (deeper verification).
    mode: str = "vibe_check"
    # When set, restrict the session to these concepts (skips topic
    # extraction) — used by the summary's "practice these again" loop.
    concepts: Optional[List[str]] = None
    # Library id of the material, so this session's concepts remember their
    # source document (concept spaced repetition needs it for refreshers).
    document_id: Optional[str] = None
    # Client-generated id for stage-level progress polling (GET /progress/{id}).
    progress_id: Optional[str] = None

class TutorQuestion(BaseModel):
    # Deliberately excludes the concept name: the student shouldn't see
    # what's being probed or predict what comes next.
    question: str
    # Empty when answer_mode is "free_text" — the student types their answer.
    options: List[str] = []
    difficulty: str
    answer_mode: str = "multiple_choice"  # "multiple_choice" | "free_text"
    # Self-explanation follow-up (ROADMAP_LEARNING 2): not a real question —
    # a "why is that the answer?" prompt after a correct multiple-choice
    # pick. Free-text, skippable, doesn't advance the question count.
    is_explanation: bool = False
    # Teach-it-back (ROADMAP_LEARNING 4): the roles are flipped — this is a
    # confused-student misconception to correct, not a question to answer.
    is_teach_back: bool = False
    question_number: int

class ConceptState(BaseModel):
    concept: str
    mastery: float  # 0-1 estimate of understanding
    questions_asked: int
    questions_correct: int
    mastered: bool
    parked: bool = False  # repeatedly failed rechecks; needs a re-read, not more drilling
    resumed: bool = False  # seeded from a prior session's knowledge state
    # Filename this concept was extracted from (ROADMAP_LEARNING 3). "Go
    # re-read the material" is only actionable when the summary can say which
    # material. None for single-source sessions, where it'd be noise.
    source_document: Optional[str] = None

class TutorStartResponse(BaseModel):
    # No live concept states: knowledge state stays hidden until the summary.
    session_id: str
    question: TutorQuestion
    mode: str

class TutorAnswerRequest(BaseModel):
    session_id: str
    answer: str
    # Self-reported confidence ("low" | "medium" | "high"); scales the
    # mastery delta — confidently wrong drops harder, unsure right gains less.
    confidence: Optional[str] = None

class ConfidenceBucket(BaseModel):
    confidence: str  # "low" | "medium" | "high"
    answered: int
    correct: int

class ConceptCalibration(BaseModel):
    # One concept's answers at the flagged confidence level: overconfident
    # entries count answers said with high confidence, underconfident entries
    # answers said with low confidence.
    concept: str
    answered: int
    correct: int

class SessionCalibration(BaseModel):
    # Calibration feedback (ROADMAP_LEARNING 5): predicted vs. actual.
    by_confidence: List[ConfidenceBucket]
    overconfident: List[ConceptCalibration]   # said "certain", got it wrong
    underconfident: List[ConceptCalibration]  # said "not sure", got it right

class CorrectedMisconception(BaseModel):
    # A misconception the student argued down in teach-it-back mode, and has
    # therefore been cleared from their misconception memory.
    concept: str
    misconception: str

class TutorSessionSummary(BaseModel):
    total_questions: int
    correct_answers: int
    accuracy: float
    # Teach-it-back (ROADMAP_LEARNING 4): what the student unlearned. Always
    # empty outside teach-it-back sessions.
    misconceptions_corrected: List[CorrectedMisconception] = []
    concepts_mastered: List[str]
    concepts_weak: List[str]
    concepts_parked: List[str] = []
    concepts: List[ConceptState]
    # None when the student never moved the confidence selector off the
    # default — all-medium data says nothing about calibration.
    calibration: Optional[SessionCalibration] = None

class TutorAnswerResponse(BaseModel):
    correct: bool
    # "correct" | "partial" | "incorrect" — free-text answers can earn
    # partial credit (smaller mastery gain); multiple-choice never does.
    verdict: str = "incorrect"
    # For partial/incorrect free-text answers: what the answer missed.
    missing: Optional[str] = None
    correct_answer: str
    explanation: Optional[str] = None
    diagnosis: Optional[str] = None  # why the wrong answer was wrong; only set on incorrect answers
    # Teach-it-back (ROADMAP_LEARNING 4): which half of the correction landed.
    # Full credit needs both — spotting the error without stating the truth
    # (or vice versa) is partial. None outside teach-it-back.
    identified_error: Optional[bool] = None
    stated_correction: Optional[bool] = None
    # The misconception this correction retired, if it was one of the
    # student's own previously diagnosed ones.
    cleared_misconception: Optional[str] = None
    done: bool
    # One-time "want to wrap up?" offer after many questions.
    checkpoint: bool = False
    next_question: Optional[TutorQuestion] = None
    summary: Optional[TutorSessionSummary] = None

class TutorWrapRequest(BaseModel):
    session_id: str

class TutorWrapResponse(BaseModel):
    summary: TutorSessionSummary

# --- Spaced repetition for concepts (ROADMAP_LEARNING 6) ---

class DueConceptReview(BaseModel):
    id: str
    concept: str
    mastery: float
    subject: Optional[str] = None
    document_id: str
    document_filename: Optional[str] = None
    last_seen_at: Optional[str] = None
    review_due_at: str
    days_since_seen: Optional[int] = None

class DueConceptReviewsResponse(BaseModel):
    concepts: List[DueConceptReview]
    total_due: int

# --- Pretesting (ROADMAP_LEARNING 1) ---

class PretestStartRequest(BaseModel):
    text_content: str
    subject: str
    # Library id of the material, so pretested concepts remember their source
    # document (concept spaced repetition needs it for refreshers).
    document_id: Optional[str] = None
    # Client-generated id for stage-level progress polling (GET /progress/{id}).
    progress_id: Optional[str] = None

class PretestQuestion(BaseModel):
    # No concept name and no answer: a blind first probe, graded server-side.
    question: str
    options: List[str]
    question_number: int

class PretestStartResponse(BaseModel):
    pretest_id: str
    questions: List[PretestQuestion]
    total_questions: int

class PretestSubmitRequest(BaseModel):
    pretest_id: str
    # One answer per question, in question order.
    answers: List[str]

class PretestQuestionResult(BaseModel):
    question: str
    options: List[str]
    user_answer: str
    correct_answer: str
    correct: bool
    explanation: Optional[str] = None
    concept: str
    question_number: int

class PretestSubmitResponse(BaseModel):
    results: List[PretestQuestionResult]
    correct_answers: int
    total_questions: int
    # Concepts with at least one wrong answer — flagged in the summary shown
    # next ("pay attention to these").
    missed_concepts: List[str]

class Flashcard(BaseModel):
    front: str
    back: str
    category: Optional[str] = None

class FlashcardRequest(BaseModel):
    text_content: str
    num_cards: int
    subject: str
    card_type: str  # "definition", "concept", "fact", "mixed"

class FlashcardResponse(BaseModel):
    flashcards: List[Flashcard]
    total_cards: int
    subject: str
    card_type: str

# --- Spaced repetition (ROADMAP 4.1) ---

class DueFlashcard(BaseModel):
    id: str
    front: str
    back: str
    category: Optional[str] = None
    subject: str
    due_at: str
    repetitions: int

class DueFlashcardsResponse(BaseModel):
    cards: List[DueFlashcard]
    total_due: int

class FlashcardReviewRequest(BaseModel):
    grade: str  # "again" | "hard" | "good" | "easy"

class FlashcardReviewResponse(BaseModel):
    interval_days: float
    ease: float
    repetitions: int
    due_at: str

# --- Podcast (ROADMAP_HONEN 3) ---

class PodcastSegment(BaseModel):
    # "host" asks the questions a student would ask; "explainer" answers.
    # tts_service maps these two roles to voices, so no voice id ever reaches
    # the API surface.
    speaker: str  # "host" | "explainer"
    text: str
    # Playback offset in seconds, measured from the synthesized audio rather
    # than estimated from word counts — so follow-along highlighting and
    # click-to-seek land on the right turn. Null for a script-only episode,
    # where there is no audio to index into.
    start_seconds: Optional[float] = None

class PodcastResponse(BaseModel):
    id: str
    title: str
    subject: str
    # Also the follow-along transcript the player renders, which is why the
    # script is persisted alongside the audio rather than discarded after
    # synthesis.
    segments: List[PodcastSegment]
    # Presigned S3 URL, or null when synthesis failed. Null with segments
    # populated is the deliberate degraded case: the script survived, so the
    # student still gets a readable episode instead of nothing.
    audio_url: Optional[str] = None
    duration_seconds: Optional[int] = None
    # User-safe explanation of why audio is missing (out of credit, bad key),
    # so the player can say something true rather than looking broken.
    audio_error: Optional[str] = None
    created_at: str

class PodcastInfo(BaseModel):
    """One episode in the library listing — no script, no audio."""
    id: str
    title: str
    subject: str
    duration_seconds: Optional[int] = None
    created_at: str
