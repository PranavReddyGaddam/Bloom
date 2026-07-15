import asyncio
import fitz  # PyMuPDF

from .ai_service import BloomAI

# Below this word count with no visual content, a page is treated as a
# title/agenda page and de-weighted rather than kept in full.
TITLE_PAGE_WORD_THRESHOLD = 15

# Minimum combined image + vector-drawing count on a page before it's worth
# paying for a vision call to describe it.
VISUAL_CONTENT_THRESHOLD = 1

MAX_ASSEMBLED_CHARS = 15000


def _classify_page(page: fitz.Page, text: str) -> str:
    """Classify a page as 'title', 'text', or 'visual' using cheap PyMuPDF metadata.

    No LLM call here — this is a rule-based pre-filter so vision calls are
    only made for pages that actually contain diagrams/charts/equations,
    keeping cost and latency down for the common case of text-heavy PDFs.
    """
    word_count = len(text.split())
    image_count = len(page.get_images())
    drawing_count = len(page.get_drawings())
    has_visual_content = (image_count + drawing_count) >= VISUAL_CONTENT_THRESHOLD

    if has_visual_content:
        return "visual"
    if word_count < TITLE_PAGE_WORD_THRESHOLD:
        return "title"
    return "text"


async def _describe_page(ai_service: BloomAI, image_bytes: bytes, fallback_text: str) -> str:
    try:
        return await ai_service.describe_page_image(image_bytes)
    except Exception:
        # Vision call failed (rate limit, provider issue, etc.) — degrade to
        # whatever plain text PyMuPDF could extract from the page rather than
        # losing the page's content entirely.
        return fallback_text


async def extract_structured(file_path: str, ai_service: BloomAI = None, progress=None) -> str:
    """Extract PDF text page-by-page, classifying each page and describing
    diagram/chart/equation pages via a vision model instead of silently
    dropping them, then assembling a token-budgeted context string.

    Replaces the previous flat `page.get_text()` concatenation + fixed
    character truncation.
    """
    if ai_service is None:
        ai_service = BloomAI()

    def _report(stage: str):
        if progress:
            progress(stage)

    _report("Reading pages")
    doc = fitz.open(file_path)

    title_parts = []
    text_parts = []
    visual_pages = []  # (raw_text, rendered PNG bytes), in page order

    try:
        # First pass is pure PyMuPDF (sync, CPU-bound): classify pages and
        # render visual ones to PNG so the doc can be closed before any
        # network calls happen.
        for page_num in range(doc.page_count):
            page = doc.load_page(page_num)
            raw_text = page.get_text().strip()
            classification = _classify_page(page, raw_text)

            if classification == "title":
                if raw_text:
                    title_parts.append(raw_text.splitlines()[0])
            elif classification == "visual":
                visual_pages.append((raw_text, page.get_pixmap().tobytes("png")))
            else:
                text_parts.append(raw_text)
    finally:
        doc.close()

    # Vision calls are independent per page — run them concurrently. Since
    # they finish out of order, progress reports completions, not positions.
    described_count = 0

    async def _describe_with_progress(raw_text: str, image_bytes: bytes) -> str:
        nonlocal described_count
        description = await _describe_page(ai_service, image_bytes, raw_text)
        described_count += 1
        _report(f"Describing diagrams and figures ({described_count} of {len(visual_pages)} pages)")
        return description

    if visual_pages:
        _report(f"Describing diagrams and figures (0 of {len(visual_pages)} pages)")
    descriptions = await asyncio.gather(
        *(_describe_with_progress(raw_text, image_bytes) for raw_text, image_bytes in visual_pages)
    )

    visual_parts = []
    for (raw_text, _), description in zip(visual_pages, descriptions):
        merged = raw_text
        if description:
            merged = f"{raw_text}\n[Figure description: {description}]" if raw_text else f"[Figure description: {description}]"
        visual_parts.append(merged)

    # Assemble in document order priority: dense text and visual descriptions
    # first (highest information density), title/agenda labels last and
    # trimmed first if the budget is exceeded.
    assembled = "\n\n".join(text_parts + visual_parts)

    if len(assembled) < MAX_ASSEMBLED_CHARS and title_parts:
        title_block = "\n".join(title_parts)
        remaining = MAX_ASSEMBLED_CHARS - len(assembled)
        assembled = assembled + "\n\n" + title_block[:remaining]

    if len(assembled) > MAX_ASSEMBLED_CHARS:
        assembled = assembled[:MAX_ASSEMBLED_CHARS] + "..."

    return assembled.strip()


def extract_structured_sync(file_path: str) -> str:
    """Sync wrapper for use from non-async call sites."""
    return asyncio.run(extract_structured(file_path))
