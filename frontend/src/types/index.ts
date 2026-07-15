export interface QuizQuestion {
  question: string;
  options: string[];
  correct_answer: string;
  explanation?: string;
  category?: string;
  difficulty?: string;
}

export interface SummaryResponse {
  summary: string;
  tags: string[];
  summary_type: string;
  word_count: number;
}

export interface QuizResponse {
  questions: QuizQuestion[];
  total_questions: number;
  difficulty: string;
  subject: string;
  estimated_time: number;
}

export interface QuizResult {
  score: number;
  correct_answers: number;
  total_questions: number;
  feedback: string;
  suggestion: string;
  passed: boolean;
  attempt_id?: string;
}

export interface BreakdownEntry {
  label: string;
  correct: number;
  total: number;
}

export interface AttemptBreakdown {
  by_category: BreakdownEntry[];
  by_difficulty: BreakdownEntry[];
}

export interface RecentAttempt {
  id: string;
  subject: string;
  difficulty: string;
  score: number;
  total_questions: number;
  created_at: string;
}

export interface UserStats {
  total_attempts: number;
  average_score: number;
  best_category: string | null;
  recent_attempts: RecentAttempt[];
}

export interface ScoreTrendPoint {
  attempt_id: string;
  subject: string;
  score: number;
  created_at: string;
}

export interface AccuracyEntry {
  label: string;
  correct: number;
  total: number;
  accuracy: number;
}

export interface SubjectCount {
  label: string;
  count: number;
}

export interface UserAnalytics {
  score_trend: ScoreTrendPoint[];
  by_category: AccuracyEntry[];
  by_difficulty: AccuracyEntry[];
  by_subject: SubjectCount[];
  by_subject_accuracy: AccuracyEntry[];
}

export interface Subject {
  id: string;
  name: string;
  created_at: string;
}

export interface RecapQuestion {
  question_text: string;
  category?: string;
  difficulty?: string;
  user_answer: string;
  correct_answer: string;
  is_correct: boolean;
  question_index: number;
}

export interface AttemptRecap {
  id: string;
  subject: string;
  difficulty: string;
  score: number;
  total_questions: number;
  created_at: string;
  questions: RecapQuestion[];
}

export interface SimilarDocument {
  document_id: string;
  filename: string;
  uploaded_at: string;
  similarity: number; // 0-1, best matching chunk pair
  overlap: number; // 0-1, fraction of the new upload that matched
}

export interface PDFUploadResponse {
  filename: string;
  text_content: string;
  word_count: number;
  similar_documents?: SimilarDocument[];
  // Id of this upload in the documents library (memory layer); null if
  // storing failed (best-effort).
  document_id?: string | null;
}

// Documents library (stored uploads, re-studiable without re-uploading)
export interface DocumentInfo {
  id: string;
  filename: string;
  created_at: string;
  chunk_count: number;
}

export interface DocumentContent {
  id: string;
  filename: string;
  created_at: string;
  text_content: string;
  word_count: number;
}

// Spaced repetition
export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

export interface DueFlashcard {
  id: string;
  front: string;
  back: string;
  category?: string | null;
  subject: string;
  due_at: string;
  repetitions: number;
}

export interface DueFlashcardsResponse {
  cards: DueFlashcard[];
  total_due: number;
}

export interface FlashcardReviewResponse {
  interval_days: number;
  ease: number;
  repetitions: number;
  due_at: string;
}

// Spaced repetition for concepts: a concept whose review schedule says it's
// due, with its source document so one click can start a refresher.
export interface DueConceptReview {
  id: string;
  concept: string;
  mastery: number;
  subject?: string | null;
  document_id: string;
  document_filename?: string | null;
  last_seen_at?: string | null;
  review_due_at: string;
  days_since_seen?: number | null;
}

export interface DueConceptReviewsResponse {
  concepts: DueConceptReview[];
  total_due: number;
}

