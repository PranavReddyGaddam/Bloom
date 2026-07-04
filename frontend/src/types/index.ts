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