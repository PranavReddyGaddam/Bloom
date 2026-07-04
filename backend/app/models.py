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
    previous_score: Optional[int] = None

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
    filename: str
    uploaded_at: str
    similarity: float  # 0-1, best matching chunk pair
    overlap: float  # 0-1, fraction of the new upload's chunks that matched

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