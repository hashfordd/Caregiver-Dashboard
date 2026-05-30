// Split out from index.ts to break the rules→root-barrel circular import:
// evaluate.ts imports APP_TIMEZONE, but evaluate.ts is also re-exported via
// index.ts → rules/index.ts → evaluate.ts, creating a cycle. Placing the
// constant in its own leaf module eliminates the cycle without changing the
// public API (index.ts re-exports this via the line below).
export const APP_TIMEZONE = 'Australia/Sydney';
