from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
import json
import tempfile
from typing import Optional, List
from pydantic import BaseModel
import docx
from pptx import Presentation
from dotenv import load_dotenv

from .ai_service import BloomAI
from .models import SummaryRequest, QuizRequest, QuizResponse, SummaryResponse, FlashcardRequest, FlashcardResponse, AnswerCheckRequest, AnswerCheckResponse, AttemptBreakdownResponse, UserStatsResponse, UserAnalyticsResponse, AttemptRecapResponse, RecentAttempt, Subject, CreateSubjectRequest, TutorStartRequest, TutorStartResponse, TutorAnswerRequest, TutorAnswerResponse, TutorWrapRequest, TutorWrapResponse, DocumentInfo, DocumentContent, DueFlashcard, DueFlashcardsResponse, FlashcardReviewRequest, FlashcardReviewResponse
from . import extraction_agent
from . import tutor_agent
from . import memory_service
from . import db
from . import auth
from . import progress

# Load environment variables
load_dotenv()

app = FastAPI(title="Bloom API", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize AI service
ai_service = BloomAI()

@app.on_event("shutdown")
async def shutdown():
    await ai_service.aclose()

@app.get("/")
async def root():
    return {"message": "Bloom API is running!"}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "Bloom API"}

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".pptx"}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024

@app.get("/progress/{progress_id}")
async def get_progress(progress_id: str):
    """Current stage of a long-running operation, for the frontend's
    progress UI. The id is client-generated and passed alongside the slow
    request; unknown ids just return a null stage (no auth needed — stages
    are generic strings keyed by an unguessable client-side UUID)."""
    return {"stage": progress.get_stage(progress_id)}

