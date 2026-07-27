"""Render pages of a stored PDF to images, for the document viewer.

Separate from extraction_agent even though both use PyMuPDF: that module owns
turning a document into study material, this one owns showing the student the
document itself. They share a library, not a purpose.

Rendering happens on demand rather than at upload. Pre-rendering a 60-page
deck would mean 60 renders and 60 uploads for pages nobody may open, and would
roughly double what the document costs to store; a single page renders in
milliseconds. The cost accepted in exchange is that each page view fetches the
whole PDF — bounded by the 25 MB upload cap, and mitigated by caching the
rendered image at the HTTP layer.

Both functions here are sync and CPU-bound. Callers must run them in
asyncio.to_thread, following the precedent set by the DOCX/PPTX extractors —
a large PDF would otherwise stall every concurrent request.
"""
import fitz  # PyMuPDF

# 2x the PDF's native 72 DPI. Measured on a text-dense A4 page: 1x is 595x842
# and unreadable on screen, 2x is 1190x1684 at ~290 KB, 3x nearly doubles the
# bytes again for no legibility gain at typical viewport sizes.
DEFAULT_SCALE = 2.0


class RenderError(Exception):
    """The PDF could not be opened or the requested page does not exist.

    Distinct from a storage failure so the caller can tell "we have the file
    but can't display it" (a corrupt or password-protected PDF, still worth
    offering as a download) from "we couldn't fetch the file at all".
    """


def page_count(data: bytes) -> int:
    """Number of pages in a PDF held in memory."""
    try:
        with fitz.open(stream=data, filetype="pdf") as doc:
            return doc.page_count
    except Exception as exc:
        raise RenderError(f"Could not read this PDF: {exc}") from exc


def render_page(data: bytes, page_number: int, scale: float = DEFAULT_SCALE) -> bytes:
    """Render one zero-indexed page to PNG bytes.

    The page number is validated here rather than left to fitz, which raises a
    generic ValueError that would surface as a 500 instead of a 404.
    """
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise RenderError(f"Could not read this PDF: {exc}") from exc

    try:
        if not 0 <= page_number < doc.page_count:
            raise RenderError(
                f"Page {page_number} is out of range (this document has {doc.page_count})"
            )
        pixmap = doc.load_page(page_number).get_pixmap(matrix=fitz.Matrix(scale, scale))
        return pixmap.tobytes("png")
    except RenderError:
        raise
    except Exception as exc:
        raise RenderError(f"Could not render page {page_number}: {exc}") from exc
    finally:
        doc.close()
