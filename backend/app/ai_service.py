import os
import requests
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
            response = requests.post(self.url, headers=self.headers, json=data)
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
            response = requests.post(self.url, headers=self.headers, json=data)
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

    async def generate_summary(self, text_content: str, summary_type: str, subject: Optional[str] = None) -> Dict:
        """Generate a summary based on the specified type"""

        # Truncate content if too long (approximate token limit)
        max_chars = 15000  # Rough estimate for token limits
        if len(text_content) > max_chars:
            text_content = text_content[:max_chars] + "..."

        subject_context = f" in the field of {subject}" if subject else ""

        if summary_type == "short":
            prompt = f"""Create a concise summary of the following text{subject_context}.
            Keep it to 2-3 paragraphs maximum, focusing on the most important points.

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
            critique = await self._critique_summary(draft, text_content, summary_type)
            if critique and critique.get("needs_revision") and critique.get("issues"):
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
        self, questions: List[Dict], text_content: str, difficulty: str, subject: str
    ) -> List[Dict]:
        """Verify each question against the source text, regenerating
        ungrounded ones (up to 2 retries) before dropping and backfilling
        with a fresh replacement. Fails open at every step — any verify or
        regenerate call that errors out just keeps the current candidate
        rather than losing a question over unrelated API trouble.
        """
        MAX_RETRIES = 2
        result: List[Dict] = []

        for question in questions:
            current = question
            verified_grounded = False

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

            result.append(current)

        return result

    async def generate_quiz(self, text_content: str, num_questions: int, subject: str, difficulty: str) -> Dict:
        """Generate a quiz based on the text content"""
        
        # Truncate content if too long
        max_chars = 12000  # Leave room for the prompt
        if len(text_content) > max_chars:
            text_content = text_content[:max_chars] + "..."
        
        difficulty_instructions = {
            "easy": "Focus on basic concepts, definitions, and straightforward facts. Avoid complex reasoning.",
            "medium": "Include some analysis and application questions. Mix factual and conceptual questions.",
            "hard": "Focus on critical thinking, analysis, synthesis, and complex problem-solving."
        }
        
        prompt = f"""Create a {difficulty} level quiz with {num_questions} multiple-choice questions based on the following {subject} content.

        Difficulty level: {difficulty}
        Instructions: {difficulty_instructions[difficulty]}

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
                    quiz_data["questions"] = await self._ground_questions(
                        quiz_data["questions"], text_content, difficulty, subject
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
    
    async def extract_key_topics(self, text_content: str) -> List[str]:
        """Extract key topics from text content for tagging"""
        prompt = f"""Analyze the following text and extract 5-8 key topics or themes.
        Return only the topics as a comma-separated list.
        
        Text: {text_content[:5000]}...
        
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
        max_chars = 12000
        if len(text_content) > max_chars:
            text_content = text_content[:max_chars] + "..."
        
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