@app.post("/upload-pdf")
async def upload_pdf(
    file: UploadFile = File(...),
    progress_id: Optional[str] = Form(None),
    user_id: str = Depends(auth.get_current_user_id),
):
    """Upload and extract text from a PDF, DOCX, or PPTX file"""
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PDF, DOCX, and PPTX files are allowed")

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 25 MB)")

    # Upload safety (ROADMAP 5.3): a tempfile-based path never trusts the
    # client-supplied filename (path traversal) and can't collide between
    # concurrent uploads of the same name. Only the sanitized extension is
    # kept so the extractors can dispatch on it.
    file_path = None
    try:
        fd, file_path = tempfile.mkstemp(suffix=ext)
        with os.fdopen(fd, "wb") as buffer:
            buffer.write(content)

        # Extract text based on file type
        if ext == ".pdf":
            text_content = await extraction_agent.extract_structured(
                file_path, ai_service, progress=progress.reporter(progress_id)
            )
        elif ext == ".docx":
            progress.report(progress_id, "Extracting text")
            text_content = extract_text_from_docx(file_path)
        else:
            progress.report(progress_id, "Extracting text")
            text_content = extract_text_from_pptx(file_path)

        # Memory layer: store this upload in the user's vector memory and
        # surface prior uploads with substantial overlap. Best-effort — a
        # memory failure must never fail the upload itself.
        progress.report(progress_id, "Comparing against your past uploads")
        similar_documents = []
        document_id = None
        try:
            similar_documents, document_id = await memory_service.remember_upload(
                user_id, file.filename, text_content
            )
        except Exception:
            pass

        return {
            "filename": file.filename,
            "text_content": text_content,
            "word_count": len(text_content.split()),
            "similar_documents": similar_documents,
            "document_id": document_id,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")
    finally:
        progress.clear(progress_id)
        if file_path is not None:
            try:
                os.remove(file_path)
            except OSError:
                pass

async def _weak_concepts_if_overlap(has_overlap: bool, user_id: str, text_content: str) -> Optional[List[str]]:
    """ROADMAP 3.2: when the upload overlapped prior material, fetch the
    user's weakest stored concepts that match this content, to pass to
    generation prompts as emphasis hints. Best-effort — never fails the
    generation itself."""
    if not has_overlap:
        return None
    try:
        return await memory_service.weak_concepts_for_text(user_id, text_content)
    except Exception:
        return None

@app.post("/generate-summary", response_model=SummaryResponse)
async def generate_summary(
    text_content: str = Form(...),
    summary_type: str = Form(...),  # "short", "bullet_points", "detailed"
    subject: Optional[str] = Form(None),
    progress_id: Optional[str] = Form(None),
    has_overlap: bool = Form(False),
    user_id: str = Depends(auth.get_current_user_id)
):
    """Generate summary from text content"""
    try:
        weak_concepts = await _weak_concepts_if_overlap(has_overlap, user_id, text_content)
        summary = await ai_service.generate_summary(
            text_content=text_content,
            summary_type=summary_type,
            subject=subject,
            progress=progress.reporter(progress_id),
            weak_concepts=weak_concepts,
        )

        if summary_type == "bullet_points" and "concepts" in summary:
            summary_text = json.dumps({"concepts": summary["concepts"]})
            word_count = sum(
                len(c.get("title", "").split()) + len(c.get("explanation", "").split()) +
                sum(len(d.split()) for d in c.get("details", []))
                for c in summary["concepts"]
            )
        else:
            summary_text = summary["content"]
            word_count = len(summary["content"].split())

        return SummaryResponse(
            summary=summary_text,
            tags=summary.get("tags", []),
            summary_type=summary_type,
            word_count=word_count
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating summary: {str(e)}")
    finally:
        progress.clear(progress_id)

@app.post("/generate-quiz", response_model=QuizResponse)
async def generate_quiz(
    text_content: str = Form(...),
    num_questions: int = Form(...),
    subject: str = Form(...),
    difficulty: str = Form(...),  # "easy", "medium", "hard"
    progress_id: Optional[str] = Form(None),
    has_overlap: bool = Form(False),
    user_id: str = Depends(auth.get_current_user_id)
):
    """Generate quiz from text content"""
    try:
        weak_concepts = await _weak_concepts_if_overlap(has_overlap, user_id, text_content)
        quiz = await ai_service.generate_quiz(
            text_content=text_content,
            num_questions=num_questions,
            subject=subject,
            difficulty=difficulty,
            progress=progress.reporter(progress_id),
            weak_concepts=weak_concepts,
        )

        return QuizResponse(
            questions=quiz["questions"],
            total_questions=len(quiz["questions"]),
            difficulty=difficulty,
            subject=subject,
            estimated_time=len(quiz["questions"]) * 2  # 2 minutes per question
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating quiz: {str(e)}")
    finally:
        progress.clear(progress_id)

@app.post("/generate-flashcards", response_model=FlashcardResponse)
async def generate_flashcards(
    text_content: str = Form(...),
    num_cards: int = Form(...),
    subject: str = Form(...),
    card_type: str = Form(...),  # "definition", "concept", "fact", "mixed"
    document_id: Optional[str] = Form(None),
    user_id: str = Depends(auth.get_current_user_id)
):
    """Generate flashcards from text content"""
    try:
        flashcards = await ai_service.generate_flashcards(
            text_content=text_content,
            num_cards=num_cards,
            subject=subject,
            card_type=card_type
        )

        # Spaced repetition (ROADMAP 4.1): persist the set so the cards come
        # back for review at growing intervals. Best-effort — a DB failure
        # must never fail the generation the user is waiting on.
        try:
            db.save_flashcard_set(
                user_id, subject, card_type, flashcards["flashcards"],
                document_id=document_id,
            )
        except Exception:
            pass

        return FlashcardResponse(
            flashcards=flashcards["flashcards"],
            total_cards=len(flashcards["flashcards"]),
            subject=subject,
            card_type=card_type
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating flashcards: {str(e)}")

@app.get("/me/flashcards/due", response_model=DueFlashcardsResponse)
async def get_my_due_flashcards(external_user_id: str = Depends(auth.get_current_user_id)):
    """Cards due for review now (most overdue first) plus the total due
    count, for the review screen and the due-count badge"""
    try:
        return DueFlashcardsResponse(**db.get_due_flashcards(external_user_id))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching due flashcards: {str(e)}")

@app.post("/flashcards/{card_id}/review", response_model=FlashcardReviewResponse)
async def review_flashcard(
    card_id: str,
    request: FlashcardReviewRequest,
    external_user_id: str = Depends(auth.get_current_user_id),
):
    """Apply one self-graded review ("again"/"hard"/"good"/"easy") to a card
    and return its new schedule"""
    if request.grade not in ("again", "hard", "good", "easy"):
        raise HTTPException(status_code=400, detail="grade must be one of: again, hard, good, easy")
    try:
        result = db.review_flashcard(card_id, external_user_id, request.grade)
        if result is None:
            raise HTTPException(status_code=404, detail="Flashcard not found")
        return FlashcardReviewResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error recording review: {str(e)}")

@app.post("/tutor/start", response_model=TutorStartResponse)
async def tutor_start(request: TutorStartRequest, user_id: str = Depends(auth.get_current_user_id)):
    """Start an adaptive tutor session: extract the concepts to teach from
    the uploaded material, initialize a per-concept knowledge state, and
    return the first question (without its answer — grading is server-side)."""
    try:
        if not request.text_content.strip():
            raise HTTPException(status_code=400, detail="text_content cannot be empty")
        if request.mode not in tutor_agent.MODES:
            raise HTTPException(status_code=400, detail="mode must be one of: " + ", ".join(tutor_agent.MODES))

        result = await tutor_agent.start_session(
            user_id, request.text_content, request.subject, request.mode, ai_service,
            concepts_filter=request.concepts,
            progress=progress.reporter(request.progress_id),
        )
        return TutorStartResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error starting tutor session: {str(e)}")
    finally:
        progress.clear(request.progress_id)

@app.post("/tutor/answer", response_model=TutorAnswerResponse)
async def tutor_answer(request: TutorAnswerRequest, user_id: str = Depends(auth.get_current_user_id)):
    """Submit an answer to the current tutor question. Grades it, diagnoses
    wrong answers, updates the knowledge state, and returns either the next
    question (targeting the weakest concept at a calibrated difficulty) or
    the session summary."""
    try:
        result = await tutor_agent.submit_answer(
            request.session_id, user_id, request.answer, ai_service,
            confidence=request.confidence,
        )
        if result is None:
            raise HTTPException(status_code=404, detail="Tutor session not found or expired")
        return TutorAnswerResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing answer: {str(e)}")

@app.post("/tutor/wrap", response_model=TutorWrapResponse)
async def tutor_wrap(request: TutorWrapRequest, user_id: str = Depends(auth.get_current_user_id)):
    """End an active tutor session early at the student's request (the
    soft-checkpoint "wrap up" action) and return its summary."""
    try:
        summary = tutor_agent.wrap_session(request.session_id, user_id)
        if summary is None:
            raise HTTPException(status_code=404, detail="Tutor session not found or expired")
        return TutorWrapResponse(summary=summary)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error wrapping tutor session: {str(e)}")

@app.get("/tutor/session/{session_id}", response_model=TutorStartResponse)
async def tutor_get_session(session_id: str, user_id: str = Depends(auth.get_current_user_id)):
    """Current state of an active tutor session, for resuming the UI after a
    page refresh: the pending question (answer stays server-side) and the
    per-concept knowledge state."""
    state = tutor_agent.get_session_state(session_id, user_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Tutor session not found or already finished")
    return TutorStartResponse(**state)

# --- Documents library (ROADMAP 3.1): the memory layer's stored uploads,
# --- made user-visible so material can be re-studied without re-uploading.

@app.get("/me/documents", response_model=List[DocumentInfo])
async def get_my_documents(external_user_id: str = Depends(auth.get_current_user_id)):
    """All of the signed-in user's stored uploads, newest first"""
    try:
        documents = db.list_documents(external_user_id)
        return [DocumentInfo(**d) for d in documents]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching documents: {str(e)}")

@app.get("/documents/{document_id}/content", response_model=DocumentContent)
async def get_document_content(document_id: str, external_user_id: str = Depends(auth.get_current_user_id)):
    """Reassembled text of a stored upload, for studying it again"""
    content = db.get_document_content(document_id, external_user_id)
    if content is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return DocumentContent(**content)

@app.delete("/documents/{document_id}")
async def delete_document(document_id: str, external_user_id: str = Depends(auth.get_current_user_id)):
    """Delete a stored upload and its chunks (ownership-scoped)"""
    try:
        deleted = db.delete_document(document_id, external_user_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Document not found")
        return {"deleted": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting document: {str(e)}")

@app.post("/subjects", response_model=Subject)
async def create_subject(request: CreateSubjectRequest, external_user_id: str = Depends(auth.get_current_user_id)):
    """Create a subject/project for the signed-in user, or return the
    existing one if a subject with this name already exists"""
    try:
        if not request.name.strip():
            raise HTTPException(status_code=400, detail="Subject name cannot be empty")
        subject = db.create_subject(external_user_id, request.name)
        return Subject(**subject)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating subject: {str(e)}")

@app.get("/subjects", response_model=List[Subject])
async def get_subjects(external_user_id: str = Depends(auth.get_current_user_id)):
    """List all subjects owned by the signed-in user"""
    try:
        subjects = db.list_subjects(external_user_id)
        return [Subject(**s) for s in subjects]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching subjects: {str(e)}")

@app.delete("/subjects/{subject_id}")
async def delete_subject(subject_id: str, external_user_id: str = Depends(auth.get_current_user_id)):
    """Delete a subject owned by the signed-in user. Past attempts that
    referenced it survive and fall into 'Uncategorized' in subject-grouped
    views (ON DELETE SET NULL on quiz_attempts.subject_id)."""
    try:
        deleted = db.delete_subject(subject_id, external_user_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Subject not found")
        return {"deleted": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting subject: {str(e)}")

@app.post("/check-answers", response_model=AnswerCheckResponse)
async def check_answers(request: AnswerCheckRequest, external_user_id: str = Depends(auth.get_current_user_id)):
    """Check user answers, score the quiz, and persist the attempt"""
    try:
        if len(request.questions) != len(request.user_answers):
            raise HTTPException(status_code=400, detail="Answer count mismatch")

        user_id = db.get_or_create_user(external_user_id)

        result = db.record_quiz_attempt(
            subject_id=request.subject_id,
            difficulty=request.difficulty,
            questions=request.questions,
            user_answers=request.user_answers,
            user_id=user_id,
        )

        return AnswerCheckResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error checking answers: {str(e)}")

@app.get("/quiz-attempts/{attempt_id}/breakdown", response_model=AttemptBreakdownResponse)
async def get_attempt_breakdown(attempt_id: str, user_id: str = Depends(auth.get_current_user_id)):
    """Real per-category and per-difficulty performance for a single completed attempt"""
    try:
        breakdown = db.get_attempt_breakdown(attempt_id)
        return AttemptBreakdownResponse(**breakdown)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching breakdown: {str(e)}")

@app.get("/me/stats", response_model=UserStatsResponse)
async def get_my_stats(external_user_id: str = Depends(auth.get_current_user_id)):
    """Aggregate quiz-history stats for the signed-in user, for the profile screen"""
    try:
        stats = db.get_user_stats(external_user_id)
        return UserStatsResponse(**stats)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching stats: {str(e)}")

@app.get("/me/analytics", response_model=UserAnalyticsResponse)
async def get_my_analytics(external_user_id: str = Depends(auth.get_current_user_id)):
    """Chart-ready datasets for the signed-in user: score trend, accuracy
    by category/difficulty, and quiz distribution by subject"""
    try:
        analytics = db.get_user_analytics(external_user_id)
        return UserAnalyticsResponse(**analytics)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching analytics: {str(e)}")

@app.get("/me/recent-attempts", response_model=List[RecentAttempt])
async def get_my_recent_attempts(external_user_id: str = Depends(auth.get_current_user_id)):
    """Lightweight recent-attempts list for the sidebar"""
    try:
        attempts = db.get_recent_attempts(external_user_id)
        return [RecentAttempt(**a) for a in attempts]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching recent attempts: {str(e)}")

@app.get("/quiz-attempts/{attempt_id}/recap", response_model=AttemptRecapResponse)
async def get_attempt_recap(attempt_id: str, external_user_id: str = Depends(auth.get_current_user_id)):
    """Full read-only recap of a past attempt, scoped to the requesting user"""
    recap = db.get_attempt_recap(attempt_id, external_user_id)
    if recap is None:
        raise HTTPException(status_code=404, detail="Attempt not found")
    return AttemptRecapResponse(**recap)

def extract_text_from_docx(file_path: str) -> str:
    """Extract text content from a DOCX file"""
    try:
        document = docx.Document(file_path)
        parts = [paragraph.text for paragraph in document.paragraphs if paragraph.text]

        for table in document.tables:
            for row in table.rows:
                for cell in row.cells:
                    if cell.text:
                        parts.append(cell.text)

        return "\n".join(parts).strip()

    except Exception as e:
        raise Exception(f"Error extracting text from DOCX: {str(e)}")

def extract_text_from_pptx(file_path: str) -> str:
    """Extract text content from a PPTX file"""
    try:
        presentation = Presentation(file_path)
        parts = []

        for slide in presentation.slides:
            for shape in slide.shapes:
                if shape.has_text_frame and shape.text_frame.text:
                    parts.append(shape.text_frame.text)

        return "\n".join(parts).strip()

    except Exception as e:
        raise Exception(f"Error extracting text from PPTX: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 