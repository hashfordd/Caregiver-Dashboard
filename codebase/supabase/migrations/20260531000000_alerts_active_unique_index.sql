-- 1) de-dupe existing active alerts so the unique index can build: keep the most
--    recent unacked alert per (patient_id, rule_id) where rule_id is not null,
--    acknowledge the rest.
with ranked as (
  select id, row_number() over (partition by patient_id, rule_id order by fired_at desc, id desc) as rn
  from public.alerts
  where acknowledged_at is null and rule_id is not null
)
update public.alerts a set acknowledged_at = now()
from ranked r where a.id = r.id and r.rn > 1;

-- 2) at most one active (unacked) alert per (patient, rule)
create unique index if not exists alerts_active_uidx
  on public.alerts (patient_id, rule_id)
  where acknowledged_at is null and rule_id is not null;
