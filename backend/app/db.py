import os
from typing import Dict, List
from supabase import create_client, Client

from .models import QuizQuestion

PLACEHOLDER_USER_ID = "00000000-0000-0000-0000-000000000001"

_client: Client = None


def _get_client() -> Client:
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required")
        _client = create_client(url, key)
    return _client


def get_or_create_user(external_id: str) -> str:
    """Look up the public.users row for a Supabase Auth user, creating one
    on first sight. Returns the public.users.id (not the external_id).
    """
    client = _get_client()

    existing = client.table("users").select("id").eq("external_id", external_id).execute()
    if existing.data:
        return existing.data[0]["id"]

    created = client.table("users").insert({"external_id": external_id}).execute()
    return created.data[0]["id"]


def create_subject(external_id: str, name: str) -> Dict:
    """Create a subject owned by the user, or return the existing one if a
    subject with this name (case-insensitive) already exists — idempotent
    "create or get" so the frontend doesn't need a separate existence check.
    """
    client = _get_client()
    user_id = get_or_create_user(external_id)

    name = name.strip()
    existing = (
        client.table("subjects")
        .select("id, name, created_at")
        .eq("user_id", user_id)
        .ilike("name", name)
        .execute()
        .data
    )
    if existing:
        return existing[0]

    created = client.table("subjects").insert({"user_id": user_id, "name": name}).execute()
    return created.data[0]


def list_subjects(external_id: str) -> List[Dict]:
    """All subjects owned by the requesting user."""
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return []
    user_id = user.data[0]["id"]

    return (
        client.table("subjects")
        .select("id, name, created_at")
        .eq("user_id", user_id)
        .order("name")
        .execute()
        .data
    )


def delete_subject(subject_id: str, external_id: str) -> bool:
    """Ownership-scoped subject delete. Attempts referencing this subject
    have subject_id set to null by the DB's ON DELETE SET NULL — they
    survive and fall into "Uncategorized" in subject-grouped views, never
    deleted themselves.
    """
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return False
    user_id = user.data[0]["id"]

    subject = client.table("subjects").select("id").eq("id", subject_id).eq("user_id", user_id).execute()
    if not subject.data:
        return False

    client.table("subjects").delete().eq("id", subject_id).execute()
    return True


def record_quiz_attempt(
    subject_id: str,
    difficulty: str,
    questions: List[QuizQuestion],
    user_answers: List[str],
    user_id: str = PLACEHOLDER_USER_ID,
) -> Dict:
    """Score a quiz, persist the attempt + per-question results, and return
    the same aggregate result shape the frontend already expects, plus the
    new attempt_id.
    """
    client = _get_client()

    subject_row = client.table("subjects").select("name").eq("id", subject_id).execute().data
    subject_name = subject_row[0]["name"] if subject_row else "Uncategorized"

    per_question = []
    correct_count = 0
    for index, (question, user_answer) in enumerate(zip(questions, user_answers)):
        is_correct = user_answer.strip().lower() == question.correct_answer.strip().lower()
        if is_correct:
            correct_count += 1
        per_question.append({
            "question_text": question.question,
            "category": question.category,
            "difficulty": question.difficulty,
            "user_answer": user_answer,
            "correct_answer": question.correct_answer,
            "is_correct": is_correct,
            "question_index": index,
        })

    total_questions = len(questions)
    score = (correct_count / total_questions) * 100 if total_questions else 0.0

    if score >= 90:
        feedback = "Excellent work! You've mastered this material."
        suggestion = "Consider trying a harder difficulty level."
    elif score >= 70:
        feedback = "Good job! You have a solid understanding."
        suggestion = "Review the areas you missed and try again."
    elif score >= 50:
        feedback = "You're getting there! Keep studying."
        suggestion = "Consider reviewing the material again or trying an easier difficulty."
    else:
        feedback = "Don't worry, this is part of learning!"
        suggestion = "Try reviewing the summary again and attempt an easier quiz."

    attempt_id = None
    try:
        attempt_result = client.table("quiz_attempts").insert({
            "user_id": user_id,
            "subject_id": subject_id,
            "subject": subject_name,
            "difficulty": difficulty,
            "total_questions": total_questions,
            "score": score,
        }).execute()
        attempt_id = attempt_result.data[0]["id"]

        for row in per_question:
            row["quiz_attempt_id"] = attempt_id
        client.table("question_attempts").insert(per_question).execute()
    except Exception:
        # Persistence is a quality-of-life addition, not a correctness
        # dependency — a DB failure should never block the user from seeing
        # their score.
        pass

    return {
        "score": score,
        "correct_answers": correct_count,
        "total_questions": total_questions,
        "feedback": feedback,
        "suggestion": suggestion,
        "passed": score >= 60,
        "attempt_id": attempt_id,
    }


