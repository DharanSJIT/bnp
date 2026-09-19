"""BNP Paribas knowledge-base chat — retrieval + Groq (RAG).

Retrieves the most relevant sections of bnp_paribas_knowledge_base.txt for the
user's question, then answers with Groq chat completions grounded ONLY in those
excerpts. If the Groq key/model is unavailable the module falls back to a
deterministic excerpt answer so the chat never breaks.

The knowledge base is written in question-answer-friendly language, so simple
token-overlap retrieval is sufficient — no embeddings pipeline required.
"""
import os
import re
from collections import Counter
from pathlib import Path

try:  # pragma: no cover
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
except Exception:  # noqa: BLE001
    pass

try:  # pragma: no cover
    from groq import Groq
except Exception:  # pragma: no cover
    Groq = None

# --------------------------------------------------------------------------
# knowledge base location / model
# --------------------------------------------------------------------------

_KB_CANDIDATES = (
    ([Path(os.environ["BNP_KB_PATH"])] if os.environ.get("BNP_KB_PATH") else [])
    + [
        Path(__file__).resolve().parents[3] / "bnp_paribas_knowledge_base.txt",  # repo root
        Path(__file__).resolve().parents[2] / "bnp_paribas_knowledge_base.txt",  # ai-service dir
        Path.cwd() / "bnp_paribas_knowledge_base.txt",
    ]
)

_KB_PATH = next((p for p in _KB_CANDIDATES if p.exists()), None)

MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")

_TOKEN_RE = re.compile(r"[a-z0-9']+")
_HEADING_RE = re.compile(r"^\d+(\.\d+)*[.\s]+\S")
_SEPARATOR_RE = re.compile(r"^={5,}\s*$")

# Generic stopwords — removed so long sentences don't drown out the distinctive
# factual terms (country names, employee counts, product names).
_STOP = {
    "the", "and", "of", "to", "a", "in", "for", "is", "are", "that", "with",
    "on", "by", "as", "at", "its", "it", "or", "an", "their", "this", "these",
    "what", "how", "why", "who", "which", "where", "when", "does", "do", "can",
    "please", "tell", "me", "about", "from", "into", "than", "then", "there",
    "also", "has", "have", "had", "be", "been", "was", "were", "not", "no",
    "you", "your", "i", "we", "they", "he", "she", "will", "would", "should",
    "could", "may", "might", "must", "all", "any", "some", "each", "more",
    "most", "other", "such", "both", "one", "two", "over", "under", "between",
    "out", "up", "down", "if", "so", "than",
}

_chunks_cache = None


# --------------------------------------------------------------------------
# chunking
# --------------------------------------------------------------------------

def _chunks():
    """Split the KB into searchable sections (cached)."""
    global _chunks_cache
    if _chunks_cache is not None:
        return _chunks_cache
    if not _KB_PATH:
        _chunks_cache = []
        return _chunks_cache
    text = _KB_PATH.read_text(encoding="utf-8", errors="replace")
    chunks = []
    title = "BNP Paribas — Knowledge Base"
    current = []

    def flush():
        nonlocal current
        body = "\n".join(current).strip()
        if body:
            chunks.append({"title": title, "text": f"{title}\n{body}"})
        current = []

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or _SEPARATOR_RE.match(stripped):
            continue
        if len(stripped) < 120 and _HEADING_RE.match(stripped):
            flush()
            title = stripped
            continue
        current.append(line)
    flush()

    # split oversized sections into smaller overlapping windows
    _chunks_cache = _split_long(chunks, limit=1700)
    return _chunks_cache


def _split_long(chunks, limit=1700):
    out = []
    for c in chunks:
        if len(c["text"]) <= limit:
            out.append(c)
            continue
        parts = re.split(r"(?<=\n\n)", c["text"])
        buf = ""
        for part in parts:
            if buf and len(buf) + len(part) > limit:
                out.append({"title": c["title"], "text": buf.strip()})
                buf = part
            else:
                buf += part
        if buf.strip():
            out.append({"title": c["title"], "text": buf.strip()})
    return out


# --------------------------------------------------------------------------
# retrieval
# --------------------------------------------------------------------------

def _tokens(text):
    return Counter(_TOKEN_RE.findall(text.lower()))


def _score(query_tokens, chunk_tokens):
    terms = set(query_tokens) - _STOP
    if not terms:
        return 0
    covered = sum(1 for t in terms if chunk_tokens[t] > 0)
    frequency = sum(chunk_tokens[t] for t in terms)
    return frequency * (covered / len(terms))


