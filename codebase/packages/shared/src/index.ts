export * from './mqtt/index.ts';
export * from './db/index.ts';
export * from './positioning/index.ts';
export * from './rules/index.ts';

/**
 * Canonical timezone for the application.
 *
 * Australia/Sydney handles AEST (UTC+10:00) and AEDT (UTC+11:00) DST
 * transitions automatically — never hard-code an offset. All
 * user-facing wall-clock conversions (rule "only_between" windows,
 * date-range pickers, AEST-anchored history exports) run through
 * Intl.DateTimeFormat with this zone.
 *
 * Project owner directive (Phase B): AEST is the application's
 * canonical timezone; per-patient timezones are out of scope until
 * a future phase introduces interstate operations.
 */
export const APP_TIMEZONE = 'Australia/Sydney';