def get_attempt_breakdown(attempt_id: str) -> Dict:
    """Aggregate a single attempt's question_attempts by category and by
    difficulty, for rendering real "performance by X" panels.
    """
    client = _get_client()
    rows = client.table("question_attempts").select("category, difficulty, is_correct").eq("quiz_attempt_id", attempt_id).execute().data

    def aggregate(key: str) -> List[Dict]:
        buckets: Dict[str, List[int]] = {}
        for row in rows:
            label = row.get(key) or "Uncategorized"
            correct, total = buckets.setdefault(label, [0, 0])
            buckets[label][1] += 1
            if row["is_correct"]:
                buckets[label][0] += 1
        return [
            {"label": label, "correct": correct, "total": total}
            for label, (correct, total) in buckets.items()
        ]

    return {
        "by_category": aggregate("category"),
        "by_difficulty": aggregate("difficulty"),
    }


def get_attempt_recap(attempt_id: str, external_id: str) -> Dict:
    """Full read-only recap of a single past attempt: attempt metadata plus
    every question's text, the user's answer, the correct answer, and
    correctness. Scoped to the requesting user — returns None if the
    attempt doesn't belong to them (or doesn't exist).
    """
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return None
    user_id = user.data[0]["id"]

    attempt = (
        client.table("quiz_attempts")
        .select("id, subject, difficulty, score, total_questions, created_at, user_id")
        .eq("id", attempt_id)
        .execute()
        .data
    )
    if not attempt or attempt[0]["user_id"] != user_id:
        return None
    attempt = attempt[0]

    questions = (
        client.table("question_attempts")
        .select("question_text, category, difficulty, user_answer, correct_answer, is_correct, question_index")
        .eq("quiz_attempt_id", attempt_id)
        .order("question_index")
        .execute()
        .data
    )

    return {
        "id": attempt["id"],
        "subject": attempt["subject"],
        "difficulty": attempt["difficulty"],
        "score": attempt["score"],
        "total_questions": attempt["total_questions"],
        "created_at": attempt["created_at"],
        "questions": questions,
    }


