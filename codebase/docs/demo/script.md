# DOC-10 — Demo script

**Target runtime**: 6–8 minutes. Presenter reads the speaker lines aloud; click-paths
describe exact UI actions; expected results describe what must be on screen; fallbacks
describe the recovery path if the step fails.

All beats assume the presenter is signed in as `admin@bizzieapp.com` and the demo
patient has been verified against the [dry-run checklist](./dry-run-checklist.md)
before the session begins.

---

## Beat 1 — Sign in (0:00 – 0:30)

**Speaker line**: "This is the alzcare caregiver dashboard. Let me sign in."

**Click-path**: Navigate to the prod URL → enter `admin@bizzieapp.com` + password →
press Sign in.

**Expected result**: Redirects to the Patient Roster (`/`). The target demo patient
("Demo Patient") is visible in the table.

**Fallback**: If the page is blank or shows an auth error, open the pre-loaded backup
tab (see [dry-run checklist](./dry-run-checklist.md#backup-tab)) and continue from
there. If the backup tab is also broken, switch to the [backup video](./backup-video-plan.md).

---

## Beat 2 — Roster → patient detail (0:30 – 1:00)

**Speaker line**: "Each row in the roster is a patient the caregiver is allocated to.
I'll click through to the one with live data."

**Click-path**: Click the demo patient's row in the roster table.

**Expected result**: Patient detail page loads. The tab strip shows Live / Place /
History / Alerts / … / Settings. (Beacons and calibration live _inside_ the Place
tab now, not as top-level tabs.) The Live tab is active by default. Connection status
indicator shows green (device online).

**Fallback**: If the tab strip does not render, hard-refresh. If the connection status
is red, confirm the mock generator is running (or that seeded data is fresh within the
last 30 s) — the stale-data indicator turns red after 30 s without a new reading.
Mention this to the audience as designed behaviour.

---

## Beat 3 — Live tab: vitals + position + hysteresis (1:00 – 2:30)

**Speaker line**: "The Live tab shows the real-time heart rate arriving from the
wearable roughly once per second, with a sparkline of the last five minutes. This
wearable senses heart rate only — SpO₂ and temperature aren't on the device, so we
don't show empty cards for them."

**Click-path**: Point to the heart-rate card. Let it update once on screen so the
audience sees the number change.

**Speaker line**: "Below the vitals, the patient's current position is marked on the
floor plan in real time. Indoor confidence drives which view is shown."

**Click-path**: Point to the floor-plan panel and the patient marker. If the mode
indicator reads 'Indoor', note it aloud.

**Speaker line**: "To avoid flicker at the doorway, the system requires five
consecutive ticks of conflicting confidence before switching modes. Walk the patient
marker to the edge of the floor plan and back — no mode flip unless you cross the
threshold for five ticks in a row."

**Click-path**: No interaction needed; point at the mode indicator text (Indoor /
Outdoor). If a mode flip is in progress, let it complete and narrate it.

**Expected result**: The heart-rate value increments without blank frames. The patient
marker moves on the floor plan. The mode indicator reads 'Indoor' and does not flip
unless the patient genuinely exits the calibrated space.

**Fallback**: If the marker is frozen, the bridge or mock generator has stalled.
Acknowledge the issue briefly ("the live feed is paused — let me show you the recorded
history"), skip to Beat 8 (History tab), and return here at the end if time permits.

---

## Beat 4 — Place tab: one workspace (floor plan + rooms) (2:30 – 3:00)

**Speaker line**: "The Place tab is a single workspace for the whole space. The
top switch has two bundles — 'Floor plan & rooms' and 'Beacons & calibration' — over
one canvas, so you never lose your zoom or position switching context."

**Click-path**: Click the Place tab. The 'Floor plan & rooms' bundle is active; the
floor plan canvas renders. In view mode you can drag to pan and scroll to zoom; nothing
on the plan is grabbable until you click Edit.

**Speaker line**: "In edit mode caregivers draw walls, outline rooms, and click-to-place
doors and windows directly on the plan. Each wall shows its length — type a real
length right on the wall to scale the whole room."

**Click-path**: Click Edit. Point to the Door/Window tools and the editable length
labels on the walls. Point to Reset and Undo in the toolbar (don't click Reset). Click
Discard or Save to leave edit mode cleanly.

**Expected result**: The canvas shows the saved layout with at least four rooms, doors
and windows. The toolbar exposes Wall/Room/Polygon/Door/Window tools plus Reset/Undo.

**Fallback**: If the canvas is blank, the `floor_plans` row is missing. Navigate to
the [dry-run checklist](./dry-run-checklist.md#data) and note the prerequisite aloud.
Skip this beat and continue.

---

## Beat 5 — Place tab: beacons + calibration bundle (3:00 – 3:45)

**Speaker line**: "The same Place tab holds the devices. The 'Beacons & calibration'
bundle lists the BLE beacons paired and placed on the plan, and the calibration
fingerprints captured during the site walk."

**Click-path**: In the Place tab, click the 'Beacons & calibration' bundle. The sub-
toggle defaults to 'Place beacons' — confirm at least four beacons are listed with
their positions. Click 'Calibrate' to show the captured fingerprint points.

**Expected result**: Beacons view: ≥ 4 beacon rows with positions + status, all
rendered on the shared canvas. Calibrate view: the captured points list (each showing
its `ble_signature` sample count) and the capture coverage notice.

**Fallback**: If the lists are empty, the seed data is missing. State the expected
state aloud ("in a live deployment, beacons would appear here") and continue.

---

## Beat 6 — Alerts tab: fired alert + acknowledge (3:45 – 4:30)

**Speaker line**: "The Alerts tab shows the alert feed for this patient. Alerts are
fired by the rules engine when a threshold is crossed — vitals, zone breach, fall
event, or inactivity."

**Click-path**: Click the Alerts tab. Scroll to the most recent critical alert.

**Speaker line**: "Critical alerts also trigger an audible cue and a browser
notification. Let me acknowledge this one."

**Click-path**: Click the Acknowledge button on the critical alert. The row moves
to the acknowledged state (button disappears, row dims or moves to the bottom of
the list).

**Expected result**: At least one critical-severity alert is visible (red chip).
After acknowledgement, the row reflects the acked state within 2 s. The global
alert bell badge count decrements.

**Fallback**: If no alerts are present, the seed data is missing or the rules engine
did not fire. Explain the expected behaviour verbally and point to the Settings tab
(next beat) to show how rules are configured.

---

## Beat 7 — Settings tab: rule types + threshold tweak (4:30 – 5:15)

**Speaker line**: "The Settings tab exposes the alert rules for this patient. V1
ships four rule types: vitals thresholds, zone breach, fall detection, and
inactivity."

**Click-path**: Click the Settings tab. Point to the four rule-type cards (Vitals,
Zone, Fall, Inactivity).

**Speaker line**: "Each rule shows a 'would have alerted in the last 24 hours'
preview so caregivers can tune thresholds before saving."

**Click-path**: Expand the Vitals rule card. Adjust the HR high threshold by a few
BPM (e.g., move it from 100 to 95). Point to the preview count updating.

**Expected result**: Four rule-type cards are visible. The preview counter updates
to reflect the adjusted threshold. A Save button becomes active.

**Fallback**: If the preview counter does not update, the evaluator may be running
against empty history. Note that the preview requires at least 24 h of sensor data
and continue without saving the threshold change.

---

## Beat 8 — History tab: F13 walkthrough (5:15 – 6:45)

This beat is the longest and most load-bearing. Do not abbreviate it.

### 8a — Replay

**Speaker line**: "The History tab is new in V1. It lets caregivers replay movement
and review vitals over any time window."

**Click-path**: Click the History tab → the Replay sub-tab is active by default.
The date-range picker defaults to the last 1 hour.

**Speaker line**: "I'll set speed to 10× and press Play. At 10× a one-hour window
completes in six minutes — we'll just let it run for a few seconds."

**Click-path**: Confirm the speed selector is set to 10×. Press Play. Watch the
patient marker animate across the floor plan. After 5–10 seconds, press Pause.

**Expected result**: The scrubber advances. Position dots appear on the floor plan
in time order. The trail is trimmed to the last 60 seconds of playback (older dots
disappear). The scrubber position reflects the current playback time.

**Fallback**: If the canvas is blank, the patient has no `position_estimates` rows
in the chosen window. Widen the window or switch to the Vitals sub-tab.

### 8b — Vitals chart

**Speaker line**: "The Vitals sub-tab charts heart rate over a selectable range.
SpO₂ and temperature series exist in the chart for future sensors, but this wearable
reports heart rate only, so those lines stay empty."

**Click-path**: Click the Vitals sub-tab. The chart renders with the default 1-hour
window. Click the 6 h preset, then 24 h, then back to 1 h.

**Expected result**: The HR line series renders with data; SpO₂/temperature series are
empty (no sensor). Switching presets re-fetches and re-renders within 2 s. Null
readings appear as gaps in the line, not as zero values.

**Fallback**: If the chart is blank, the patient has no `sensor_readings` in the
window. Switch to a wider range.

### 8c — Alerts filter

**Speaker line**: "The Alerts sub-tab lets caregivers filter history by severity
and rule type — useful for handover notes."

**Click-path**: Click the Alerts sub-tab. Click the 'Critical' severity chip. Point
to the filtered list.

**Expected result**: Only critical-severity alert rows are shown after the chip is
toggled.

### 8d — CSV export

**Speaker line**: "The Export sub-tab allows downloading vitals or position history
for handover or clinical review. The file format is stable — the same column order
will be used for V2 ML training data."

**Click-path**: Click the Export sub-tab. Click "Download — Last 24 h vitals".

**Expected result**: A CSV file downloads. Open it in a spreadsheet (pre-open the
file manager or Finder for speed). Confirm the header reads
`recorded_at,hr_bpm,spo2_pct,temp_c` and that numeric cells are unquoted. (The
`spo2_pct` / `temp_c` columns are present for format stability but empty — this
wearable senses heart rate only.)

**Fallback**: If the download does not trigger, the fetch may have failed. Open
DevTools Network briefly to show the request, then note the expected behaviour.

---

## Beat 9 — Outdoor tab (optional, if time < 7:00) (6:45 – 7:15)

**Speaker line**: "If the patient walks beyond the calibrated indoor space, the
view switches to an outdoor map automatically. The geofence drawn here fires a
zone-rule alert if the patient leaves the defined boundary."

**Click-path**: Click the patient's avatar or the Outdoor tab (if separately exposed).
The Mapbox tile map renders with the patient's last GPS fix and the geofence polygon
overlaid.

**Expected result**: The map loads with the geofence polygon visible. The patient's
outdoor trail (last 30 minutes) appears as a breadcrumb line.

**Fallback**: Skip if time is short or if the Mapbox token is unavailable.

---

## Beat 10 — Closing (7:15 – 7:45)

**Speaker line**: "That covers the V1 feature surface — F1 through F13. Signup,
roster, patient detail, live vitals, indoor positioning, outdoor map, beacon
management, calibration, alert rules, the alert feed, and now history with replay
and CSV export."

**Speaker line**: "Production hardening items — bridge containerisation, audit
log triggers, realtime channel auth, and the retention compactor — are tracked
in `BACKLOG.md` and are out of scope for V1."

**Click-path**: None. Hold on the History tab export view as the closing image.

---

## Timing summary

| Beat | Topic                        | Target end |
| ---- | ---------------------------- | ---------- |
| 1    | Sign in                      | 0:30       |
| 2    | Roster → patient             | 1:00       |
| 3    | Live tab                     | 2:30       |
| 4    | Place: floor plan & rooms    | 3:00       |
| 5    | Place: beacons & calibration | 3:45       |
| 6    | Alerts                       | 4:30       |
| 7    | Settings                     | 5:15       |
| 8    | History (F13)                | 6:45       |
| 9    | Outdoor (optional)           | 7:15       |
| 10   | Closing                      | 7:45       |

If the session is running long after Beat 7, skip Beat 9 entirely. Beat 8 is
not skippable — it is the primary Phase 5 deliverable.

See also: [dry-run checklist](./dry-run-checklist.md), [backup video plan](./backup-video-plan.md).