// Pretesting (retrieval before re-reading): a short quiz taken before the
// summary is shown; results calibrate concept mastery and flag weak spots.
export interface PretestQuestion {
  // No concept name and no answer: a blind first probe, graded server-side.
  question: string;
  options: string[];
  question_number: number;
}

export interface PretestStartResponse {
  pretest_id: string;
  questions: PretestQuestion[];
  total_questions: number;
}

export interface PretestQuestionResult {
  question: string;
  options: string[];
  user_answer: string;
  correct_answer: string;
  correct: boolean;
  explanation?: string | null;
  concept: string;
  question_number: number;
}

export interface PretestSubmitResponse {
  results: PretestQuestionResult[];
  correct_answers: number;
  total_questions: number;
  // Concepts with at least one wrong answer — flagged in the summary.
  missed_concepts: string[];
}

// Sets the session's mastery bar, not a question count.
export type TutorMode = 'vibe_check' | 'locked_in';

export interface TutorQuestion {
  // No concept name: the student shouldn't see what's being probed.
  question: string;
  // Empty when answer_mode is 'free_text' — the student types their answer.
  options: string[];
  difficulty: string;
  answer_mode?: 'multiple_choice' | 'free_text';
  question_number: number;
}

export interface ConceptState {
  concept: string;
  mastery: number; // 0-1 estimate of understanding
  questions_asked: number;
  questions_correct: number;
  mastered: boolean;
  parked?: boolean; // repeatedly failed rechecks; re-read the material
  resumed?: boolean; // seeded from a prior session's knowledge state
}

export interface TutorStartResponse {
  // No live concept states: knowledge state stays hidden until the summary.
  session_id: string;
  question: TutorQuestion;
  mode: TutorMode;
}

export interface ConfidenceBucket {
  confidence: 'low' | 'medium' | 'high';
  answered: number;
  correct: number;
}

// One concept's answers at the flagged confidence level (high for
// overconfident entries, low for underconfident ones).
export interface ConceptCalibration {
  concept: string;
  answered: number;
  correct: number;
}

// Calibration feedback: how self-reported confidence lined up with results.
export interface SessionCalibration {
  by_confidence: ConfidenceBucket[];
  overconfident: ConceptCalibration[];   // said "certain", got it wrong
  underconfident: ConceptCalibration[];  // said "not sure", got it right
}

export interface TutorSessionSummary {
  total_questions: number;
  correct_answers: number;
  accuracy: number;
  concepts_mastered: string[];
  concepts_weak: string[];
  concepts_parked?: string[];
  concepts: ConceptState[];
  // Null when every answer used the default confidence — no signal.
  calibration?: SessionCalibration | null;
}

export interface TutorAnswerResponse {
  correct: boolean;
  // 'correct' | 'partial' | 'incorrect' — free-text answers can earn partial credit.
  verdict?: 'correct' | 'partial' | 'incorrect';
  // For partial/incorrect free-text answers: what the answer missed.
  missing?: string | null;
  correct_answer: string;
  explanation?: string | null;
  diagnosis?: string | null; // why the wrong answer was wrong; only set on incorrect answers
  done: boolean;
  checkpoint?: boolean; // one-time "want to wrap up?" offer
  next_question?: TutorQuestion | null;
  summary?: TutorSessionSummary | null;
}

export type SummaryType = 'short' | 'bullet_points' | 'detailed';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface QuizFormData {
  numQuestions: number;
  subject: string;
  difficulty: Difficulty;
  summaryType: SummaryType;
}

export type CardType = 'definition' | 'concept' | 'fact' | 'mixed';

export interface StudyFormData {
  numQuestions: number;
  numCards: number;
  subjectId: string | null;
  subjectName: string;
  difficulty: Difficulty;
  summaryType: SummaryType;
  cardType: CardType;
  tutorMode: TutorMode;
}

export interface UserAnswer {
  questionIndex: number;
  selectedOption: string;
}

export interface Flashcard {
  front: string;
  back: string;
  category?: string;
}

export interface FlashcardResponse {
  flashcards: Flashcard[];
  total_cards: number;
  subject: string;
  card_type: string;
} 