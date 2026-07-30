import type { PostHog } from 'posthog-js';
import type { SessionUser } from '@/lib/auth';
import { SCREEN_FALLBACK, type BaseProperties, type EventMap, type EventName } from './events';

/**
 * PostHog wrapper.
 *
 * Every export here is safe to call unconditionally. When no project key is
 * configured the whole module is a no-op: the SDK is never even downloaded, so
 * the app behaves identically — and costs identically — with analytics off.
 * That is also how the test suites run.
 *
 * The SDK is loaded dynamically for the same reason. It is ~75KB gzipped, it is
 * needed by no first paint, and this module is imported by the HTTP layer and
 * the app context, so a static import would pull it into the main bundle for
 * every visitor whether or not analytics is even enabled.
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '';
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';
const UI_HOST = process.env.NEXT_PUBLIC_POSTHOG_UI_HOST ?? 'https://us.posthog.com';
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';

/**
 * Session replay is OFF unless explicitly enabled.
 *
 * Replay of this product records the client's spend and revenue tables and
 * ships them to a third party. "User Sessions" is satisfied by PostHog's
 * session tracking — session count, duration, entry and exit screens — which
 * comes free with ordinary event capture and needs no replay. Replay is
 * therefore a deliberate, separately-flagged decision rather than a default.
 */
const REPLAY_ENABLED = process.env.NEXT_PUBLIC_POSTHOG_SESSION_REPLAY === 'true';

export const analyticsEnabled = KEY.length > 0;

let client: PostHog | null = null;
let loading = false;
let currentScreen = SCREEN_FALLBACK;

/**
 * Calls made before the SDK finishes loading, replayed in order once it does.
 * Bounded because an unbounded buffer on a failed load is a memory leak, and
 * because the first events (sign-in, first pageview) are the ones worth keeping.
 */
const pending: Array<(instance: PostHog) => void> = [];
const PENDING_LIMIT = 50;

function enqueue(action: (instance: PostHog) => void): void {
  if (!analyticsEnabled) return;
  if (client) {
    action(client);
    return;
  }
  if (pending.length < PENDING_LIMIT) pending.push(action);
}

export function initAnalytics(): void {
  if (!analyticsEnabled || loading || client || typeof window === 'undefined') return;
  loading = true;

  void import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: HOST,
        ui_host: UI_HOST,

        /**
         * Autocapture is disabled deliberately and must stay disabled.
         *
         * Autocapture attaches the text content of clicked elements. On the
         * product table, the 4C scatter and every KPI card, that text *is* the
         * client's revenue, spend and product names — so leaving it on would
         * export client business data on every click. All meaningful
         * interactions are captured explicitly instead.
         */
        autocapture: false,

        // Captured manually so each pageview carries a screen label and a
        // measured duration; see components/analytics/analytics-provider.tsx.
        capture_pageview: false,
        capture_pageleave: false,

        // No anonymous profiles: the only unauthenticated screen is sign-in, so
        // a profile created before login has nobody attached to it.
        person_profiles: 'identified_only',

        disable_session_recording: !REPLAY_ENABLED,
        session_recording: {
          // Mask everything that could carry client data: maskTextSelector '*'
          // covers table cells and KPI figures, and inputs are masked wholesale
          // because they include the sign-in form.
          maskAllInputs: true,
          maskTextSelector: '*',
        },

        persistence: 'localStorage+cookie',
        // The app and the API are separate origins in production.
        cross_subdomain_cookie: false,
      });

      client = posthog;
      for (const action of pending) action(posthog);
      pending.length = 0;
    })
    .catch(() => {
      // A blocked or failed SDK load must not break the app or retry forever.
      // Analytics simply stays off for this page load.
      loading = false;
      pending.length = 0;
    });
}

/** Tracks which screen subsequent events belong to. */
export function setAnalyticsScreen(screen: string): void {
  currentScreen = screen;
}

function baseProperties(): BaseProperties {
  return { screen: currentScreen, app_version: APP_VERSION };
}

/**
 * Records an event. The property shape is fixed by `EventMap`, which is what
 * keeps business data out of the payload — see the contract in events.ts.
 */
export function track<E extends EventName>(event: E, properties: EventMap[E]): void {
  // Resolved now rather than at flush time so a queued event reports the screen
  // it actually happened on.
  const base = baseProperties();
  enqueue((instance) => instance.capture(event, { ...base, ...properties }));
}

/**
 * Binds events to the signed-in operator.
 *
 * The distinct ID is the opaque user UUID, never the email. Email and name are
 * set as person properties because an operator analysing their own product's
 * usage needs to recognise the account; no client business data is included.
 */
export function identifyUser(user: SessionUser): void {
  enqueue((instance) => {
    instance.identify(user.id, {
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      is_platform_admin: user.isPlatformAdmin,
      client_id: user.client?.id ?? null,
      client_name: user.client?.name ?? null,
    });
    if (user.client) {
      // Groups give per-tenant usage without tenants' data ever mixing.
      instance.group('client', user.client.id, { name: user.client.name });
    }
  });
}

/** Ends attribution on sign-out so the next operator starts a clean session. */
export function resetAnalytics(): void {
  enqueue((instance) => instance.reset());
}

/**
 * Reports an error to PostHog's error tracking and as a queryable event.
 *
 * Both are sent on purpose: `captureException` feeds the error-tracking product
 * with a stack trace, while `app_error` is a plain event so error rates can sit
 * in the same funnels and dashboards as everything else.
 */
export function captureError(
  error: unknown,
  context: Omit<EventMap['app_error'], 'message'> & { message?: string },
): void {
  if (!analyticsEnabled) return;

  const message =
    context.message ??
    (error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error');

  if (error instanceof Error) {
    const base = baseProperties();
    enqueue((instance) => instance.captureException(error, { ...base, ...context, message }));
  }
  track('app_error', { ...context, message });
}
