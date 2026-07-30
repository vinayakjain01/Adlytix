/**
 * Single fetch entry point for the API.
 *
 * `credentials: 'include'` is required on every call: the session lives in an
 * httpOnly cookie, which JavaScript cannot read or attach manually.
 */

import { captureError } from './analytics/client';

/**
 * Where the API lives.
 *
 * An empty string means "same origin", which is how both deployment targets
 * serve it: the API is routed under /api on the app's own domain. That is also
 * the default for a production build — falling back to localhost:8000 there
 * would point a deployed site at the visitor's own machine and fail with no
 * obvious cause. Development still defaults to the local API.
 *
 * Set NEXT_PUBLIC_API_URL explicitly only when the API is on a different host.
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:8000');

export class ApiError extends Error {
  readonly status: number;
  /** True when the caller has no usable session and should be signed out. */
  readonly isAuthError: boolean;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.isAuthError = status === 401 || status === 403;
  }
}

/** Pulls a human-readable message out of a FastAPI error body. */
async function readError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '');
  if (!raw) return `Request failed (HTTP ${response.status}).`;

  try {
    const parsed = JSON.parse(raw);
    const detail = parsed?.detail;
    if (typeof detail === 'string') return detail;
    // Pydantic validation errors arrive as an array of issues.
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (typeof first?.msg === 'string') return first.msg;
    }
    return raw;
  } catch {
    return raw;
  }
}

/**
 * Whether a failed request represents an application error worth alerting on.
 *
 * 401 and 403 are excluded on purpose: in this app they are the auth boundary
 * behaving exactly as designed — a signed-out visitor restoring a session, a
 * wrong password, an expired subscription. They are already measured as
 * `login_failed` and `session_invalidated`, so counting them again here would
 * bury real faults under routine sign-in noise.
 */
function isReportable(status: number): boolean {
  return status !== 401 && status !== 403;
}

/** Query strings are dropped to keep endpoint cardinality low in analytics. */
function endpointOf(path: string): string {
  return path.split('?')[0];
}

function reportApiError(error: ApiError, endpoint: string): void {
  captureError(error, {
    source: 'api',
    message: error.message,
    endpoint,
    status_code: error.status,
    component: null,
  });
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, credentials: 'include' });
  } catch {
    // A network-level failure — the API being down reads very differently from
    // a rejected request, so say so rather than surfacing "Failed to fetch".
    const offline = new ApiError(0, 'Could not reach the API. Check that the backend is running.');
    reportApiError(offline, endpointOf(path));
    throw offline;
  }

  if (!response.ok) {
    const failure = new ApiError(response.status, await readError(response));
    if (isReportable(failure.status)) reportApiError(failure, endpointOf(path));
    throw failure;
  }
  return response;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  return response.json() as Promise<T>;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return apiJson<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
