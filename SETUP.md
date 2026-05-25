# AlzCare — Setup & Startup Guide

How to set up and run the full local stack: the MQTT broker, Supabase
(database + realtime), the bridge (which also computes positioning + alerts),
the protocol shim, and the caregiver dashboard — plus how to feed it sensor
data and pair real hardware.

Everything runs **locally**; no cloud account is needed for the demo.

```
sensors / sims ─▶ MQTT broker ─▶ protocol-shim ─▶ mqtt_bridge ─▶ Supabase (DB)
                                                       │              │
                                                       ▼              ▼
                                            position_estimator   realtime ─▶ dashboard
                                                       │
                                            rules_engine ─▶ alerts ─▶ dashboard
```

---

## 1. Prerequisites (one-time)

Install these once:

| Tool                | Why                          | Check                  |
| ------------------- | ---------------------------- | ---------------------- |
| **Docker Desktop**  | runs the broker + Supabase   | `docker --version`     |
| **Node.js ≥ 20**    | the app + tooling            | `node --version`       |
| **Supabase CLI**    | local database + edge runtime| `supabase --version`   |
| **Deno**            | the MQTT bridge runtime      | `deno --version`       |
| **Python 3**        | the sensor simulators        | `python3 --version`    |

Install the Python MQTT client the simulators use (the 1.x line — the scripts
use the v1 client API):

```bash
pip3 install "paho-mqtt<2"
```

The repo is at `…/ENG40011/Saas/`. The app lives in `codebase/`; **run all npm
commands from `codebase/`**.

---

## 2. Start everything — one command

```bash
cd codebase
npm run stack:up
```

…or **double-click `start-stack.command`** in Finder (at the `Saas/` root).

`stack:up` is idempotent (safe to re-run) and brings up, in order:

1. **Docker Desktop** (started if not running)
2. **MQTT broker** (Mosquitto)
3. **Supabase** (database + edge runtime)
4. **Seed** — the admin account + the fixed "Live Feed Test" patient (with its
   device, floor plan, four corner beacons, and alert rules)
5. **The live services** — bridge (ingest + positioning + alerts), shim, and
   dashboard — all in one terminal with prefixed, colour-coded output:

```
[bridge]    mqtt_bridge connected …
[shim]      4 placed beacons loaded … — the walk maps onto them
[web]       ➜  Local:  http://localhost:5173/
```

**Ctrl-C** in that terminal stops the live services. Leave it running while you
use the dashboard.

---

## 3. Open the dashboard

Go to **http://localhost:5173** and sign in:

- **Email:** `admin@bizzieapp.com`
- **Password:** `DemoPass123!`

Open the **Live Feed Test** patient. Tiles show "Awaiting first reading" until a
sensor feeds data (next step).

---

## 4. Feed sensor data (simulators)

In a **separate terminal** (`cd codebase`), run a simulator. Each one publishes
heart rate, SpO₂, temperature, IMU, and a walking position:

```bash
npm run sim                              # baseline: normal vitals + a room walk
python3 "../../MQTT Setup/D1-Fall.py"    # fall → critical alert, patient stays down
python3 "../../MQTT Setup/D1-HighHR.py"  # heart rate climbs past the threshold
python3 "../../MQTT Setup/D1-LowHR.py"   # bradycardia + patient slumps
python3 "../../MQTT Setup/D1-Stationary.py" # patient stops moving
```

Watch the **Live Feed Test** page: the heart-rate / SpO₂ / temperature tiles
update live, the dot walks the floor plan, and fall/vitals scenarios raise
alerts (the bell, top-right). Stop a simulator with **Ctrl-C**.

---

## 5. Pair real hardware (by MAC)

A real device only needs to know its own MAC address.

1. On the patient's **Live** tab, click **"Pair device"** and type the MAC
   (e.g. `aa:bb:cc:dd:ee:ff`). It pairs to the patient in view.
2. Have the device publish to **`device/{its-mac}/telemetry`** (and
   `…/signals`, `…/events`). The payload needs no UUIDs — the bridge resolves
   the MAC to its paired patient + device and fills them in.

An unpaired or unknown MAC is dropped until you pair it. The device row in the
panel shows the resolved `device_id` + topic if you need them for firmware that
uses the patient-keyed form instead.

---

## 6. Beacons (indoor positioning)

