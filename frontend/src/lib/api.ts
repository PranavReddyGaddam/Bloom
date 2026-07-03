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
  Subject
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
  async uploadPDF(file: File): Promise<PDFUploadResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE_URL}/upload-pdf`, {
      method: 'POST',
      headers: await authHeaders(),
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new APIError(`Failed to upload PDF: ${error}`, response.status);
    }

    return response.json();
  },

  async generateSummary(
    textContent: string,
    summaryType: SummaryType,
    subject?: string
  ): Promise<SummaryResponse> {
    const formData = new FormData();
    formData.append('text_content', textContent);
    formData.append('summary_type', summaryType);
    if (subject) {
      formData.append('subject', subject);
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
    previousScore?: number
  ): Promise<QuizResponse> {
    const formData = new FormData();
    formData.append('text_content', textContent);
    formData.append('num_questions', numQuestions.toString());
    formData.append('subject', subject);
    formData.append('difficulty', difficulty);
    if (previousScore !== undefined) {
      formData.append('previous_score', previousScore.toString());
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

  async getMyRecentAttempts(): Promise<RecentAttempt[]> {
    const response = await fetch(`${API_BASE_URL}/me/recent-attempts`, {
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
    cardType: CardType
  ): Promise<FlashcardResponse> {
    const formData = new FormData();
    formData.append('text_content', textContent);
    formData.append('num_cards', numCards.toString());
    formData.append('subject', subject);
    formData.append('card_type', cardType);

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
  }
};

export { APIError };
