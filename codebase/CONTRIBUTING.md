# Contributing

## Branch naming

`<workstream>/<task-id>-<short-description>` — workstream prefixes match the comprehensive task list (PM, BE, MQ, POS, UI, FW, HW, TST, EV, REG, DOC).

Examples:

- `ui/UI-09-live-sensor-cards`
- `be/BE-08-rules-engine-vitals`
- `pos/POS-03-trilateration-solver`

## Commit messages

Imperative subject prefixed by the task ID. Body explains the _why_, not the diff.

```
[BE-08] rules_engine: vitals out-of-range evaluator

Loads enabled rules per patient, applies a cooldown window keyed on
(patient_id, rule_id), and inserts alerts with severity from the rule
definition. Replaces the 501 stub.
```

## PR checklist

Before requesting review:

- [ ] Branch up to date with `main`
- [ ] `npm run lint` clean
- [ ] `npm run typecheck` clean
- [ ] `npm run test` clean (new behaviour has tests)
- [ ] `npm run build` clean
- [ ] No `console.log` in production paths
- [ ] No commented-out code (delete or convert to a `// TODO: F<n>`)
- [ ] Schema / wire-format changes reflected in `packages/shared`
- [ ] Migration changes include a rollback note in the PR description
- [ ] Linked to the task IDs being closed
- [ ] Screenshot or short clip for UI changes

## Adding dependencies

- Pin exact versions (no `^` / `~`).
- Workspace-internal packages: `"@alzcare/shared": "*"`.
- If a dep is needed but the install is being deferred, add it to `BACKLOG.md`.

## Touching the database

- One new migration file per change: `supabase/migrations/<timestamp>_<slug>.sql`.
- Run `npm run supabase:reset` locally to verify it applies on a fresh stack.
- Update `packages/shared` if the change affects wire shape or row interfaces.

## Touching MQTT contracts

- Schema changes live in `packages/shared/src/mqtt/`.
- Bump the message `v` field for breaking changes; the bridge keeps support for the previous version until firmware (FW-13) confirms cutover.
