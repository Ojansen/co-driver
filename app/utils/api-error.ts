/**
 * Pull a human-readable message out of an $fetch/ofetch error. Centralises the
 * `data.statusMessage ?? statusMessage ?? message ?? fallback` ladder that was
 * copy-pasted into every CRUD handler.
 */
export function apiErrorMessage(err: unknown, fallback = 'request failed'): string {
  const e = err as { data?: { statusMessage?: string }, statusMessage?: string, message?: string } | null
  return e?.data?.statusMessage ?? e?.statusMessage ?? e?.message ?? fallback
}
