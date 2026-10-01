# Core Ledger — what changed in this version

Existing data carries over automatically (same storage key; old backups still restore). An EZ bar you set up as a
range keeps working as before until you count your plates.

## Training science
- **Weekly volume is a real weekly budget.** Abs and obliques each get their own weekly hard-set target, split into
  ~3-set exposures at least twice a week. 3-day and 6-day plans now get the same weekly work (6 days used to mean up to
  34 ab sets). Obliques were chronically under-trained (5–12 sets/week) and now sit in the 10–20 zone with abs.
  Planks and back extensions have their own budget too, and exercises that train abs *and* obliques count for both.
- **Exercise order like a coach writes it:** big compound lifts first, accessories, then the most demanding core work
  (hanging, loaded), easier core, and static holds last. Exercises that tax the same weak link (grip, lower back) are
  never back to back (a chin-up used to be followed by hanging knee raises).
- **Isolation moves** (lateral raise, rear-delt fly) are no longer picked as the only press or pull of a session.
- **Ramp-up sets** are suggested before the first heavy compound lift.

## Learning from you
- **First-time calibration:** the first session on any exercise sets its target from what you actually did.
- **In-session autoregulation:** a set that was far easier or harder than intended re-targets the remaining sets.
- **Faster progression** when sets are clearly too easy; failures ease the target to what you can really do.
- **Per-muscle volume** adapts: progressing and recovering → a little more work; very sore or missing targets → less.
- **Learned rest** matches the rest you actually take (never below 90 s on big lifts or 45 s on core).
- **Plateau breaker:** three stalled sessions rotate to a fresh variation or add a slow lowering.
- The Progress tab shows **what the plan has learned**, plus a weekly **muscle map**.

## Fixing mistakes
- **Back arrow** in the workout: steps back to the previous exercise (including one you skipped) or opens the last
  set to fix it. Afterwards you return to where you were; a running rest resumes where it was.
- **Fix or delete any set**, from the menu's exercise list or the end-of-session **receipt**.
- **Reopen a saved session** (the most recent one) to correct it; the plan's changes are undone and redone.
- Unfinished sessions from an earlier day can be saved instead of silently lost.
- A session logged against the wrong day can be counted for the missed day before it.

## Equipment and weights
- **Plate counter** for the EZ bar and spinlock dumbbells: every prescribed weight is one you can actually load.
- **Type any weight** in the set logger or on an exercise's page; it's remembered as one of your weights.
- Weights print exactly (1.25 kg, not 1.3).

## Fixes
- Holds (planks, side planks) no longer ask how many reps were left: they ask why you stopped, and the time you held
  sets the next target. Going to form failure used to count as "too hard" and stall the target; so did all-out timed sets.
- The training day now runs 04:00–04:00, so a session started after midnight counts for the evening before.
- Double taps and taps that land as a timer moves on can no longer log twice or crash the session.
- Sheets (the "too hard" check-in, swap, exercise page) update in place instead of flickering on every tap.

## Design
Black and safety yellow, with photography printed as a black/yellow duotone (Unsplash licence, credited in Profile),
exercise demos on yellow cards, a rubber-stamp moment when a session is entered, and hazard stripes for "in progress".

## Tests
`node tests/run.mjs` runs ~16,500 checks with no dependencies: plan invariants for every profile × equipment × day,
simulated users training two full blocks through the real UI, scenario tests for each feature, and a random-tap
"chaos monkey". `node tests/audit.mjs` prints weekly volume per profile.
