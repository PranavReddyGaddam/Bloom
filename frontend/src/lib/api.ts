import {
  PDFUploadResponse,
  SummaryResponse,
  QuizResponse,
  QuizResult,
  QuizQuestion,
  SummaryType,
  Difficulty,
  FlashcardResponse,
  CardType,
  AttemptBreakdown,
  UserStats,
  UserAnalytics,
  RecentAttempt,
  AttemptRecap,
  Subject,
  TutorStartResponse,
  TutorAnswerResponse,
  TutorSessionSummary,
  TutorMode,
  TutorSource,
  DocumentInfo,
  DocumentContent,
  DocumentOriginalMeta,
  DueFlashcardsResponse,
  FlashcardReviewResponse,
  ReviewGrade,
  PretestStartResponse,
  PretestSubmitResponse,
  DueConceptReviewsResponse,
  PodcastLength,
  PodcastResponse,
  PodcastInfo
} from '@/types';
import { createClient } from '@/lib/supabase/client';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

class APIError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'APIError';
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export const api = {
  // Stage-level progress of a long-running operation. The id is generated
  // client-side (crypto.randomUUID) and passed with the slow request; poll
  // this while it's in flight. Unknown ids return { stage: null }.
  async getProgress(progressId: string): Promise<{ stage: string | null }> {
    const response = await fetch(`${API_BASE_URL}/progress/${progressId}`);
    if (!response.ok) {
      throw new APIError('Failed to fetch progress', response.status);
    }
    return response.json();
  },

  // `signal` only detaches the client from the request — the backend runs the
  // extraction to completion regardless. Callers should say "Remove", not
  // imply they stopped the work.
  async uploadPDF(file: File, progressId?: string, signal?: AbortSignal): Promise<PDFUploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    if (progressId) {
      formData.append('progress_id', progressId);
    }

    const response = await fetch(`${API_BASE_URL}/upload-pdf`, {
      method: 'POST',
      headers: await authHeaders(),
      body: formData,
      signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to upload PDF: ${error}`, response.status);
    }

    return response.json();
  },

  // Ingest a YouTube video, direct media link, or article URL. Returns the
  // same shape as uploadPDF so callers reuse one path — a link becomes a
  // document like any other.
  async ingestUrl(url: string, progressId?: string, signal?: AbortSignal): Promise<PDFUploadResponse> {
    const response = await fetch(`${API_BASE_URL}/ingest-url`, {
      method: 'POST',
      headers: {
        ...(await authHeaders()),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, progress_id: progressId }),
      signal,
    });

    if (!response.ok) {
      // 422 carries a message written for the student ("no captions", "page
      // is behind a login"); surface it rather than a generic failure.
      let detail = '';
      try {
        detail = (await response.json())?.detail ?? '';
      } catch {
        detail = '';
      }
      throw new APIError(detail || 'Failed to ingest that link', response.status);
    }

    return response.json();
  },

  async generateSummary(
    textContent: string,
    summaryType: SummaryType,
    subject?: string,
    progressId?: string,
    hasOverlap?: boolean,
    focusConcepts?: string[],
    focusNote?: string
  ): Promise<SummaryResponse> {
    const formData = new FormData();
    formData.append('text_content', textContent);
    formData.append('summary_type', summaryType);
    if (subject) {
      formData.append('subject', subject);
    }
    if (progressId) {
      formData.append('progress_id', progressId);
    }
    if (hasOverlap) {
      formData.append('has_overlap', 'true');
    }
    // Pretest-informed emphasis: concepts the user just missed get extra
    // coverage in the generated summary.
    if (focusConcepts && focusConcepts.length > 0) {
      formData.append('focus_concepts', JSON.stringify(focusConcepts));
    }
    // Free-text steer from the focus bar, passed to the prompt verbatim.
    if (focusNote && focusNote.trim()) {
      formData.append('focus_note', focusNote.trim());
    }

    const response = await fetch(`${API_BASE_URL}/generate-summary`, {
      method: 'POST',
      headers: await authHeaders(),
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to generate summary: ${error}`, response.status);
    }

    return response.json();
  },

  async generateQuiz(
    textContent: string,
    numQuestions: number,
    subject: string,
    difficulty: Difficulty,
    progressId?: string,
    hasOverlap?: boolean,
    focusNote?: string
  ): Promise<QuizResponse> {
    const formData = new FormData();
    formData.append('text_content', textContent);
    formData.append('num_questions', numQuestions.toString());
    formData.append('subject', subject);
    formData.append('difficulty', difficulty);
    if (progressId) {
      formData.append('progress_id', progressId);
    }
    if (hasOverlap) {
      formData.append('has_overlap', 'true');
    }
    if (focusNote && focusNote.trim()) {
      formData.append('focus_note', focusNote.trim());
    }

    const response = await fetch(`${API_BASE_URL}/generate-quiz`, {
      method: 'POST',
      headers: await authHeaders(),
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to generate quiz: ${error}`, response.status);
    }

    return response.json();
  },

  async checkAnswers(
    questions: QuizQuestion[],
    userAnswers: string[],
    subjectId: string,
    difficulty: Difficulty
  ): Promise<QuizResult> {
    const response = await fetch(`${API_BASE_URL}/check-answers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        questions,
        user_answers: userAnswers,
        subject_id: subjectId,
        difficulty,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to check answers: ${error}`, response.status);
    }

    return response.json();
  },

  async getAttemptBreakdown(attemptId: string): Promise<AttemptBreakdown> {
    const response = await fetch(`${API_BASE_URL}/quiz-attempts/${attemptId}/breakdown`, {
      headers: await authHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to fetch breakdown: ${error}`, response.status);
    }

    return response.json();
  },

  async getMyStats(): Promise<UserStats> {
    const response = await fetch(`${API_BASE_URL}/me/stats`, {
      headers: await authHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to fetch stats: ${error}`, response.status);
    }

    return response.json();
  },

  async getMyAnalytics(): Promise<UserAnalytics> {
    const response = await fetch(`${API_BASE_URL}/me/analytics`, {
      headers: await authHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to fetch analytics: ${error}`, response.status);
    }

    return response.json();
  },

  async getMyRecentAttempts(limit?: number): Promise<RecentAttempt[]> {
    const query = limit ? `?limit=${limit}` : '';
    const response = await fetch(`${API_BASE_URL}/me/recent-attempts${query}`, {
      headers: await authHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to fetch recent attempts: ${error}`, response.status);
    }

    return response.json();
  },

  async getAttemptRecap(attemptId: string): Promise<AttemptRecap> {
    const response = await fetch(`${API_BASE_URL}/quiz-attempts/${attemptId}/recap`, {
      headers: await authHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to fetch attempt recap: ${error}`, response.status);
    }

    return response.json();
  },

  async getSubjects(): Promise<Subject[]> {
    const response = await fetch(`${API_BASE_URL}/subjects`, {
      headers: await authHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to fetch subjects: ${error}`, response.status);
    }

    return response.json();
  },

  async createSubject(name: string): Promise<Subject> {
    const response = await fetch(`${API_BASE_URL}/subjects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to create subject: ${error}`, response.status);
    }

    return response.json();
  },

  async deleteSubject(subjectId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/subjects/${subjectId}`, {
      method: 'DELETE',
      headers: await authHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to delete subject: ${error}`, response.status);
    }
  },

  // --- Pretesting (retrieval before re-reading) ---

  async startPretest(
    textContent: string,
    subject: string,
    progressId?: string,
    documentId?: string | null
  ): Promise<PretestStartResponse> {
    const response = await fetch(`${API_BASE_URL}/pretest/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        text_content: textContent,
        subject,
        ...(progressId ? { progress_id: progressId } : {}),
        ...(documentId ? { document_id: documentId } : {}),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to start pretest: ${error}`, response.status);
    }

    return response.json();
  },

  async submitPretest(pretestId: string, answers: string[]): Promise<PretestSubmitResponse> {
    const response = await fetch(`${API_BASE_URL}/pretest/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ pretest_id: pretestId, answers }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to submit pretest: ${error}`, response.status);
    }

    return response.json();
  },

  async startTutorSession(
    textContent: string,
    subject: string,
    mode: TutorMode,
    concepts?: string[],
    progressId?: string,
    documentId?: string | null,
    // Multi-document sessions (ROADMAP_LEARNING 3). When set, this is the
    // session's material and textContent is ignored; the singular fields
    // remain the one-file path (fresh uploads, concept refreshers).
    documents?: TutorSource[]
  ): Promise<TutorStartResponse> {
    const response = await fetch(`${API_BASE_URL}/tutor/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        text_content: textContent,
        subject,
        mode,
        ...(documents && documents.length > 0 ? { documents } : {}),
        ...(concepts && concepts.length > 0 ? { concepts } : {}),
        ...(progressId ? { progress_id: progressId } : {}),
        ...(documentId ? { document_id: documentId } : {}),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to start tutor session: ${error}`, response.status);
    }

    return response.json();
  },

  async getTutorSession(sessionId: string): Promise<TutorStartResponse> {
    const response = await fetch(`${API_BASE_URL}/tutor/session/${sessionId}`, {
      headers: { ...(await authHeaders()) },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to resume tutor session: ${error}`, response.status);
    }

    return response.json();
  },

  async wrapTutorSession(sessionId: string): Promise<TutorSessionSummary> {
    const response = await fetch(`${API_BASE_URL}/tutor/wrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ session_id: sessionId }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to wrap tutor session: ${error}`, response.status);
    }

    const data = await response.json();
    return data.summary;
  },

  async submitTutorAnswer(sessionId: string, answer: string, confidence?: string): Promise<TutorAnswerResponse> {
    const response = await fetch(`${API_BASE_URL}/tutor/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ session_id: sessionId, answer, ...(confidence ? { confidence } : {}) }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to submit answer: ${error}`, response.status);
    }

    return response.json();
  },

  async healthCheck(): Promise<{ status: string; service: string }> {
    const response = await fetch(`${API_BASE_URL}/health`);

    if (!response.ok) {
      throw new APIError('Health check failed', response.status);
    }

    return response.json();
  },

  async generateFlashcards(
    textContent: string,
    numCards: number,
    subject: string,
    cardType: CardType,
    documentId?: string | null,
    progressId?: string,
    focusNote?: string
  ): Promise<FlashcardResponse> {
    const formData = new FormData();
    formData.append('text_content', textContent);
    formData.append('num_cards', numCards.toString());
    formData.append('subject', subject);
    formData.append('card_type', cardType);
    if (documentId) {
      formData.append('document_id', documentId);
    }
    if (progressId) {
      formData.append('progress_id', progressId);
    }
    if (focusNote && focusNote.trim()) {
      formData.append('focus_note', focusNote.trim());
    }

    const response = await fetch(`${API_BASE_URL}/generate-flashcards`, {
      method: 'POST',
      headers: await authHeaders(),
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to generate flashcards: ${error}`, response.status);
    }

    return response.json();
  },

  // --- Podcast ---

  // Slow: writes the script, then synthesizes both voices. Pass a progressId
  // and poll getProgress so the wait is legible. A resolved promise doesn't
  // mean there's audio — check `audio_url`/`audio_error` on the result.
  async generatePodcast(
    textContent: string,
    subject: string,
    length: PodcastLength,
    documentId?: string | null,
    progressId?: string,
    focusNote?: string
  ): Promise<PodcastResponse> {
    const formData = new FormData();
    formData.append('text_content', textContent);
    formData.append('subject', subject);
    formData.append('length', length);
    if (documentId) {
      formData.append('document_id', documentId);
    }
    if (progressId) {
      formData.append('progress_id', progressId);
    }
    if (focusNote && focusNote.trim()) {
      formData.append('focus_note', focusNote.trim());
    }

    const response = await fetch(`${API_BASE_URL}/generate-podcast`, {
      method: 'POST',
      headers: await authHeaders(),
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to generate podcast: ${error}`, response.status);
    }

    return response.json();
  },

  async listPodcasts(): Promise<PodcastInfo[]> {
    const response = await fetch(`${API_BASE_URL}/me/podcasts`, {
      headers: await authHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to fetch podcasts: ${error}`, response.status);
    }

    return response.json();
  },

  // Re-fetch a stored episode. The audio URL is presigned and expires, so this
  // is also how a previously-listened episode gets a fresh playable link.
  async getPodcast(id: string): Promise<PodcastResponse> {
    const response = await fetch(`${API_BASE_URL}/podcasts/${id}`, {
      headers: await authHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to fetch podcast: ${error}`, response.status);
    }

    return response.json();
  },

  // --- Documents library ---

  async getMyDocuments(): Promise<DocumentInfo[]> {
    const response = await fetch(`${API_BASE_URL}/me/documents`, {
      headers: await authHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to fetch documents: ${error}`, response.status);
    }

    return response.json();
  },

  async getDocumentContent(documentId: string): Promise<DocumentContent> {
    const response = await fetch(`${API_BASE_URL}/documents/${documentId}/content`, {
      headers: await authHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to fetch document: ${error}`, response.status);
    }

    return response.json();
  },

  // Whether a stored upload still has its original file, and what it takes to
  // display it. Returns a media token the page/download URLs carry, so the
  // viewer authenticates once and then loads images for the token's lifetime.
  async getDocumentOriginalMeta(documentId: string): Promise<DocumentOriginalMeta> {
    const response = await fetch(`${API_BASE_URL}/documents/${documentId}/original/meta`, {
      headers: await authHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to fetch document details: ${error}`, response.status);
    }

    return response.json();
  },

  async deleteDocument(documentId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/documents/${documentId}`, {
      method: 'DELETE',
      headers: await authHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to delete document: ${error}`, response.status);
    }
  },

  // --- Spaced repetition ---

  async getDueFlashcards(): Promise<DueFlashcardsResponse> {
    const response = await fetch(`${API_BASE_URL}/me/flashcards/due`, {
      headers: await authHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to fetch due flashcards: ${error}`, response.status);
    }

    return response.json();
  },

  // Concepts whose spaced-review schedule says they're due, for the
  // refresher banner on the upload page.
  async getDueConcepts(): Promise<DueConceptReviewsResponse> {
    const response = await fetch(`${API_BASE_URL}/me/concepts/due`, {
      headers: await authHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to fetch due concepts: ${error}`, response.status);
    }

    return response.json();
  },

  async reviewFlashcard(cardId: string, grade: ReviewGrade): Promise<FlashcardReviewResponse> {
    const response = await fetch(`${API_BASE_URL}/flashcards/${cardId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ grade }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to record review: ${error}`, response.status);
    }

    return response.json();
  }
};

export { APIError };
