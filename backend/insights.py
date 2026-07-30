# ╔══════════════════════════════════════════════════════════════════════╗
# ║  insights.py  —  Gemini-generated 4C recommendations                 ║
# ╚══════════════════════════════════════════════════════════════════════╝
#
# The original app shipped a "Generate AI Analysis" button wired to nothing:
# <AIAnalysis /> was rendered with no props, so the handler was undefined and
# the empty state was permanent. This is that feature built for real, keeping
# the endpoint path the dead client function already named.
#
# ── Two rules shape the whole design ──────────────────────────────────
#
# 1. THE MODEL NEVER PRODUCES A NUMBER. It receives the figures and returns
#    words plus product IDs; the UI renders the real spend, revenue and ROI
#    from its own data beside each recommendation. A hallucinated figure is
#    therefore not "unlikely" but structurally impossible — there is nowhere
#    in the response for one to appear.
#
# 2. EVERY PRODUCT ID IS VERIFIED against the request before returning. An ID
#    the model invented is dropped and counted, so a recommendation can never
#    point at a product that does not exist.
#
# Together these mean an answer can be unhelpful, but it cannot be fabricated
# data presented as analysis.

import hashlib
import json
import os
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from auth import current_user
from models import User

router = APIRouter(prefix="/api", tags=["insights"])

# gemini-2.5-flash is the default because this is a short, structured,
# latency-sensitive call. Override with GEMINI_MODEL for a different tier.
DEFAULT_MODEL = "gemini-2.5-flash"
REQUEST_TIMEOUT_MS = 45_000

# Identical requests inside this window reuse the answer rather than paying for
# it twice — a double-clicked button should not be two billed calls.
CACHE_TTL_SECONDS = 600
_cache: dict[str, tuple[float, dict]] = {}

QUADRANT_KEYS = ("champions", "contenders", "cruisers", "casualties")

# What each quadrant means, so the model reasons inside this product's
# framework instead of inventing its own reading of the four names.
QUADRANT_MEANING = {
    "champions": "high revenue on low spend — the best scaling candidates",
    "contenders": "high revenue on high spend — carry the revenue base at real cost",
    "cruisers": "low revenue on low spend — cheap to run and cheap to retire",
    "casualties": "low revenue on high spend — burning budget without return",
}


# ── Wire shapes ───────────────────────────────────────────────────────
class BriefProduct(BaseModel):
    id: str = Field(max_length=64)
    title: str = Field(default="", max_length=300)
    spend: float
    revenue: float
    roi: float


class QuadrantBrief(BaseModel):
    key: str
    productCount: int
    spend: float
    revenue: float
    roi: float
    # Bounded so a large catalogue cannot become an unbounded prompt. The
    # aggregates above still cover every product, so the totals stay exact.
    topProducts: list[BriefProduct] = Field(default_factory=list, max_length=8)


class Thresholds(BaseModel):
    spend: float
    revenue: float


class Totals(BaseModel):
    products: int
    spend: float
    revenue: float
    roi: float


class InsightsRequest(BaseModel):
    """
    Aggregates are computed client-side by the same functions that render the
    screen, so the model comments on exactly the figures the operator is looking
    at. Recomputing them here would risk the advice describing a different view
    from the one on display.
    """
    currency: str = Field(default="INR", max_length=3)
    monthLabel: str | None = Field(default=None, max_length=120)
    thresholds: Thresholds
    totals: Totals
    quadrants: list[QuadrantBrief] = Field(max_length=4)


class QuadrantAdvice(BaseModel):
    quadrant: str
    action: str
    rationale: str
    productIds: list[str] = Field(default_factory=list)


class InsightsResponse(BaseModel):
    headline: str
    quadrants: list[QuadrantAdvice]
    watchOuts: list[str]
    model: str
    generatedAt: datetime
    cached: bool
    # How many invented product IDs were removed; 0 in the normal case.
    droppedProductIds: int


