# ╔══════════════════════════════════════════════════════════════════════╗
# ║  currency.py  —  Source-currency normalisation                      ║
# ║                                                                      ║
# ║  WHY THIS EXISTS                                                     ║
# ║                                                                      ║
# ║  analytics.run_overall_view computes                                  ║
# ║      Total Spend = Meta Spend + Google Cost                          ║
# ║      ROI         = Shopify Revenue / Total Spend                     ║
# ║                                                                      ║
# ║  Those are only meaningful if all three arrive in the same currency.  ║
# ║  Meta exports commonly bill in USD while Shopify reports in INR, so   ║
# ║  the sum silently added dollars to rupees. A real example from the    ║
# ║  test fixtures: a $1,234.56 Meta spend was read as ₹1,234.56, giving  ║
# ║  ROI 10.18x for a product whose true ROI was 0.76x — a 13x error that ║
# ║  flips the recommendation from "scale" to "cut".                      ║
# ║                                                                      ║
# ║  Every amount is therefore converted to one base currency BEFORE any  ║
# ║  aggregation happens. Display-currency switching is a separate,       ║
# ║  purely cosmetic step that happens in the browser afterwards.         ║
# ║                                                                      ║
# ║  A missing rate is always an error. It is never treated as 1.0 —      ║
# ║  that assumption is the bug this module exists to prevent.            ║
# ╚══════════════════════════════════════════════════════════════════════╝

import json
import os
import time
import urllib.error
import urllib.request
from typing import Iterable

import pandas as pd

# Matches the currencies offered in the UI.
SUPPORTED = ("INR", "USD", "AED", "EUR", "GBP", "CAD")

DEFAULT_BASE = os.getenv("DEFAULT_BASE_CURRENCY", "INR").upper()

# Free, keyless, and covers all six of the above (ECB-only feeds omit AED).
RATE_PROVIDER_URL = os.getenv("RATE_PROVIDER_URL", "https://open.er-api.com/v6/latest/{base}")
RATE_TTL_SECONDS = int(os.getenv("RATE_TTL_SECONDS", str(6 * 3600)))
RATE_TIMEOUT_SECONDS = float(os.getenv("RATE_TIMEOUT_SECONDS", "8"))

# Money columns per source, as produced by data_cleaner. CTR is a percentage,
# and landing page views / items sold / conversions are counts — converting any
# of those would corrupt them, so only true amounts are listed.
MONEY_COLUMNS = {
    "meta": ["Amount spent (INR)", "CPM (cost per 1,000 impressions)"],
    "shopify": ["Total sales"],
    "google": ["Cost"],
}


class RateUnavailable(RuntimeError):
    """Raised when a conversion is required but no trustworthy rate exists."""


# ── Rate fetching ─────────────────────────────────────────────────────
# base -> (rates, fetched_at_epoch, provider_label)
_cache: dict[str, tuple[dict[str, float], float, str]] = {}


