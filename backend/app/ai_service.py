import os
import asyncio
import httpx
import json
import re
import base64
from typing import Dict, List, Optional
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class BloomAI:
    def __init__(self):
        self.api_key = os.getenv('OPENROUTER_API_KEY')
        if not self.api_key:
            raise ValueError("OPENROUTER_API_KEY environment variable is required")

        self.url = "https://openrouter.ai/api/v1/chat/completions"
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        self.base_system_message = "You are Bloom AI, an expert educational assistant specialized in creating summaries and quizzes from academic content. Always provide accurate, well-structured responses."

        # One shared async client for all LLM calls. Generous read timeout:
        # long generations (10-question quizzes, detailed summaries) can take
        # well over httpx's 5s default.
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))

    @staticmethod
    def _truncate(text: str, max_chars: int) -> str:
        """Budget-truncate text at a natural boundary (ROADMAP 5.2).

        Prefers the last paragraph break before the budget, then the last
        sentence end, then the last whitespace — never a mid-sentence slice.
        Boundaries are only used if they keep most of the budget, so a
        pathological input (one giant paragraph) still fills the window.
        """
        if len(text) <= max_chars:
            return text
        window = text[:max_chars]
        for boundary in ("\n\n", ". ", "\n", " "):
            cut = window.rfind(boundary)
            if cut >= int(max_chars * 0.7):
                return window[: cut + (1 if boundary == ". " else 0)].rstrip() + "\n..."
        return window + "..."

    async def aclose(self):
        await self._client.aclose()

    async def _make_request(self, messages: List[Dict]) -> str:
        """Make a request to the OpenRouter API"""
        data = {
            "model": "openai/gpt-oss-120b",
            "provider": {
                "only": ["Cerebras"]
            },
            "messages": messages
        }

        try:
            response = await self._client.post(self.url, headers=self.headers, json=data)
            response.raise_for_status()
            response_data = response.json()
            return response_data["choices"][0]["message"]["content"]
        except Exception as e:
            raise Exception(f"API request failed: {str(e)}")

    async def describe_page_image(self, image_bytes: bytes) -> str:
        """Describe a page image (diagram/chart/equation) using a vision-capable model.

        Not pinned to Cerebras: Cerebras does not serve vision models, and the
        main text model (gpt-oss-120b) is text-only. Uses a separate free
        vision model instead.
        """
        encoded = base64.b64encode(image_bytes).decode("utf-8")

        data = {
            "model": "google/gemma-4-31b-it:free",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "This image is a page from a student's study material that contains a "
                                "diagram, chart, equation, or other visual content. Describe it precisely "
                                "enough that a student could understand and study it from the description "
                                "alone: what it shows, its key labels/values, and the relationship it "
                                "conveys. Be concise and factual. Do not describe the page layout, only "
                                "the meaningful visual content."
                            )
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{encoded}"
                            }
                        }
                    ]
                }
            ]
        }

        try:
            response = await self._client.post(self.url, headers=self.headers, json=data)
            response.raise_for_status()
            response_data = response.json()
            return response_data["choices"][0]["message"]["content"]
        except Exception as e:
            raise Exception(f"Vision API request failed: {str(e)}")

    def _parse_json_response(self, response: str) -> Optional[Dict]:
        """Extract and parse a JSON object from a raw model response.

        Returns None if no valid JSON could be extracted, so callers can
        decide their own fallback (draft callers fall back to a raw-string
        summary; critique/revise callers fall back to skipping that step).
        """
        try:
            json_match = re.search(r'\{.*\}', response, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
        except json.JSONDecodeError:
            pass
        return None

    async def _critique_summary(self, draft: Dict, text_content: str, summary_type: str) -> Optional[Dict]:
        """Check a draft summary against source text and a fixed quality checklist.

        Returns {"needs_revision": bool, "issues": [...]}, or None if the
        critique call itself failed or returned unparseable JSON — callers
        should treat None the same as "no revision needed" and use the draft
        as-is, since the critique/revise loop is a quality improvement, not a
        correctness dependency.
        """
        if summary_type == "bullet_points":
            checklist = """1. Does any concept's "explanation" closely paraphrase or copy source sentences rather than synthesizing them?
2. Are any two concepts substantially redundant and should be merged?
3. Is any "explanation" generic/vague enough that it could apply to almost any topic (a sign of thin synthesis)?
4. Does the JSON match the schema exactly (no markdown artifacts like ** or # in string values, "details" is a non-empty array, "concepts" has 4-6 items)?"""
        else:
            checklist = """1. Are section headings meaningful (not generic like "Section 1" or "Overview") and do they reflect the actual content?
2. Is content duplicated across sections?
3. Does the summary skip covering a major topic clearly present in the source text?
4. Does the JSON match the schema (a single "content" string, "tags" array)?"""

        prompt = f"""You are reviewing a draft summary against its source text and a quality checklist. Be strict.

Checklist:
{checklist}

Source text:
{text_content}

Draft summary (JSON):
{json.dumps(draft)}

Respond with ONLY valid, minified JSON matching this schema, no text before or after:
{{
    "needs_revision": true or false,
    "issues": ["specific issue 1", "specific issue 2"]
}}

If the draft passes every checklist item, return "needs_revision": false and an empty "issues" array."""

        messages = [
            {"role": "system", "content": self.base_system_message},
            {"role": "user", "content": prompt}
        ]

        try:
            response = await self._make_request(messages)
        except Exception:
            return None

        return self._parse_json_response(response)

    async def _revise_summary(self, draft: Dict, issues: List[str], text_content: str, summary_type: str) -> Optional[Dict]:
        """Produce a revised summary addressing the critique's issues list.

        Returns None if the revise call failed or returned unparseable JSON —
        callers should fall back to the original draft in that case.
        """
        schema = (
            '{"concepts": [{"title": "...", "explanation": "...", "details": ["..."]}], "tags": ["..."]}'
            if summary_type == "bullet_points"
            else '{"content": "...", "tags": ["..."]}'
        )

        prompt = f"""Revise the following draft summary to fix the specific issues listed below. Keep everything
that already works — only change what's needed to address the issues. Re-check against the source text,
don't just reword the draft.

Source text:
{text_content}

Draft summary (JSON):
{json.dumps(draft)}

Issues to fix:
{json.dumps(issues)}

Respond with ONLY valid, minified JSON matching this exact schema, no markdown formatting, no text before or after:
{schema}"""

        messages = [
            {"role": "system", "content": self.base_system_message},
            {"role": "user", "content": prompt}
        ]

        try:
            response = await self._make_request(messages)
        except Exception:
            return None

        return self._parse_json_response(response)

    def _weak_concepts_block(self, weak_concepts: Optional[List[str]]) -> str:
        """Emphasis hint injected into generation prompts when the memory
        layer knows the student previously struggled with concepts that
        overlap this material (ROADMAP 3.2)."""
        if not weak_concepts:
            return ""
        return f"""
The student has studied overlapping material before and previously struggled with these concepts:
{json.dumps(weak_concepts)}
Give these concepts extra attention and coverage where the source text supports it.
"""

    async def generate_summary(
        self, text_content: str, summary_type: str, subject: Optional[str] = None,
        progress=None, weak_concepts: Optional[List[str]] = None,
    ) -> Dict:
        """Generate a summary based on the specified type"""

        def _report(stage: str):
            if progress:
                progress(stage)

        # Truncate content if too long (approximate token limit)
        text_content = self._truncate(text_content, 15000)

        subject_context = f" in the field of {subject}" if subject else ""
        emphasis = self._weak_concepts_block(weak_concepts)

        if summary_type == "short":
            prompt = f"""Create a concise summary of the following text{subject_context}.
            Keep it to 2-3 paragraphs maximum, focusing on the most important points.
            {emphasis}
            Text: {text_content}

            Provide your response in this JSON format:
            {{
                "content": "your summary here",
                "tags": ["key", "topic", "tags"]
            }}"""

        elif summary_type == "bullet_points":
            prompt = f"""Analyze the following text{subject_context} and identify the 4-6 core concepts a student
            needs to understand — ignore the document's original slide/section boundaries and instead group
            related ideas together by theme, even if they were scattered across different parts of the source.

            For each core concept:
            - Write a short, punchy title (3-6 words, not a restated slide heading)
            - Write a 1-2 sentence explanation in your own words that synthesizes why it matters or how it works,
              not a copy of the source bullet points
            - List 2-4 supporting details as short sub-points (specific facts, examples, names, numbers worth remembering)

            Do not simply restate bullet points from the source material verbatim. Synthesize and explain.
            {emphasis}
            Respond with ONLY valid, minified JSON matching the schema below. Do not use markdown formatting
            (no **, no #, no bullet characters) anywhere in the JSON values. Do not include any text before or
            after the JSON object.

            Schema:
            {{
                "concepts": [
                    {{
                        "title": "Concept title",
                        "explanation": "1-2 sentence synthesized explanation",
                        "details": ["supporting detail 1", "supporting detail 2"]
                    }}
                ],
                "tags": ["key", "topic", "tags"]
            }}

            Text: {text_content}"""

        elif summary_type == "detailed":
            prompt = f"""Create a comprehensive, detailed summary of the following text{subject_context}.
            Include all major concepts, methodologies, findings, and conclusions.
            Organize into clear sections with headings.
            {emphasis}
            Text: {text_content}

            Provide your response in this JSON format:
            {{
                "content": "your detailed summary with sections and headings",
                "tags": ["key", "topic", "tags"]
            }}"""

        messages = [
            {"role": "system", "content": self.base_system_message},
            {"role": "user", "content": prompt}
        ]

        _report("Drafting the summary")
        response = await self._make_request(messages)

        draft = self._parse_json_response(response)
        if draft is None:
            # Fallback if JSON parsing fails
            return {
                "content": response,
                "tags": ["general", "summary"]
            }

        # Draft/critique/revise loop: only for structured summary types where
        # verbatim copying, redundancy, or thin synthesis are real risks.
        # "short" stays single-shot — its plain-paragraph output doesn't have
        # the same structured failure modes and isn't worth the extra call.
        if summary_type in ("bullet_points", "detailed"):
            _report("Critiquing the draft summary")
            critique = await self._critique_summary(draft, text_content, summary_type)
            if critique and critique.get("needs_revision") and critique.get("issues"):
                _report("Revising the summary")
                revised = await self._revise_summary(draft, critique["issues"], text_content, summary_type)
                if revised is not None:
                    return revised
            # No revision needed, or critique/revise failed — use the draft as-is.

        return draft
    
    async def _verify_question(self, question: Dict, text_content: str) -> Optional[Dict]:
        """Check whether a question's stated correct_answer is actually
        supported by the source text.

        Returns {"grounded": bool, "supporting_evidence": str | None}, or
        None if the verification call itself failed or returned unparseable
        JSON — callers should treat None as "assume grounded" (fail open,
        not closed) since this is a quality layer, not a correctness
        dependency, matching the summary critique loop's rule.
        """
        prompt = f"""You are fact-checking a quiz question against its source text. Be strict — only mark
something grounded if the source text actually states or clearly supports it, not if it merely sounds
plausible or is generally true.

Source text:
{text_content}

Question: {question.get('question')}
Stated correct answer: {question.get('correct_answer')}

Respond with ONLY valid, minified JSON matching this schema, no text before or after:
{{
    "grounded": true or false,
    "supporting_evidence": "the exact sentence or phrase from the source that supports this answer, or null if not grounded"
}}"""

        messages = [
            {"role": "system", "content": self.base_system_message},
            {"role": "user", "content": prompt}
        ]

        try:
            response = await self._make_request(messages)
        except Exception:
            return None

        return self._parse_json_response(response)

    async def _regenerate_question(
        self, original: Dict, feedback: str, text_content: str, difficulty: str, subject: str
    ) -> Optional[Dict]:
        """Produce a single replacement question addressing why the original
        failed grounding verification.

        Returns None if the call failed or returned unparseable JSON —
        callers should fall back to keeping the original question in that
        case (last-resort degradation, only reached if the broader API is
        having trouble beyond just this one question).
        """
        prompt = f"""The following {difficulty} level quiz question about {subject} was not grounded in its
source text: {feedback}

Original question (do not repeat its mistake): {json.dumps(original)}

Write ONE new multiple-choice question based only on facts actually stated in the source text below.
Do not use outside knowledge, even if true — only what this text supports.

Source text:
{text_content}

Respond with ONLY valid, minified JSON matching this schema, no text before or after:
{{
    "question": "...",
    "options": ["...", "...", "...", "..."],
    "correct_answer": "...",
    "explanation": "...",
    "category": "specific topic name",
    "difficulty": "{difficulty}"
}}"""

        messages = [
            {"role": "system", "content": self.base_system_message},
            {"role": "user", "content": prompt}
        ]

        try:
            response = await self._make_request(messages)
        except Exception:
            return None

        return self._parse_json_response(response)

    async def _ground_questions(
        self, questions: List[Dict], text_content: str, difficulty: str, subject: str,
        progress=None,
    ) -> List[Dict]:
        """Verify each question against the source text, regenerating
        ungrounded ones (up to 2 retries) before dropping and backfilling
        with a fresh replacement. Fails open at every step — any verify or
        regenerate call that errors out just keeps the current candidate
        rather than losing a question over unrelated API trouble.
        """
        MAX_RETRIES = 2

        total = len(questions)
        verified_count = 0

        def _report_verified():
            # Verification runs concurrently, so "question 3 of 10" would be
            # meaningless — report how many have finished instead.
            nonlocal verified_count
            verified_count += 1
            if progress:
                progress(f"Verifying answers against your material ({verified_count} of {total})")

        async def ground_one(question: Dict) -> Dict:
            current = question
            verified_grounded = False

            # Retries for a single question stay sequential — each regeneration
            # depends on the previous verification's feedback.
            for attempt in range(MAX_RETRIES + 1):
                verification = await self._verify_question(current, text_content)

                if verification is None or verification.get("grounded", True):
                    # Grounded, or verification call failed (fail open).
                    verified_grounded = True
                    break

                # Ungrounded — out of retries, stop without regenerating again.
                if attempt == MAX_RETRIES:
                    break

                feedback = verification.get("supporting_evidence") or "no supporting evidence found in the source text"
                regenerated = await self._regenerate_question(current, feedback, text_content, difficulty, subject)
                if regenerated is None:
                    # Regeneration call failed — keep current candidate, stop retrying.
                    break
                current = regenerated

            if not verified_grounded:
                # Still ungrounded after retries — drop it and backfill with
                # a fresh replacement candidate instead of hammering the
                # same angle further. Not re-verified: this is a best-effort
                # last attempt, matching the fail-open policy elsewhere.
                replacement = await self._regenerate_question(
                    current, "previous attempts were not grounded in the source text", text_content, difficulty, subject
                )
                current = replacement if replacement is not None else current

            _report_verified()
            return current

        # Questions are independent of each other — verify them concurrently.
        return list(await asyncio.gather(*(ground_one(q) for q in questions)))

    async def generate_quiz(
        self, text_content: str, num_questions: int, subject: str, difficulty: str,
        progress=None, weak_concepts: Optional[List[str]] = None,
    ) -> Dict:
        """Generate a quiz based on the text content"""

        def _report(stage: str):
            if progress:
                progress(stage)

        # Truncate content if too long, leaving room for the prompt
        text_content = self._truncate(text_content, 12000)

        difficulty_instructions = {
            "easy": "Focus on basic concepts, definitions, and straightforward facts. Avoid complex reasoning.",
            "medium": "Include some analysis and application questions. Mix factual and conceptual questions.",
            "hard": "Focus on critical thinking, analysis, synthesis, and complex problem-solving."
        }
        
        prompt = f"""Create a {difficulty} level quiz with {num_questions} multiple-choice questions based on the following {subject} content.

        Difficulty level: {difficulty}
        Instructions: {difficulty_instructions[difficulty]}
        {self._weak_concepts_block(weak_concepts)}
        Content: {text_content}

        For each question:
        1. Create a clear, specific question
        2. Provide 4 answer options (A, B, C, D)
        3. Mark the correct answer
        4. Optionally provide a brief explanation
        5. Tag it with a short "category" (2-4 words) naming the specific topic within the
           content that this question tests — not the overall subject, but the narrower theme
           (e.g. "Cell Membrane Structure", "French Revolution Causes"). Use consistent category
           names across questions that test the same topic so related questions share a category.

        Provide your response in this JSON format:
        {{
            "questions": [
                {{
                    "question": "What is...?",
                    "options": ["Option A", "Option B", "Option C", "Option D"],
                    "correct_answer": "Option B",
                    "explanation": "Brief explanation of why this is correct",
                    "category": "Specific topic name",
                    "difficulty": "{difficulty}"
                }}
            ]
        }}

        Ensure questions are directly based on the provided content and test understanding rather than memorization."""

        messages = [
            {"role": "system", "content": self.base_system_message},
            {"role": "user", "content": prompt}
        ]

        _report(f"Writing {num_questions} questions")
        response = await self._make_request(messages)

        try:
            # Extract JSON from response
            json_match = re.search(r'\{.*\}', response, re.DOTALL)
            if json_match:
                quiz_data = json.loads(json_match.group())

                # Validate and limit questions to requested number
                if "questions" in quiz_data and isinstance(quiz_data["questions"], list):
                    quiz_data["questions"] = quiz_data["questions"][:num_questions]
                    for question in quiz_data["questions"]:
                        question.setdefault("category", "General")
                        question.setdefault("difficulty", difficulty)
                    _report("Verifying answers against your material")
                    quiz_data["questions"] = await self._ground_questions(
                        quiz_data["questions"], text_content, difficulty, subject,
                        progress=progress,
                    )
                    return quiz_data
                else:
                    raise ValueError("Invalid quiz format")
            else:
                raise ValueError("No JSON found in response")

        except (json.JSONDecodeError, ValueError) as e:
            # Fallback: create a simple question if parsing fails
            return {
                "questions": [{
                    "question": "Based on the content provided, what was the main topic discussed?",
                    "options": ["Topic A", "Topic B", "Topic C", "Topic D"],
                    "correct_answer": "Topic A",
                    "explanation": "This question requires manual review as AI parsing failed.",
                    "category": "General",
                    "difficulty": difficulty
                }]
            }
    
    async def generate_tutor_question(
        self, text_content: str, concept: str, difficulty: str, subject: str, asked_questions: List[str],
        misconceptions: Optional[List[str]] = None,
        variant_of: Optional[Dict] = None,
        answer_mode: str = "multiple_choice",
    ) -> Optional[Dict]:
        """Generate ONE question targeting a specific concept at a specific
        difficulty, for the adaptive tutor loop — multiple-choice, or
        open-ended ("free_text") where the tutor wants to see the student's
        own words (ROADMAP 4.2).

        The question is grounding-verified once (reusing the quiz agent's
        verifier) and regenerated once if unsupported — fail open, matching
        the quiz pipeline's policy. Returns None if generation failed or
        returned unparseable JSON.
        """
        text_content = self._truncate(text_content, 12000)

        difficulty_instructions = {
            "easy": "Test basic recall: a definition or straightforward fact.",
            "medium": "Test understanding: application or a conceptual connection.",
            "hard": "Test deeper reasoning: analysis, comparison, or implications.",
        }

        avoid_block = ""
        if asked_questions:
            avoid_block = f"""
Do NOT repeat or closely rephrase any of these already-asked questions:
{json.dumps(asked_questions)}
"""

        variant_block = ""
        if variant_of:
            variant_block = f"""
The student previously answered this question on the same knowledge point:
{json.dumps({"question": variant_of.get("question"), "correct_answer": variant_of.get("correct_answer")})}
Your question must test the SAME underlying fact or idea, but in a genuinely DIFFERENT form — an
applied scenario, the reversed direction (given the answer, ask for the condition), a negative
framing ("which is NOT..."), or a new concrete example. It must NOT be answerable just by
remembering the earlier question's answer wording: do not reuse its options, and do not make the
earlier correct answer's text the correct option verbatim.
"""

        misconception_block = ""
        if misconceptions:
            misconception_block = f"""
In past sessions this student showed these misconceptions about this concept:
{json.dumps(misconceptions)}
Prefer a question that would reveal whether the student still holds one of these misconceptions —
for example by including a plausible wrong option that matches the misconception.
"""

        if answer_mode == "free_text":
            form_instruction = """Write ONE open-ended question the student must answer in their own words (1-3
sentences) — no answer options. "correct_answer" is the model answer: the complete, specific answer
you would accept, stated in 1-3 sentences."""
            schema = f"""{{
    "question": "...",
    "correct_answer": "the model answer in 1-3 sentences",
    "explanation": "...",
    "category": "{concept}",
    "difficulty": "{difficulty}"
}}"""
        else:
            form_instruction = "Write ONE multiple-choice question with exactly 4 answer options."
            schema = f"""{{
    "question": "...",
    "options": ["...", "...", "...", "..."],
    "correct_answer": "...",
    "explanation": "...",
    "category": "{concept}",
    "difficulty": "{difficulty}"
}}"""

        prompt = f"""Write ONE {difficulty} level question about {subject} that specifically tests
the concept "{concept}", based only on facts actually stated in the source text below.
{form_instruction}
{difficulty_instructions[difficulty]}
{avoid_block}{variant_block}{misconception_block}
Source text:
{text_content}

Respond with ONLY valid, minified JSON matching this schema, no text before or after:
{schema}"""

        messages = [
            {"role": "system", "content": self.base_system_message},
            {"role": "user", "content": prompt}
        ]

        try:
            response = await self._make_request(messages)
        except Exception:
            return None

        question = self._parse_json_response(response)
        if question is None:
            return None

        # One grounding pass, one retry — lighter than the quiz pipeline's
        # loop because the tutor is latency-sensitive (a student is waiting
        # between every single question). Free-text questions get the verify
        # pass but no regeneration (the regenerator produces multiple-choice)
        # — an ungrounded free-text question is kept, matching fail-open.
        verification = await self._verify_question(question, text_content)
        if verification is not None and not verification.get("grounded", True) and answer_mode != "free_text":
            feedback = verification.get("supporting_evidence") or "no supporting evidence found in the source text"
            regenerated = await self._regenerate_question(question, feedback, text_content, difficulty, subject)
            if regenerated is not None:
                question = regenerated

        question.setdefault("category", concept)
        question.setdefault("difficulty", difficulty)
        question["answer_mode"] = answer_mode
        if answer_mode == "free_text":
            question["options"] = []
        return question

    async def grade_free_text_answer(self, question: Dict, user_answer: str, text_content: str) -> Optional[Dict]:
        """Judge a student's typed answer against the model answer and the
        source text (ROADMAP 4.2).

        Returns {"verdict": "correct" | "partial" | "incorrect",
        "missing": str | None} where "missing" names what the answer lacked
        (set for partial/incorrect). Returns None if the grading call failed
        or returned unparseable JSON — callers should fail open (treat as
        correct) matching the pipeline-wide policy: an API failure must
        never punish the student.
        """
        text_content = self._truncate(text_content, 8000)

        prompt = f"""You are grading a student's short written answer against a model answer and the source text
the question was based on. Judge the substance, not the wording: accept synonyms, paraphrase, and
different sentence structure. Grade:
- "correct": the answer conveys the key point(s) of the model answer
- "partial": the answer has real, relevant substance but misses or gets wrong a key part
- "incorrect": the answer is wrong, off-topic, or empty of substance

Source text:
{text_content}

Question: {question.get('question')}
Model answer: {question.get('correct_answer')}
Student's answer: {user_answer}

Respond with ONLY valid, minified JSON matching this schema, no text before or after:
{{
    "verdict": "correct" or "partial" or "incorrect",
    "missing": "one sentence naming specifically what the answer missed or got wrong, or null if correct"
}}"""

        messages = [
            {"role": "system", "content": self.base_system_message},
            {"role": "user", "content": prompt}
        ]

        try:
            response = await self._make_request(messages)
        except Exception:
            return None

        parsed = self._parse_json_response(response)
        if parsed is None or parsed.get("verdict") not in ("correct", "partial", "incorrect"):
            return None
        return {"verdict": parsed["verdict"], "missing": parsed.get("missing")}

    async def diagnose_mistake(self, question: Dict, user_answer: str, text_content: str) -> Optional[str]:
        """Diagnose *why* a student's wrong answer was wrong — the likely
        misconception or gap, not just the correct answer.

        Returns a short diagnosis string, or None if the call failed —
        callers should degrade to showing only the explanation (fail open,
        this is a quality layer).
        """
        text_content = self._truncate(text_content, 8000)

        prompt = f"""A student answered a quiz question incorrectly. Diagnose WHY they likely chose that answer —
the specific misconception, mix-up, or knowledge gap it suggests — and what to review. Address the student
directly ("you"), be specific to their chosen answer (not generic), and keep it to 2-3 sentences.

Source text the question was based on:
{text_content}

Question: {question.get('question')}
Options: {json.dumps(question.get('options', []))}
Correct answer: {question.get('correct_answer')}
Student's answer: {user_answer}

Respond with ONLY valid, minified JSON matching this schema, no text before or after:
{{
    "diagnosis": "..."
}}"""

        messages = [
            {"role": "system", "content": self.base_system_message},
            {"role": "user", "content": prompt}
        ]

        try:
            response = await self._make_request(messages)
        except Exception:
            return None

        parsed = self._parse_json_response(response)
        if parsed is None or not parsed.get("diagnosis"):
            return None
        return parsed["diagnosis"]

    async def extract_key_topics(self, text_content: str) -> List[str]:
        """Extract key topics from text content for tagging"""
        prompt = f"""Analyze the following text and extract 5-8 key topics or themes.
        Return only the topics as a comma-separated list.
        
        Text: {self._truncate(text_content, 5000)}
        
        Topics:"""
        
        messages = [
            {"role": "system", "content": self.base_system_message},
            {"role": "user", "content": prompt}
        ]
        
        try:
            response = await self._make_request(messages)
            topics = [topic.strip() for topic in response.split(',')]
            return topics[:8]  # Limit to 8 topics
        except:
            return ["general"]

    async def generate_flashcards(self, text_content: str, num_cards: int, subject: str, card_type: str) -> Dict:
        """Generate flashcards based on the text content"""
        
        # Truncate content if too long
        text_content = self._truncate(text_content, 12000)
        
        card_type_instructions = {
            "definition": "Create cards with terms/concepts on the front and their definitions on the back.",
            "concept": "Create cards with conceptual questions on the front and explanations on the back.",
            "fact": "Create cards with factual questions on the front and specific answers on the back.",
            "mixed": "Create a mix of definitions, concepts, and factual questions."
        }
        
        prompt = f"""Create {num_cards} flashcards based on the following {subject} content.

        Card type: {card_type}
        Instructions: {card_type_instructions[card_type]}
        
        Content: {text_content}
        
        For each flashcard:
        1. Front: Question, term, or concept
        2. Back: Answer, definition, or explanation
        3. Keep both sides concise but informative
        4. Ensure the back fully answers what's on the front
        
        Provide your response in this JSON format:
        {{
            "flashcards": [
                {{
                    "front": "What is photosynthesis?",
                    "back": "The process by which plants convert light energy into chemical energy",
                    "category": "Biology"
                }}
            ]
        }}
        
        Make sure flashcards are directly based on the provided content and test key concepts."""
        
        messages = [
            {"role": "system", "content": self.base_system_message},
            {"role": "user", "content": prompt}
        ]
        
        response = await self._make_request(messages)
        
        try:
            # Extract JSON from response
            json_match = re.search(r'\{.*\}', response, re.DOTALL)
            if json_match:
                flashcard_data = json.loads(json_match.group())
                
                # Validate and limit flashcards to requested number
                if "flashcards" in flashcard_data and isinstance(flashcard_data["flashcards"], list):
                    flashcard_data["flashcards"] = flashcard_data["flashcards"][:num_cards]
                    return flashcard_data
                else:
                    raise ValueError("Invalid flashcard format")
            else:
                raise ValueError("No JSON found in response")
                
        except (json.JSONDecodeError, ValueError) as e:
            # Fallback: create a simple flashcard if parsing fails
            return {
                "flashcards": [{
                    "front": "Main topic",
                    "back": "Based on the content provided, this requires manual review as AI parsing failed.",
                    "category": subject
                }]
            } 