# backend/main.py
import os, io, math, sys, traceback

# Loads backend/.env before anything reads the environment. This has to happen
# above the local imports below: security.py resolves JWT_SECRET at import time,
# so a later call would be too late. Real environment variables always win, so
# this changes nothing in production (App Platform injects them directly) and
# nothing in the test suites, which set os.environ before importing this module.
from dotenv import load_dotenv # type: ignore
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from fastapi import Depends, FastAPI, UploadFile, File, HTTPException # type: ignore
from fastapi.middleware.cors import CORSMiddleware # type: ignore
import pandas as pd
from data_cleaner import clean_meta, clean_shopify, clean_google
from analytics import run_overall_view, run_product_analysis, run_discount_analysis, clean_pid
from auth import current_user, init_auth, router as auth_router
from insights import router as insights_router
from currency import DEFAULT_BASE, RateUnavailable, SUPPORTED, get_rates, normalise_sources
from models import User

app = FastAPI(title="ROASify API")

# ── CORS ──────────────────────────────────────────────────────────────
# The session lives in an httpOnly cookie, so requests are credentialed — and
# the CORS spec forbids credentials against a wildcard origin (browsers reject
# the response outright). Origins must therefore be listed explicitly. The
# previous "*" default silently produced exactly that invalid combination.
_DEV_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
_raw_origins = os.getenv("CORS_ORIGINS", "").strip()

if _raw_origins and _raw_origins != "*":
    ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]
else:
    ALLOWED_ORIGINS = _DEV_ORIGINS
    if _raw_origins == "*":
        print(
            "[cors] CORS_ORIGINS='*' cannot be used with cookie auth — falling "
            f"back to {_DEV_ORIGINS}. Set CORS_ORIGINS to your frontend URL.",
            file=sys.stderr,
        )

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(insights_router)


@app.on_event("startup")
def _startup() -> None:
    """Creates the auth tables and seeds the first administrator."""
    try:
        init_auth()
    except Exception as exc:  # pragma: no cover - surfaced in logs
        # A database that is not reachable must not stop the service from
        # booting; /health stays up and every protected route returns 401.
        print(f"[auth] Initialisation failed: {exc}", file=sys.stderr)


def _safe(v):
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def df_to_records(df: pd.DataFrame) -> list:
    return [
        {k: _safe(v) for k, v in row.items()}
        for row in df.to_dict(orient="records")
    ]


