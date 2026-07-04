from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
import json
from typing import Optional, List
from pydantic import BaseModel
import docx
from pptx import Presentation
from dotenv import load_dotenv

from .ai_service import BloomAI
from .models import SummaryRequest, QuizRequest, QuizResponse, SummaryResponse, FlashcardRequest, FlashcardResponse, AnswerCheckRequest, AnswerCheckResponse, AttemptBreakdownResponse, UserStatsResponse, UserAnalyticsResponse, AttemptRecapResponse, RecentAttempt, Subject, CreateSubjectRequest, TutorStartRequest, TutorStartResponse, TutorAnswerRequest, TutorAnswerResponse
from . import extraction_agent
from . import tutor_agent
from . import memory_service
from . import db
from . import auth

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

@app.get("/")
async def root():
    return {"message": "Bloom API is running!"}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "Bloom API"}

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".pptx"}

@app.post("/upload-pdf")
async def upload_pdf(file: UploadFile = File(...), user_id: str = Depends(auth.get_current_user_id)):
    """Upload and extract text from a PDF, DOCX, or PPTX file"""
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PDF, DOCX, and PPTX files are allowed")

    try:
        # Save uploaded file temporarily
        upload_dir = "uploads"
        os.makedirs(upload_dir, exist_ok=True)
        file_path = os.path.join(upload_dir, file.filename)

        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)

        # Extract text based on file type
        if ext == ".pdf":
            text_content = await extraction_agent.extract_structured(file_path)
        elif ext == ".docx":
            text_content = extract_text_from_docx(file_path)
        else:
            text_content = extract_text_from_pptx(file_path)

        # Clean up temporary file
        os.remove(file_path)

        # Memory layer: store this upload in the user's vector memory and
        # surface prior uploads with substantial overlap. Best-effort — a
        # memory failure must never fail the upload itself.
        similar_documents = []
        try:
            similar_documents = await memory_service.remember_upload(
                user_id, file.filename, text_content
            )
        except Exception:
            pass

        return {
            "filename": file.filename,
            "text_content": text_content,
            "word_count": len(text_content.split()),
            "similar_documents": similar_documents,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")

@app.post("/generate-summary", response_model=SummaryResponse)
async def generate_summary(
    text_content: str = Form(...),
    summary_type: str = Form(...),  # "short", "bullet_points", "detailed"
    subject: Optional[str] = Form(None),
    user_id: str = Depends(auth.get_current_user_id)
):
    """Generate summary from text content"""
    try:
        summary = await ai_service.generate_summary(
            text_content=text_content,
            summary_type=summary_type,
            subject=subject
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

@app.post("/generate-quiz", response_model=QuizResponse)
async def generate_quiz(
    text_content: str = Form(...),
    num_questions: int = Form(...),
    subject: str = Form(...),
    difficulty: str = Form(...),  # "easy", "medium", "hard"
    previous_score: Optional[int] = Form(None),
    user_id: str = Depends(auth.get_current_user_id)
):
    """Generate quiz from text content with adaptive difficulty"""
    try:
        # Adaptive difficulty logic
        adjusted_difficulty = difficulty
        if previous_score is not None:
            if previous_score < 60:
                adjusted_difficulty = "easy" if difficulty != "easy" else "easy"
            elif previous_score > 90:
                adjusted_difficulty = "hard" if difficulty != "hard" else "hard"
        
        quiz = await ai_service.generate_quiz(
            text_content=text_content,
            num_questions=num_questions,
            subject=subject,
            difficulty=adjusted_difficulty
        )
        
        return QuizResponse(
            questions=quiz["questions"],
            total_questions=len(quiz["questions"]),
            difficulty=adjusted_difficulty,
            subject=subject,
            estimated_time=len(quiz["questions"]) * 2  # 2 minutes per question
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating quiz: {str(e)}")

@app.post("/generate-flashcards", response_model=FlashcardResponse)
async def generate_flashcards(
    text_content: str = Form(...),
    num_cards: int = Form(...),
    subject: str = Form(...),
    card_type: str = Form(...),  # "definition", "concept", "fact", "mixed"
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
        
        return FlashcardResponse(
            flashcards=flashcards["flashcards"],
            total_cards=len(flashcards["flashcards"]),
            subject=subject,
            card_type=card_type
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating flashcards: {str(e)}")

@app.post("/tutor/start", response_model=TutorStartResponse)
async def tutor_start(request: TutorStartRequest, user_id: str = Depends(auth.get_current_user_id)):
    """Start an adaptive tutor session: extract the concepts to teach from
    the uploaded material, initialize a per-concept knowledge state, and
    return the first question (without its answer — grading is server-side)."""
    try:
        if not request.text_content.strip():
            raise HTTPException(status_code=400, detail="text_content cannot be empty")
        if not 1 <= request.max_questions <= 30:
            raise HTTPException(status_code=400, detail="max_questions must be between 1 and 30")

        result = await tutor_agent.start_session(
            user_id, request.text_content, request.subject, request.max_questions, ai_service
        )
        return TutorStartResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error starting tutor session: {str(e)}")

@app.post("/tutor/answer", response_model=TutorAnswerResponse)
async def tutor_answer(request: TutorAnswerRequest, user_id: str = Depends(auth.get_current_user_id)):
    """Submit an answer to the current tutor question. Grades it, diagnoses
    wrong answers, updates the knowledge state, and returns either the next
    question (targeting the weakest concept at a calibrated difficulty) or
    the session summary."""
    try:
        result = await tutor_agent.submit_answer(request.session_id, user_id, request.answer, ai_service)
        if result is None:
            raise HTTPException(status_code=404, detail="Tutor session not found or expired")
        return TutorAnswerResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing answer: {str(e)}")

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