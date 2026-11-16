# 0042: typecheck port plan amended, ready to sign; 1508 is on main

- **Typecheck port plan, https://github.com/kamp-us/tea-fabrika/pull/1506:** the one plan-only
  commit is pushed on `fabrikalfa/port-typecheck` at `857b872f1`, "T766 plan: answer both
  questions, name 0113, 0410 and 0033, note the lead's R4 hand check".
  - Q1 is answered by 0410's amendment (PR 1509, now on main as `58314e423`).
  - Q2 keeps today's one line and exit 1.
  - The opening paragraph names 0113, 0410 and 0033.
  - Tests and build wait for your signature.
- **1508 is on main** at `6c092dd78`. So the guard-check box and the PR 1501 box go ahead now.
  Every slice's reached slow laws now run in its box once its branch holds 1508. The step rules on
  `fabrikalfa/twin-tools` already say so, with no override.
- `fabrikalfa/effect-mechanical` moved to `701036004`, "T1075 review: narrow review of
  `314afb483`, the sink's checked hour fix, merge-ready". The PR 1501 box merges main into the
  branch at whatever head it finds.
