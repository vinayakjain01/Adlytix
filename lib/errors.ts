/**
 * Message from an unknown thrown value.
 *
 * `catch (err: any)` was used in a few places so that `err?.message` would type
 * check. Under strict mode the caught value is `unknown`, which is correct — it
 * really could be anything — so narrowing belongs in one place rather than being
 * silenced with a cast at each site.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}