def _fetch_from_provider(base: str) -> tuple[dict[str, float], str]:
    url = RATE_PROVIDER_URL.format(base=base)
    request = urllib.request.Request(url, headers={"User-Agent": "adlytix/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=RATE_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError) as exc:
        raise RateUnavailable(f"Could not reach the exchange-rate service: {exc}") from exc

    rates = payload.get("rates") or payload.get("conversion_rates")
    if not isinstance(rates, dict) or not rates:
        raise RateUnavailable("The exchange-rate service returned no rates.")

    # Normalise to plain floats and keep only what we support.
    cleaned = {
        code: float(value)
        for code, value in rates.items()
        if code in SUPPORTED and isinstance(value, (int, float))
    }
    cleaned[base] = 1.0

    missing = [c for c in SUPPORTED if c not in cleaned]
    if missing:
        raise RateUnavailable(
            f"The exchange-rate service did not return rates for: {', '.join(missing)}."
        )

    host = url.split("/")[2] if "//" in url else url
    return cleaned, host


def get_rates(base: str, *, force: bool = False) -> tuple[dict[str, float], float, str]:
    """
    Rates expressed as "1 unit of `base` = N units of X", cached for
    RATE_TTL_SECONDS. Returns (rates, fetched_at_epoch, provider).
    """
    base = base.upper()
    if base not in SUPPORTED:
        raise RateUnavailable(f"{base} is not a supported currency.")

    cached = _cache.get(base)
    if cached and not force and (time.time() - cached[1]) < RATE_TTL_SECONDS:
        return cached

    try:
        rates, provider = _fetch_from_provider(base)
    except RateUnavailable:
        # A stale rate is far better than failing outright, and much better
        # than assuming parity — but the caller is told how old it is.
        if cached:
            return cached
        raise

    entry = (rates, time.time(), provider)
    _cache[base] = entry
    return entry


def conversion_factor(from_code: str, to_code: str, rates: dict[str, float]) -> float:
    """
    Multiplier turning an amount in `from_code` into `to_code`, where `rates`
    are quoted against `to_code` as the base.
    """
    from_code, to_code = from_code.upper(), to_code.upper()
    if from_code == to_code:
        return 1.0

    rate = rates.get(from_code)
    if not rate or rate <= 0:
        raise RateUnavailable(
            f"No usable exchange rate for {from_code} to {to_code}."
        )
    # rates[X] answers "1 to_code = X from_code", so invert it.
    return 1.0 / rate


def convert_columns(
    df: pd.DataFrame,
    columns: Iterable[str],
    factor: float,
) -> pd.DataFrame:
    """Scales the named columns in place-ish (on a copy) by `factor`."""
    if factor == 1.0:
        return df
    out = df.copy()
    for column in columns:
        if column in out.columns:
            out[column] = pd.to_numeric(out[column], errors="coerce").fillna(0) * factor
    return out


def normalise_sources(
    frames: dict[str, pd.DataFrame | None],
    source_currencies: dict[str, str],
    base: str,
) -> tuple[dict[str, pd.DataFrame | None], dict]:
    """
    Converts every frame's money columns into `base`.

    Returns the converted frames plus an audit record describing exactly what
    was applied, so a run can be explained after the fact rather than the
    numbers simply changing.
    """
    base = base.upper()
    if base not in SUPPORTED:
        raise RateUnavailable(f"{base} is not a supported base currency.")

    declared = {
        source: (source_currencies.get(source) or base).upper()
        for source in ("meta", "shopify", "google")
    }
    for source, code in declared.items():
        if code not in SUPPORTED:
            raise RateUnavailable(f"{code} (declared for {source}) is not a supported currency.")

    # Only the sources that were actually supplied matter.
    present = {s for s, f in frames.items() if f is not None and not f.empty}
    needs_conversion = any(declared[s] != base for s in present)

    rates: dict[str, float] = {code: 1.0 for code in SUPPORTED}
    fetched_at: float | None = None
    provider = "not required"

    if needs_conversion:
        rates, fetched_at, provider = get_rates(base)

    out: dict[str, pd.DataFrame | None] = {}
    applied: dict[str, dict] = {}

    for source, frame in frames.items():
        code = declared[source]
        if frame is None or frame.empty:
            out[source] = frame
            applied[source] = {"currency": code, "factor": None, "converted": False}
            continue

        factor = conversion_factor(code, base, rates)
        out[source] = convert_columns(frame, MONEY_COLUMNS.get(source, []), factor)
        applied[source] = {
            "currency": code,
            "factor": factor,
            "converted": factor != 1.0,
            "columns": [c for c in MONEY_COLUMNS.get(source, []) if c in frame.columns],
        }

    audit = {
        "base": base,
        "sources": applied,
        "converted": needs_conversion,
        "rateProvider": provider,
        "ratesFetchedAt": fetched_at,
        # Quoted the way a person reads them: "1 USD = 95.86 INR".
        "rates": (
            {code: (1.0 / rate) for code, rate in rates.items() if rate > 0}
            if needs_conversion
            else None
        ),
        "stale": bool(
            needs_conversion
            and fetched_at is not None
            and (time.time() - fetched_at) > RATE_TTL_SECONDS
        ),
    }
    return out, audit