# ── Prompting ─────────────────────────────────────────────────────────
SYSTEM_INSTRUCTION = """\
You are a performance-marketing analyst advising a D2C brand on product-level \
ad spend. You are given a 4C quadrant breakdown of their catalogue.

The quadrants mean:
- champions: high revenue on low spend — the best scaling candidates
- contenders: high revenue on high spend — carry the revenue base at real cost
- cruisers: low revenue on low spend — cheap to run and cheap to retire
- casualties: low revenue on high spend — burning budget without return

Rules you must follow exactly:

1. NEVER state a number. Do not write any figure — no amounts, no ROI values, \
no percentages, no counts, no currency symbols. The interface displays the real \
figures beside your text, so any number you write would duplicate or contradict \
them. Describe magnitude in words instead ("the largest spender", "roughly \
break-even", "far below the others").
2. Refer to specific products only by their exact product ID, taken verbatim \
from the data given to you. Never invent an ID. Never guess an ID you were not \
given.
3. Give one concrete action per quadrant — something the operator does this \
week, not a principle. Prefer "pause these two and move the budget to the \
champions" over "optimise underperformers".
4. Be direct and specific. No preamble, no restating the question, no hedging \
about needing more data.
5. If a quadrant is empty, say plainly that it has no products and give no \
action for it.

You are advising on a real budget. Vague advice wastes the operator's money."""

# Only words and IDs — deliberately no numeric field anywhere in this schema.
RESPONSE_SCHEMA = {
    "type": "object",
    "required": ["headline", "quadrants", "watchOuts"],
    "properties": {
        "headline": {
            "type": "string",
            "description": "One sentence naming the single most important thing to do. No numbers.",
        },
        "quadrants": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["quadrant", "action", "rationale", "productIds"],
                "properties": {
                    "quadrant": {"type": "string", "enum": list(QUADRANT_KEYS)},
                    "action": {"type": "string", "description": "One concrete action. No numbers."},
                    "rationale": {"type": "string", "description": "Why, in one or two sentences. No numbers."},
                    "productIds": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Exact product IDs from the data. Never invented.",
                    },
                },
            },
        },
        "watchOuts": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Up to three risks in acting on this. No numbers.",
        },
    },
}


def build_prompt(body: InsightsRequest) -> str:
    """
    Renders the brief as compact JSON.

    JSON rather than prose: the figures reach the model unambiguously labelled,
    and there is no sentence structure for it to mimic when it is meant to be
    writing its own.
    """
    scope = body.monthLabel or "all available months"
    payload = {
        "currency": body.currency,
        "period": scope,
        "catalogueTotals": body.totals.model_dump(),
        "quadrantThresholds": body.thresholds.model_dump(),
        "quadrants": [
            {
                "key": q.key,
                "meaning": QUADRANT_MEANING.get(q.key, ""),
                "productCount": q.productCount,
                "totalSpend": q.spend,
                "totalRevenue": q.revenue,
                "roi": q.roi,
                "biggestSpenders": [p.model_dump() for p in q.topProducts],
            }
            for q in body.quadrants
        ],
    }
    return (
        f"Analyse this 4C breakdown. All amounts are in {body.currency}. "
        f"Period: {scope}.\n\n"
        f"{json.dumps(payload, separators=(',', ':'))}\n\n"
        "Return one entry per quadrant that has products. Remember: no numbers "
        "in your text, and only product IDs that appear above."
    )


# ── Grounding ─────────────────────────────────────────────────────────
def known_product_ids(body: InsightsRequest) -> set[str]:
    return {p.id for q in body.quadrants for p in q.topProducts}


