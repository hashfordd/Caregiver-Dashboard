# TST-10 — 60-minute continuous run

**Purpose**: verify that a single browser tab running the Patient Detail → Live tab
does not accumulate memory, lose its realtime subscription, or drop alerts over one
hour of sustained 1 Hz telemetry.

This test is the Phase 5 entry condition (see
[PHASES.md — Phase 5](../PHASES.md#phase-5--polish)). Run it before any demo
dry run. A failure here must be resolved — and the root cause triaged using the
[failure-mode guide](#failure-mode-triage) below — before the demo prep checklist
is started.

---

## Setup

### Generator configuration

Run the mock telemetry generator at the following rates simultaneously:

| Stream                   | Rate | Topic pattern                           |
| ------------------------ | ---- | --------------------------------------- |
| BLE signals              | 1 Hz | `device/<patient_id>/signals`           |
| Wi-Fi signals            | 1 Hz | `device/<patient_id>/signals`           |
| Sensor readings (vitals) | 1 /s | `device/<patient_id>/telemetry`         |
| Position estimator       | 1 /s | (invoked by bridge per signals payload) |

Over 60 minutes this produces approximately:

- 3,600 BLE + 3,600 Wi-Fi signals payloads = 7,200 `position_estimates` rows
- 3,600 vitals payloads = 3,600 `sensor_readings` rows
- Total: roughly 10,800 DB rows written during the run

Start the generator with a patient that already has a saved floor plan and ≥ 4
placed beacons so the position estimator resolves valid `(x_canvas, y_canvas)` values
and the Live tab renders the marker.

### Browser configuration

- Chrome (latest stable), **one tab only** on the patient detail page, Live tab
  active throughout.
- DevTools open to the **Memory** panel before the run starts (not closed during
  the run — the panel adds minimal overhead and is needed for heap snapshots).
- Console cleared immediately before starting (right-click → Clear console).
- No other application in the foreground — screen saver disabled, display sleep
  disabled for the duration of the run.

### Pre-run captures

1. In DevTools → Memory → Heap snapshot: take an initial snapshot and label it
   `heap-t0`.
2. Note the initial `jsHeapSizeLimit` and `usedJSHeapSize` from the
   `performance.memory` API (accessible in the DevTools console):
   ```js
   performance.memory;
   ```
3. Record the initial alert count visible in the patient's alert feed (may be zero).

---

## During the run — check schedule

Every 5 minutes, record the following in the observation table below. The check takes
< 30 seconds; do not navigate away from the tab.

**Checks**:

a. **Subscription alive**: the Live tab sparklines are updating (HR / SpO2 / temp
values changed since the last check). If they have not changed in the last 30 s
and the generator is still running, the realtime channel has disconnected.

b. **Sparkline rendering**: no frozen sparkline (a single value repeated for > 60 s
indicates a stale subscription or a UI rendering halt).

c. **Heap delta**: in the DevTools console, run `performance.memory.usedJSHeapSize`
and subtract the `t0` baseline. Record in MB (divide bytes by 1,048,576).

### Observation table

Copy this table into your run log and fill it in during the run.

| Time (min) | Subscribed?                           | Sparklines live? | Heap used (MB) | Heap delta vs t0 (MB) | Notes |
| ---------- | ------------------------------------- | ---------------- | -------------- | --------------------- | ----- |
| 5          |                                       |                  |                |                       |       |
| 10         |                                       |                  |                |                       |       |
| 15         |                                       |                  |                |                       |       |
| 20         |                                       |                  |                |                       |       |
| 25         |                                       |                  |                |                       |       |
| 30         | Reconnect event scheduled — see below |                  |                |                       |       |
| 35         |                                       |                  |                |                       |       |
| 40         |                                       |                  |                |                       |       |
| 45         |                                       |                  |                |                       |       |
| 50         |                                       |                  |                |                       |       |
| 55         |                                       |                  |                |                       |       |
| 60         |                                       |                  |                |                       |       |

---

## 30-minute Wi-Fi disconnect event

At the 30-minute mark, introduce a deliberate network disconnect to test automatic
reconnection:

1. Note the current time.
2. Disconnect the laptop from Wi-Fi (or use macOS → Network → Turn Wi-Fi Off).
3. Wait **5 seconds**.
4. Reconnect Wi-Fi.
5. Start a stopwatch. Record the time until:
   - The Live tab sparklines resume updating (realtime channel reconnected).
   - Any alert that would have fired during the disconnect window appears in the
     feed (no dropped alerts).

**Acceptance**: reconnect within 30 s; no alerts dropped in the 5-second window.

Record the reconnect event in the observation table Notes column at t = 30 min.

---

## End-of-run captures

1. In DevTools → Memory → Heap snapshot: take a final snapshot and label it
   `heap-t60`.
2. Record `usedJSHeapSize` from `performance.memory`.
3. Compare `heap-t0` and `heap-t60` in the Memory panel's snapshot diff view
   (select `heap-t60`, choose "Comparison" from the dropdown, compare to `heap-t0`).
   Note the top three object types by retained size delta.
4. Count the total alerts that fired during the run from the alert feed (or via a
   Supabase query):
   ```sql
   select count(*)
   from alerts
   where patient_id = '<demo-patient-uuid>'
     and fired_at > now() - interval '65 minutes';
   ```
5. Check the DevTools Console for any errors or warnings logged during the run.
   Record them verbatim in the notes.

---

## Acceptance criteria

| Metric                                   | Acceptance threshold                        |
| ---------------------------------------- | ------------------------------------------- |
| Heap growth (t60 − t0)                   | < 50 MB                                     |
| Realtime reconnect time after Wi-Fi drop | < 30 s                                      |
| Alerts dropped during 5-s disconnect     | 0                                           |
| Console errors during run                | 0 unhandled errors                          |
| Sparkline staleness at any check         | 0 occurrences (all checks show live values) |

A run fails if any acceptance threshold is exceeded. Do not proceed to demo prep
until the failure is resolved.

---

## Failure-mode triage

If the run fails, use the following guide to identify the most likely root cause
before investing in a broad debugging session.

### Suspect 1 — Fabric.js object array growth

**Symptom**: heap delta > 50 MB; `heap-t0` vs `heap-t60` diff shows `fabric.Object`
(or `FabricObject`, depending on the Fabric version) as the top retained-size
contributor.

**Diagnostic step**: open the `ReplayScrubber.tsx` render loop. Confirm that dots
whose `recorded_at` precedes the trail window are removed via `canvas.remove(dot)`.
If `canvas.remove` is called but the object array still grows, check whether the dot
is also being added to a separate React ref array that is never pruned. The unit
test in `ReplayScrubber.test.tsx` assertion 3 (canvas object count after scrubber
advance) should catch this — re-run the test first.

### Suspect 2 — Recharts series object accumulation

**Symptom**: heap delta > 50 MB; diff shows `Array` or anonymous objects as the top
retained-size contributor; the vitals sparkline or the History Vitals chart is open
or has been opened during the run.

**Diagnostic step**: Recharts stores series data in component state. If the `data`
prop passed to `<LineChart>` is a growing array rather than a bounded sliding window,
every new data point is retained. In `VitalsChart.tsx`, confirm the data array passed
to Recharts is sliced to a fixed max length (e.g., the query range) and not appended
to indefinitely. For the Live-tab sparkline (hand-rolled SVG from F4), confirm the
Zustand store slice caps its buffer at the documented 5-minute / 300-sample ceiling.

### Suspect 3 — Listener leak in PatientStreamProvider

**Symptom**: realtime channel reconnects visible in the console (`CHANNEL_ERROR`,
`SUBSCRIBED` cycling); heap delta attributable to multiple `RealtimeChannel` objects
retained after navigation or tab switches.

**Diagnostic step**: in the DevTools heap snapshot diff, search for `RealtimeChannel`
objects. There should be exactly one live channel per active patient stream. If more
than one exists, the cleanup function returned by `useEffect` in
`PatientStreamProvider` is not being called, or `supabase.channel()` is being called
more than once without a matching `supabase.removeChannel()` call. Check that the
provider's `useEffect` dependency array is not causing the channel to be recreated
on every render (a common cause is passing an object literal as a dependency).

---

## Related documents

- [PHASES.md — Phase 5 entry criteria](../PHASES.md#phase-5--polish)
- [F13.md — Risks (memory leaks during long replay)](../features/F13.md#risks)
- [CROSS_CUTTING.md §7 — Realtime patterns](../CROSS_CUTTING.md#7-realtime-patterns)
- [CROSS_CUTTING.md §8 — Telemetry retention](../CROSS_CUTTING.md#8-telemetry-retention)
- [Demo dry-run checklist](../demo/dry-run-checklist.md)