@app.post("/api/analyse")
async def analyse(
    meta_file:     UploadFile = File(...),
    shopify_file:  UploadFile = File(...),
    google_file:   UploadFile = File(None),
    discount_file: UploadFile = File(None),
    spend_pct_thresh: float = 100,
    rev_pct_thresh:   float = 100,
    # ── Currency ─────────────────────────────────────────────────────
    # The currency every figure is normalised into, and what each upload is
    # denominated in. Sources default to the base, so omitting all four leaves
    # behaviour identical to before.
    base_currency:     str = DEFAULT_BASE,
    meta_currency:     str = "",
    shopify_currency:  str = "",
    google_currency:   str = "",
    # Requires a valid session, and re-checks suspension and subscription
    # expiry against the database on every call.
    _user: User = Depends(current_user),
):
    # ── Read uploads ──────────────────────────────────────────────────
    meta_bytes    = await meta_file.read()
    shopify_bytes = await shopify_file.read()

    meta_io    = io.BytesIO(meta_bytes);    meta_io.name    = meta_file.filename
    shopify_io = io.BytesIO(shopify_bytes); shopify_io.name = shopify_file.filename

    # ── Clean Meta + Shopify ─────────────────────────────────────────
    try:
        meta_df,    meta_warns    = clean_meta(meta_io)
        shopify_df, shopify_warns = clean_shopify(shopify_io)
    except Exception as e:
        tb = traceback.format_exc()
        raise HTTPException(status_code=422, detail=f"File parsing error: {e}\n\n{tb}")

    if len(meta_df) == 0:
        raise HTTPException(status_code=422, detail="Meta file: no valid product rows after cleaning. Check the file format.")
    if len(shopify_df) == 0:
        raise HTTPException(status_code=422, detail="Shopify file: no valid product rows after cleaning. Check the file format.")

    # ── Clean Google (optional) ──────────────────────────────────────
    google_df    = None
    google_warns = []
    if google_file:
        try:
            google_bytes = await google_file.read()
            google_io    = io.BytesIO(google_bytes); google_io.name = google_file.filename
            google_df, google_warns = clean_google(google_io)
        except Exception as e:
            google_warns = [f"Google file skipped: {e}"]

    # ── Clean Discount list (optional) ──────────────────────────────
    discount_df    = None
    discount_warns = []
    if discount_file:
        try:
            disc_bytes   = await discount_file.read()
            disc_io      = io.BytesIO(disc_bytes); disc_io.name = discount_file.filename
            # Simple: read as CSV, expect a "Product ID" column
            disc_df_raw  = pd.read_csv(disc_io, encoding='utf-8-sig') if disc_io.name.endswith('.csv') \
                           else pd.read_excel(disc_io)
            disc_df_raw.columns = [str(c).strip() for c in disc_df_raw.columns]
            pid_col = next((c for c in disc_df_raw.columns if 'product id' in c.lower()), None)
            if pid_col:
                discount_df = disc_df_raw.rename(columns={pid_col: "Product ID"})
            else:
                discount_warns = ["Discount file: 'Product ID' column not found."]
        except Exception as e:
            discount_warns = [f"Discount file skipped: {e}"]

    # ── Normalise every source into one base currency ────────────────
    # Runs BEFORE any aggregation, because Total Spend and ROI add and divide
    # across sources — mixing currencies there produces numbers that look
    # plausible and are wrong. See currency.py for the worked example.
    # Sources default to the base currency, so omitting these parameters
    # reproduces the previous behaviour exactly.
    try:
        converted, currency_audit = normalise_sources(
            {"meta": meta_df, "shopify": shopify_df, "google": google_df},
            {
                "meta": meta_currency,
                "shopify": shopify_currency,
                "google": google_currency,
            },
            base_currency,
        )
        meta_df, shopify_df, google_df = (
            converted["meta"], converted["shopify"], converted["google"],
        )
    except RateUnavailable as e:
        # Refuse rather than fall back to parity, which is the very bug this
        # step exists to prevent.
        raise HTTPException(
            status_code=422,
            detail=(
                f"Currency conversion is required but unavailable: {e} "
                "Set every source to the same currency as the base to continue "
                "without conversion."
            ),
        )

    if currency_audit.get("stale"):
        google_warns = list(google_warns) + [
            "Exchange rates could not be refreshed — a cached rate was used."
        ]

    # ── Run Overall View ─────────────────────────────────────────────
    try:
        merged_df, has_month = run_overall_view(meta_df, shopify_df, google_df)
    except Exception as e:
        tb = traceback.format_exc()
        raise HTTPException(status_code=500, detail=f"Merge error: {e}\n\n{tb}")

    # ── Tag merged rows with discount membership ─────────────────────
    # The discount list was already being parsed and handed to
    # run_discount_analysis, but the per-product rows returned to the client
    # carried no flag — so the Discount screen always saw every product as
    # non-discounted. Uses the same clean_pid normalisation as the discount
    # engine so the two agree. Always present, so the response shape is stable.
    disc_ids = set()
    if discount_df is not None and "Product ID" in discount_df.columns:
        disc_ids = {clean_pid(v) for v in discount_df["Product ID"].dropna()}

    merged_df["Discounted"] = (
        merged_df["Product ID"].apply(clean_pid).isin(disc_ids) if disc_ids
        else False
    )

    # ── Run Product Analysis ─────────────────────────────────────────
    try:
        product_result = run_product_analysis(
            meta_df, shopify_df,
            spend_pct_thresh=spend_pct_thresh,
            rev_pct_thresh=rev_pct_thresh,
        )
    except Exception as e:
        tb = traceback.format_exc()
        raise HTTPException(status_code=500, detail=f"Product analysis error: {e}\n\n{tb}")

    # ── Run Discount Analysis (only if discount file provided) ───────
    discount_data = None
    if discount_df is not None:
        try:
            disc_result = run_discount_analysis(
                meta_df, shopify_df,
                discount=discount_df,          # ← correctly passed now
                spend_pct_thresh=spend_pct_thresh,
                rev_pct_thresh=rev_pct_thresh,
            )
            disc_df_out, months_ordered, disc_merged, insights, overall_insights, title_map = disc_result
            discount_data = {
                "summary":       df_to_records(disc_df_out),
                "monthsOrdered": months_ordered,
            }
        except Exception as e:
            discount_warns.append(f"Discount analysis skipped: {e}")

    # ── Build KPIs ───────────────────────────────────────────────────
    kpis = {
        "totalProducts":   int(merged_df["Product ID"].nunique()),
        "totalMetaSpend":  float(merged_df["Meta Spend"].sum())      if "Meta Spend"      in merged_df.columns else 0,
        "totalGoogleCost": float(merged_df["Google Cost"].sum())     if "Google Cost"     in merged_df.columns else 0,
        "totalSpend":      float(merged_df["Total Spend"].sum())     if "Total Spend"     in merged_df.columns else 0,
        "totalRevenue":    float(merged_df["Shopify Revenue"].sum()) if "Shopify Revenue" in merged_df.columns else 0,
    }
    kpis["overallRoi"] = kpis["totalRevenue"] / kpis["totalSpend"] if kpis["totalSpend"] else 0

    return {
        "ok":           True,
        "hasMonth":     has_month,
        "hasGoogle":    google_df is not None,
        # Lets the client tell "no discount list uploaded" apart from
        # "uploaded, but nothing matched".
        "hasDiscount":  discount_df is not None,
        "discountedProducts": int(len(disc_ids)),
        # What every figure below is denominated in, which rate was applied to
        # each source, and where it came from — so a run can be audited rather
        # than the numbers just changing.
        "currency":     currency_audit,
        "products":     df_to_records(merged_df),
        "kpis":         kpis,
        "quadrants": {
            "q1":    df_to_records(product_result["q1"]),
            "q2":    df_to_records(product_result["q2"]),
            "q3":    df_to_records(product_result["q3"]),
            "q4":    df_to_records(product_result["q4"]),
            "spCut": _safe(product_result["sp_cut"]),
            "rvCut": _safe(product_result["rv_cut"]),
        },
        "discountData": discount_data,
        "warnings":     meta_warns + shopify_warns + google_warns + discount_warns,
        "summary": {
            "products":    product_result["all"].to_dict(orient="records") if not product_result["all"].empty else [],
            "total_spend": kpis["totalSpend"],
            "total_rev":   kpis["totalRevenue"],
            "roi":         kpis["overallRoi"],
            "meta_spend":  kpis["totalMetaSpend"],
            "google_cost": kpis["totalGoogleCost"],
        },
    }


@app.get("/api/rates")
def rates(
    base: str = DEFAULT_BASE,
    refresh: bool = False,
    _user: User = Depends(current_user),
):
    """
    Live exchange rates, quoted the way they are read: "1 USD = 95.86 INR".
    Used for the display-currency switch and shown on the Settings screen.
    """
    base = base.upper()
    if base not in SUPPORTED:
        raise HTTPException(
            status_code=422,
            detail=f"{base} is not supported. Choose one of: {', '.join(SUPPORTED)}.",
        )

    try:
        raw, fetched_at, provider = get_rates(base, force=refresh)
    except RateUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))

    return {
        "base": base,
        # raw[X] means "1 base = X of currency X"; invert for readability.
        "rates": {code: (1.0 / value) for code, value in raw.items() if value > 0},
        "fetchedAt": fetched_at,
        "provider": provider,
        "supported": list(SUPPORTED),
    }


@app.get("/health")
def health():
    return {"status": "ok"}