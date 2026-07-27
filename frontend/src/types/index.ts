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
  // Set by /ingest-url when the source exceeded the extraction budget and
  // its tail was dropped. Long lecture transcripts routinely hit this, so
  // the UI has to say so rather than silently studying two-thirds of a video.
  truncated?: boolean;
}

// Documents library (stored uploads, re-studiable without re-uploading)
export interface DocumentInfo {
  id: string;
  filename: string;
  created_at: string;
  chunk_count: number;
  // Whether the file as uploaded was kept, and whether it can be paged
  // through. False for documents ingested from a URL (no file ever existed)
  // and for anything uploaded before originals were stored.
  has_original: boolean;
  is_pdf: boolean;
}

export interface DocumentContent {
  id: string;
  filename: string;
  created_at: string;
  text_content: string;
  word_count: number;
  has_original: boolean;
  is_pdf: boolean;
}

// What the viewer needs before it can render. `available: false` covers every
// reason there's nothing to show — no stored file, an unreadable one, a
// storage failure — so the UI has one branch rather than one per cause.
export interface DocumentOriginalMeta {
  available: boolean;
  is_pdf: boolean;
  filename: string;
  page_count: number | null;
  content_type: string | null;
  // Ready-to-use absolute URLs carrying a signed grant in the query string,
  // because an <img src> can't send an Authorization header. Substitute
  // "{page}" in the template; all pages share one token.
  page_url_template: string | null;
  download_url: string | null;
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

// Sets the session's mastery bar, not a question count. 'teach_back' also
// flips the roles: the tutor states misconceptions and you correct them.
export type TutorMode = 'vibe_check' | 'locked_in' | 'teach_back';

export interface TutorQuestion {
  // No concept name: the student shouldn't see what's being probed.
  question: string;
  // Empty when answer_mode is 'free_text' — the student types their answer.
  options: string[];
  difficulty: string;
  answer_mode?: 'multiple_choice' | 'free_text';
  // Self-explanation follow-up: a skippable "why is that the answer?"
  // prompt after a correct pick — not a real question.
  is_explanation?: boolean;
  // Teach-it-back: a confused-student misconception to correct, not a
  // question to answer.
  is_teach_back?: boolean;
  question_number: number;
}

// One document in a tutor session's material (ROADMAP_LEARNING 3). A
// single-document session is just a one-element list.
export interface TutorSource {
  text_content: string;
  filename: string;
  document_id?: string | null;
}

export interface ConceptState {
  concept: string;
  mastery: number; // 0-1 estimate of understanding
  questions_asked: number;
  questions_correct: number;
  mastered: boolean;
  parked?: boolean; // repeatedly failed rechecks; re-read the material
  resumed?: boolean; // seeded from a prior session's knowledge state
  // Which file this concept came from. Only set when the session drew on
  // more than one document — naming the file otherwise is noise.
  source_document?: string | null;
}

export interface TutorStartResponse {
  // No live concept states: knowledge state stays hidden until the summary.
  session_id: string;
  question: TutorQuestion;
  mode: TutorMode;
}

// --- Voice roleplay (ROADMAP_HONEN 4) ---

export interface RoleplayCharacter {
  name: string;
  role: string;
}

// The rubric as the client may see it: names only. Each criterion's
// `evidence` — the source fact that makes it checkable — stays server-side.
export interface RoleplayCriterion {
  id: string;
  name: string;
}

export interface RoleplayScenario {
  title?: string | null;
  character?: RoleplayCharacter | null;
  situation?: string | null;
  student_role?: string | null;
  opening_line?: string | null;
  // Shown before the scene starts, on purpose: knowing what a good
  // explanation covers is the pedagogy, not a leak.
  rubric: RoleplayCriterion[];
}

export interface RoleplayStartResponse {
  session_id: string;
  scenario: RoleplayScenario;
  opening_line?: string | null;
  grounding_concepts: string[];
}

export interface RoleplayTurn {
  role: 'student' | 'character';
  text: string;
  turn_id: number;
}

export interface RoleplayGradedCriterion {
  id: string;
  name: string;
  met: boolean;
  // Never set when met is false — the backend downgrades a quoteless "met".
  evidence_quote?: string | null;
  feedback?: string | null;
}

export interface RoleplayResult {
  // Null when the scene couldn't be graded: an honest absence, never a zero
  // the student didn't earn and never an all-met result they didn't earn.
  score?: number | null;
  met_count?: number | null;
  total?: number | null;
  criteria: RoleplayGradedCriterion[];
  summary?: string | null;
  // Set only when graded is false: why there's no score, in plain language.
  message?: string | null;
  graded: boolean;
  // Always present, graded or not.
  transcript: RoleplayTurn[];
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

// A misconception argued down in teach-it-back mode, now cleared from the
// user's misconception memory.
export interface CorrectedMisconception {
  concept: string;
  misconception: string;
}

export interface TutorSessionSummary {
  total_questions: number;
  correct_answers: number;
  accuracy: number;
  // What the student unlearned; empty outside teach-it-back sessions.
  misconceptions_corrected?: CorrectedMisconception[];
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
  // Teach-it-back: which half of the correction landed (both are needed for
  // full credit). Null outside teach-it-back.
  identified_error?: boolean | null;
  stated_correction?: boolean | null;
  // The misconception this correction retired from memory, if any.
  cleared_misconception?: string | null;
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

// How long an episode should run. The backend turns this into a target script
// length rather than a hard duration — synthesis speed varies by voice.
export type PodcastLength = 'short' | 'medium' | 'long';

// What the student asked us to produce from their material. `summary`,
// `flashcards`, `quiz` and `podcast` are artifacts — passive things that end up
// as tabs on the lesson screen. `pretest` and `tutor` are interactive flows:
// selecting them means that flow runs before generation (pretest) or is offered
// from the lesson (tutor), so neither can be a tab.
export type StudyOutput = 'summary' | 'flashcards' | 'quiz' | 'pretest' | 'tutor' | 'podcast';

// Outputs that become a tab on the lesson screen, in tab order.
export const ARTIFACT_OUTPUTS: StudyOutput[] = ['summary', 'flashcards', 'quiz', 'podcast'];

export type StudyPreset = 'quick_review' | 'exam_prep' | 'deep_dive' | 'test_first' | 'custom';

// Named starting points for the output selection. The student can toggle any
// individual output afterwards, which drops them to `custom`.
export const PRESETS: Record<Exclude<StudyPreset, 'custom'>, {
  label: string;
  description: string;
  outputs: StudyOutput[];
}> = {
  quick_review: {
    label: 'Quick review',
    description: 'A fast pass over the material',
    outputs: ['summary', 'flashcards'],
  },
  exam_prep: {
    label: 'Exam prep',
    description: 'Adds graded practice questions',
    outputs: ['summary', 'flashcards', 'quiz'],
  },
  deep_dive: {
    label: 'Deep dive',
    description: 'Mastery-oriented, with the tutor',
    outputs: ['summary', 'quiz', 'tutor'],
  },
  test_first: {
    label: 'Test me first',
    description: 'Retrieval practice before you read',
    outputs: ['pretest', 'summary', 'flashcards'],
  },
};

export interface StudyFormData {
  numQuestions: number;
  numCards: number;
  subjectId: string | null;
  subjectName: string;
  difficulty: Difficulty;
  summaryType: SummaryType;
  cardType: CardType;
  tutorMode: TutorMode;
  podcastLength: PodcastLength;
  // What to generate, and which preset produced that selection.
  outputs: StudyOutput[];
  preset: StudyPreset;
  // Free text from the focus bar — what the student wants emphasized, in their
  // own words. Empty means "no steer", and generation proceeds as before.
  focusNote: string;
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

// Two-voice episode. The host asks the questions a student would ask; the
// explainer answers them.
export type PodcastSpeaker = 'host' | 'explainer';

export interface PodcastSegment {
  speaker: PodcastSpeaker;
  text: string;
  // Playback offset in seconds, measured from the synthesized audio. Null on a
  // script-only episode (synthesis failed), where there is nothing to index
  // into — the player falls back to estimating boundaries by word count.
  start_seconds: number | null;
}

export interface PodcastResponse {
  id: string;
  title: string;
  subject: string;
  segments: PodcastSegment[];
  // Presigned S3 URL, or null when synthesis failed after the script was
  // written. That degraded case is expected, not exceptional: `segments` is
  // still populated, so the transcript remains readable and `audio_error`
  // carries a message safe to show the student. Never assume this is set.
  audio_url: string | null;
  duration_seconds: number | null;
  audio_error: string | null;
  created_at: string;
}

// Library-listing shape — no segments, so the podcasts list stays cheap.
export interface PodcastInfo {
  id: string;
  title: string;
  subject: string;
  duration_seconds: number | null;
  created_at: string;
}