def ground_response(raw: dict, body: InsightsRequest) -> tuple[list[QuadrantAdvice], int]:
    """
    Drops any product ID the model was not given.

    This is the check that makes the feature trustworthy: a model that invents a
    plausible-looking ID would otherwise send the operator to a product that
    does not exist, and they would have no way to tell.
    """
    allowed = known_product_ids(body)
    present = {q.key for q in body.quadrants if q.productCount > 0}

    advice: list[QuadrantAdvice] = []
    dropped = 0

    for entry in raw.get("quadrants") or []:
        key = str(entry.get("quadrant", "")).strip().lower()
        if key not in QUADRANT_KEYS:
            continue
        # Advice about a quadrant with no products is not actionable, whatever
        # it says, so it is discarded rather than shown.
        if key not in present:
            continue

        ids = [str(i).strip() for i in (entry.get("productIds") or [])]
        kept = [i for i in ids if i in allowed]
        dropped += len(ids) - len(kept)

        advice.append(
            QuadrantAdvice(
                quadrant=key,
                action=str(entry.get("action", "")).strip(),
                rationale=str(entry.get("rationale", "")).strip(),
                # Deduplicated while preserving the model's ordering.
                productIds=list(dict.fromkeys(kept)),
            )
        )

    # Present them in the product's canonical order, not the model's.
    advice.sort(key=lambda a: QUADRANT_KEYS.index(a.quadrant))
    return advice, dropped


def cache_key(body: InsightsRequest, model: str) -> str:
    digest = hashlib.sha256(
        json.dumps(body.model_dump(), sort_keys=True, separators=(",", ":")).encode()
        + model.encode()
    )
    return digest.hexdigest()


# ── Endpoint ──────────────────────────────────────────────────────────
@router.post("/ai-insights", response_model=InsightsResponse)
def ai_insights(
    body: InsightsRequest,
    _user: User = Depends(current_user),
) -> InsightsResponse:
    api_key = os.getenv("GOOGLE_API_KEY", "").strip()
    model = os.getenv("GEMINI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL

    # No key means the feature is unavailable, and the UI says so. It must never
    # fall back to canned text — invented advice about a real ad budget is worse
    # than no advice.
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI insights are not configured. Set GOOGLE_API_KEY on the API to enable them.",
        )

    if not any(q.productCount > 0 for q in body.quadrants):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="There are no products in the current view to analyse.",
        )

    key = cache_key(body, model)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL_SECONDS:
        return InsightsResponse(**{**hit[1], "cached": True})

    raw = call_gemini(build_prompt(body), api_key, model)
    advice, dropped = ground_response(raw, body)

    if not advice:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The model returned no usable recommendations. Try again.",
        )

    result = {
        "headline": str(raw.get("headline", "")).strip(),
        "quadrants": [a.model_dump() for a in advice],
        "watchOuts": [str(w).strip() for w in (raw.get("watchOuts") or [])][:3],
        "model": model,
        "generatedAt": datetime.now(timezone.utc),
        "droppedProductIds": dropped,
    }
    _cache[key] = (time.time(), result)
    return InsightsResponse(**result, cached=False)


def call_gemini(prompt: str, api_key: str, model: str) -> dict:
    """
    One structured call to Gemini.

    Imported lazily so the API starts and every other endpoint keeps working
    even if the SDK is missing from the environment.
    """
    try:
        from google import genai
        from google.genai import errors as genai_errors
        from google.genai import types
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The Gemini SDK is not installed on the API. Run: pip install google-genai",
        )

    client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS))

    try:
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
                response_schema=RESPONSE_SCHEMA,
                # Low but not zero: these are recommendations, and identical
                # phrasing every run reads as canned.
                temperature=0.3,
            ),
        )
    except genai_errors.ClientError as err:
        # 4xx from Google: a bad key, a disabled project, an unknown model.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gemini rejected the request: {err}",
        )
    except genai_errors.ServerError as err:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gemini is unavailable right now: {err}",
        )
    except Exception as err:  # network failure, timeout, SDK-level error
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not reach Gemini: {type(err).__name__}",
        )

    text = (response.text or "").strip()
    if not text:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Gemini returned an empty response.",
        )

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Gemini returned a response that could not be read as JSON.",
        )

    if not isinstance(parsed, dict):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Gemini returned an unexpected response shape.",
        )
    return parsed
