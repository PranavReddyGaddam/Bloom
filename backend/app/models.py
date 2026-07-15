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

class DocumentContent(BaseModel):
    id: str
    filename: str
    created_at: str
    text_content: str
    word_count: int

class TutorStartRequest(BaseModel):
    text_content: str
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
    question_number: int

class ConceptState(BaseModel):
    concept: str
    mastery: float  # 0-1 estimate of understanding
    questions_asked: int
    questions_correct: int
    mastered: bool
    parked: bool = False  # repeatedly failed rechecks; needs a re-read, not more drilling
    resumed: bool = False  # seeded from a prior session's knowledge state

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

class TutorSessionSummary(BaseModel):
    total_questions: int
    correct_answers: int
    accuracy: float
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