def _retrieve(question, top=3):
    qt = _tokens(question)
    ranked = sorted(
        ((_score(qt, _tokens(c["text"])), c) for c in _chunks()),
        key=lambda x: -x[0],
    )
    hits = [c for s, c in ranked if s > 0][:top]
    if not hits and _chunks():
        hits = [_chunks()[0]]  # overview fallback so Groq can say "not in KB"
    return hits or []


# --------------------------------------------------------------------------
# groq completion
# --------------------------------------------------------------------------

def _clean_answer(text):
    """Strip markdown emphasis and any source-citation markers the model adds,
    so the chat shows clean plain text (e.g. no **bold**, no 【32. …】)."""
    if not text:
        return text
    cleaned = text
    # bracketed citations: 【32. COMMON QUESTIONS AND ANSWERS】 / [1] / (see Section ..)
    cleaned = re.sub(r"【[^】]*】", "", cleaned)
    cleaned = re.sub(r"\[\d+(?:\.\d+)?\]", "", cleaned)
    cleaned = re.sub(r"\(see\s[^)]*\)", "", cleaned, flags=re.IGNORECASE)
    # markdown emphasis / code markers
    cleaned = cleaned.replace("**", "").replace("__", "").replace("`", "")
    # heading markers and stray hashes
    cleaned = re.sub(r"^#{1,6}\s*", "", cleaned, flags=re.MULTILINE)
    # collapse leftover blank lines and stray double spaces
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _groq_answer(question, context):
    key = os.environ.get("GROQ_API_KEY", "").strip()
    if not key or Groq is None:
        return None
    client = Groq(api_key=key)
    system = (
        "You are the BNP Paribas assistant embedded in OneRecon. Answer the "
        "user's question about BNP Paribas using ONLY the knowledge-base "
        "excerpts below. Be concise and factual; do not invent figures. If the "
        "information is not present in the excerpts, say it is not in the "
        "knowledge base rather than guessing.\n\n"
        "FORMATTING RULES — strictly follow these:\n"
        "- Write in PLAIN TEXT only. No markdown at all: no **, no *, no __, no "
        "# headings, no backticks.\n"
        "- Do NOT include any source references, citations, section names, or "
        "bracketed notes like 【32. …】 anywhere in the answer.\n"
        "- You may use simple dashes (-) for lists and blank lines between "
        "paragraphs, but nothing else.\n"
        "### KNOWLEDGE-BASE EXCERPTS ###\n" + context
    )
    res = client.chat.completions.create(
        model=MODEL,
        temperature=0.2,
        max_tokens=500,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": question},
        ],
    )
    return res.choices[0].message.content


# --------------------------------------------------------------------------
# public entry
# --------------------------------------------------------------------------

def answer(question):
    question = (question or "").strip()
    if not question:
        return {
            "answer": "Ask me anything about BNP Paribas — e.g. “How many countries does BNP Paribas operate in?”",
            "sources": [],
            "usedGroq": False,
        }
    if not _KB_PATH:
        return {
            "answer": "The BNP Paribas knowledge base file was not found. Place bnp_paribas_knowledge_base.txt in the project root.",
            "sources": [],
            "usedGroq": False,
        }

    hits = _retrieve(question)
    context = "\n\n---\n\n".join(c["text"] for c in hits)
    sources = [{"title": c["title"]} for c in hits]

    try:
        answer_text = _clean_answer(_groq_answer(question, context))
        if answer_text:
            return {
                "answer": answer_text,
                "sources": sources,
                "usedGroq": True,
            }
    except Exception as err:  # noqa: BLE001 — never let the chat 500
        error_note = str(getattr(err, "message", None) or err)
        return {
            "answer": (
                "The BNP Paribas assistant could not reach the language model "
                "right now (detail: %s). Here is the most relevant knowledge-base "
                "excerpt:\n\n%s"
            ) % (error_note[:200], hits[0]["text"][:900] if hits else ""),
            "sources": sources,
            "usedGroq": False,
        }

    # No Groq key configured — grounded excerpt fallback
    return {
        "answer": (
            "Based on the BNP Paribas knowledge base:\n\n%s"
            % (hits[0]["text"][:1100] if hits else "No relevant section found.")
        ),
        "sources": sources,
        "usedGroq": False,
    }