def get_recent_attempts(external_id: str, limit: int = 20) -> List[Dict]:
    """Lightweight list of a user's past attempts for a sidebar — just
    enough to render a clickable list, not the full recap.
    """
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return []
    user_id = user.data[0]["id"]

    return (
        client.table("quiz_attempts")
        .select("id, subject, difficulty, score, total_questions, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
    )


def get_user_stats(external_id: str) -> Dict:
    """Aggregate stats across all of a user's past quiz attempts, for a
    profile screen. Real numbers only — no attempts yet means zeros, not
    placeholder data.
    """
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return {"total_attempts": 0, "average_score": 0.0, "best_category": None, "recent_attempts": []}

    user_id = user.data[0]["id"]

    attempts = (
        client.table("quiz_attempts")
        .select("id, subject, difficulty, score, total_questions, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )

    total_attempts = len(attempts)
    average_score = sum(a["score"] for a in attempts) / total_attempts if total_attempts else 0.0

    best_category = None
    if total_attempts:
        attempt_ids = [a["id"] for a in attempts]
        questions = (
            client.table("question_attempts")
            .select("category, is_correct")
            .in_("quiz_attempt_id", attempt_ids)
            .execute()
            .data
        )
        buckets: Dict[str, List[int]] = {}
        for row in questions:
            label = row.get("category") or "Uncategorized"
            correct, total = buckets.setdefault(label, [0, 0])
            buckets[label][1] += 1
            if row["is_correct"]:
                buckets[label][0] += 1
        if buckets:
            best_category = max(
                buckets.items(),
                key=lambda item: (item[1][0] / item[1][1], item[1][1])
            )[0]

    return {
        "total_attempts": total_attempts,
        "average_score": average_score,
        "best_category": best_category,
        "recent_attempts": attempts[:10],
    }


def get_user_analytics(external_id: str) -> Dict:
    """Chart-ready datasets across all of a user's past quiz attempts:
    score trend over time, accuracy by category, accuracy by difficulty,
    accuracy by (user-created) subject, and quiz count by subject. All
    real, all-time aggregates — empty lists when there's no history yet,
    never fabricated data.
    """
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return {
            "score_trend": [],
            "by_category": [],
            "by_difficulty": [],
            "by_subject": [],
            "by_subject_accuracy": [],
        }

    user_id = user.data[0]["id"]

    attempts = (
        client.table("quiz_attempts")
        .select("id, subject, difficulty, score, total_questions, created_at")
        .eq("user_id", user_id)
        .order("created_at")
        .execute()
        .data
    )

    score_trend = [
        {
            "attempt_id": a["id"],
            "subject": a["subject"],
            "score": a["score"],
            "created_at": a["created_at"],
        }
        for a in attempts
    ]

    subject_counts: Dict[str, int] = {}
    for a in attempts:
        subject_counts[a["subject"]] = subject_counts.get(a["subject"], 0) + 1
    by_subject = [{"label": label, "count": count} for label, count in subject_counts.items()]

    by_category: List[Dict] = []
    by_difficulty: List[Dict] = []
    by_subject_accuracy: List[Dict] = []
    if attempts:
        attempt_subject_by_id = {a["id"]: a["subject"] for a in attempts}
        attempt_ids = list(attempt_subject_by_id.keys())
        questions = (
            client.table("question_attempts")
            .select("quiz_attempt_id, category, difficulty, is_correct")
            .in_("quiz_attempt_id", attempt_ids)
            .execute()
            .data
        )

        def aggregate(key: str) -> List[Dict]:
            buckets: Dict[str, List[int]] = {}
            for row in questions:
                label = row.get(key) or "Uncategorized"
                correct, total = buckets.setdefault(label, [0, 0])
                buckets[label][1] += 1
                if row["is_correct"]:
                    buckets[label][0] += 1
            return [
                {"label": label, "correct": correct, "total": total, "accuracy": round((correct / total) * 100, 1)}
                for label, (correct, total) in buckets.items()
            ]

        by_category = aggregate("category")
        by_difficulty = aggregate("difficulty")

        subject_buckets: Dict[str, List[int]] = {}
        for row in questions:
            label = attempt_subject_by_id.get(row["quiz_attempt_id"]) or "Uncategorized"
            correct, total = subject_buckets.setdefault(label, [0, 0])
            subject_buckets[label][1] += 1
            if row["is_correct"]:
                subject_buckets[label][0] += 1
        by_subject_accuracy = [
            {"label": label, "correct": correct, "total": total, "accuracy": round((correct / total) * 100, 1)}
            for label, (correct, total) in subject_buckets.items()
        ]

    return {
        "score_trend": score_trend,
        "by_category": by_category,
        "by_difficulty": by_difficulty,
        "by_subject": by_subject,
        "by_subject_accuracy": by_subject_accuracy,
    }