Positioning is driven by **where you place the beacons in the software**. The
seed sets four beacons at the room corners (NW/NE/SW/SE). To rearrange them,
use the patient's **Place → Beacons** tab, then **restart the shim** (it reads
beacon positions at startup) so the simulated walk maps onto the new layout.

Real hardware reports its own beacon RSSI, which flows through unchanged.

---

## 7. Stop everything

- **Ctrl-C** the `stack:up` terminal to stop the bridge / functions / shim / dashboard.
- Stop the containers (broker + Supabase):

```bash
npm run stack:down
```

---

## 8. Manual flow (advanced / per-service)

If you prefer one service per tab instead of `stack:up`, run these from
`codebase/` (Docker must be running first):

```bash
npm run broker:up                          # MQTT broker
npm run supabase:start                     # database + edge runtime
SB_SERVICE_KEY=$(supabase status -o env | awk -F= '/SERVICE_ROLE_KEY/{print $2}' | tr -d '"') npm run seed
SB_SERVICE_KEY=… npm run seed:live         # the Live Feed Test patient
npm run bridge:start                       # tab: ingest + positioning + alerts (computes in-process)
SB_SERVICE_KEY=… MQTT_BRIDGE_PASSWORD=bridgepass npm run shim:start   # tab: protocol shim
npm run dev                                # tab: dashboard
```

> The bridge computes positioning + alerts + inactivity in-process, so there's
> no separate `functions:serve` to run.

---

## 9. Troubleshooting

| Symptom                                        | Fix |
| ---------------------------------------------- | --- |
| `Cannot connect to the Docker daemon`          | Start Docker Desktop and re-run. |
| Broker won't start, "container name in use"    | `docker rm -f alzcare-mosquitto` then retry (stack:up does this automatically). |
| Login fails ("Invalid login credentials")      | The dashboard must point at local: `apps/web/.env.local` → `VITE_SUPABASE_URL=http://127.0.0.1:54321` and the **JWT** anon key (`eyJ…`, from `supabase status`), not a `sb_publishable_…` key. Restart `npm run dev` + hard-refresh. |
| Vitals/position tiles never update (data is in the DB) | Realtime not delivering — usually after a `supabase db reset`. Run `supabase stop && supabase start`. The web anon key must be the JWT form. |
| Alerts / live position never fire              | The bridge does this compute in-process — make sure `bridge:start` (or `stack:up`) is running and a sensor is publishing. |
| Generators error `No module named paho`        | `pip3 install "paho-mqtt<2"`. |
| Generators error about `CallbackAPIVersion`    | You have paho-mqtt 2.x — install the 1.x line: `pip3 install "paho-mqtt<2"`. |
| Map shows "No fix"                             | The patient needs ≥3 placed beacons; restart the shim after placing/moving them. |
| `npm error Missing script`                     | Run from `codebase/`, and it's `stack:up` (not `start:up`). |

> After a `supabase db reset`, re-run `npm run seed`, `npm run seed:live`, then
> `npm run stack:up`. If realtime stops delivering, `supabase stop && supabase start`.

---

## 10. Reference

**Commands** (from `codebase/`):

| Command                | What it does                                      |
| ---------------------- | ------------------------------------------------- |
| `npm run stack:up`     | start the whole stack (one command)               |
| `npm run stack:down`   | stop broker + Supabase                            |
| `npm run sim`          | run the baseline sensor simulator                 |
| `npm run dev`          | dashboard only                                    |
| `npm run broker:up` / `:down` | MQTT broker                                |
| `npm run supabase:start` / `:stop` / `:reset` | Supabase                   |
| `npm run bridge:start` | ingest bridge (also computes positioning + alerts) |
| `npm run shim:start`   | protocol shim (prototype topics → canonical)      |
| `npm run seed` / `seed:live` | seed demo data / the fixed test patient     |

**Local credentials & endpoints:**

- Dashboard: `http://localhost:5173` — `admin@bizzieapp.com` / `DemoPass123!`
- Supabase API: `http://127.0.0.1:54321`
- MQTT broker: `mqtt://127.0.0.1:1883` — user `backend-bridge`, password `bridgepass`
- Live Feed Test patient: `11110000-1111-4111-8111-000000000001`

**MQTT topics:**

- `device/{patient_uuid}/{telemetry|signals|events}` — patient-keyed (shim, sims)
- `device/{mac}/{telemetry|signals|events}` — device-keyed; the bridge resolves
  the MAC to its paired patient (real hardware)
