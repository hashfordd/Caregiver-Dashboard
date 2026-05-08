-- Item 131: adds 'device_silence' to alert_rule_type enum so caregivers
-- can configure a rule that fires when the patient's wearable has been
-- offline for X minutes. Distinct from 'inactivity', which detects "the
-- patient hasn't moved but the device is reporting" — different sensor
-- vs caregiver expectation. Chose the separate-enum route over
-- overloading inactivity with a no-signal flag so the rule taxonomy
-- stays clean and the evaluator dispatch is type-driven.
--
-- Rollback: enum values cannot be removed without a table rewrite. To
-- physically reverse, dump alert_rules + the enum, drop and re-create
-- the type, restore. In practice this addition is forward-compatible
-- and a rollback would only be necessary if a downstream serialiser
-- panics on the new value.

alter type public.alert_rule_type add value if not exists 'device_silence';
