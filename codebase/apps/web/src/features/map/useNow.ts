// Re-export from the canonical home in lib/ so existing
// `@/features/map/useNow` imports keep working. New call sites should
// pull from `@/lib/useNow` directly.
export { useNow } from '@/lib/useNow';
