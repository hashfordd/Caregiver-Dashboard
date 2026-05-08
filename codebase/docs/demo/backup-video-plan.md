# DOC-12 — Backup video plan

A screen-recorded backup video must exist before the live demo. It plays if the live
demo suffers an unrecoverable failure (auth down, Supabase project unreachable, or
two consecutive fallback beats failing).

---

## Tooling

- **macOS QuickTime** (File → New Screen Recording) is preferred: zero install cost,
  exports `.mov` which can be converted to `.mp4` via File → Export → 1080p in
  QuickTime, or via `ffmpeg -i recording.mov -c:v libx264 -crf 18 output.mp4`.
- **OBS Studio** is the alternative if system audio capture is needed alongside
  screen capture (QuickTime requires Soundflower or BlackHole for simultaneous
  system audio + mic; OBS handles both natively).
- Record at **1080p, 30 fps**. Do not record at 60 fps — the file size is
  disproportionate and the demo is not motion-sensitive.

---

## Length and content

**Target length**: ≤ 3 minutes.

Only the three most load-bearing beats are included. These are the beats that are
hardest to describe verbally and most compelling visually:

1. **Replay** — scrubber running at 10× with the patient marker animating across
   the floor plan (≈ 45 s of recording, covering ≈ 7.5 minutes of playback).
2. **Vitals chart** — switching through the 1 h / 6 h / 24 h presets, showing the
   chart re-render (≈ 30 s).
3. **CSV export** — clicking "Download — Last 24 h vitals", the file appearing in
   Finder/Downloads, and the first few rows visible in a spreadsheet (≈ 45 s).

Total narrated content: roughly 2 minutes. Add a 30-second title card at the start
("alzcare — V1 demo — History tab") and a 10-second end card ("End of backup
recording"). That keeps the file under 3 minutes.

---

## Voice-over approach

**Decision: live-narrated at playback time.**

The presenter narrates over the video as it plays, rather than dubbing a recorded
voice track. Rationale: the presenter knows the audience context and can adjust
emphasis in real time; re-recording a dubbed track after any UI change is extra work
for a prototype demo.

If the presenter is unavailable on the day and a substitute is presenting: record a
separate voice-over track using QuickTime Audio Recording or OBS, then combine with
the video in iMovie or via:

```
ffmpeg -i screen.mp4 -i narration.m4a -c:v copy -c:a aac -shortest dubbed.mp4
```

Document the chosen approach in the dry-run notes rather than in this file — the
approach may differ between dry runs and the live demo.

---

## File location

The final file lives at:

```
docs/demo/assets/v1-demo-backup.mp4
```

The `assets/` directory is created when the recording is exported; it is not committed
to git (add `docs/demo/assets/` to `.gitignore` to avoid committing a large binary).
Share the file via the project file share or a shared drive link noted in the
dry-run checklist.

---

## Re-record cadence

Re-record the backup video whenever any of the following occur before the live demo:

- The History tab sub-tab structure changes (tabs renamed, added, or removed).
- The replay canvas or scrubber UI changes in a way that would confuse a viewer.
- The CSV column order changes (see [F13.md — Contracts](../features/F13.md#contracts-in-packagesshared)).
- The export sub-tab copy or button labels change.

Minor visual-only changes (colour tokens, spacing) do not require a re-record.

After each re-record, update the dry-run checklist to confirm the new file path is
reachable and playable.

See also: [demo script](./script.md), [dry-run checklist](./dry-run-checklist.md).
