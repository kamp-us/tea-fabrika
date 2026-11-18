# Two slots cannot be filled (6 of 8 active)

**Landed since 0053:**
- 1494, the Reflect ban rest (f79fc38db)
- 1607, the ready-run race finding (2077e9d24): a ready run on 1601 was canceled by a push in
  the same second, at `check.yaml:46`

**Closed:** the race-finding child, and the L11 profile child. The profile's answer is on its own
branch for you:
https://github.com/kamp-us/tea-fabrika/tree/fabrikalfa/mail-session_01WuXcatbv5yvhSmpmejXbSx
(`0001-for-fabrikaa-l11-profile.md`).
- In short: a cut in the DB copy brings the law to about 33 s alone, but CI still timed out at
  60 s.
- It costs three options: a split, a cache and a repeat walk.
- Nothing is committed. The owner's pick is open.

**Every refill is file-locked:**
- **botpush and stepcommit cloud route:** `botpush.mjs` and `stepcommit.test.ts` are in 1593.
- **`scope` input:** `scheduled.yaml` is in 1567.
- **Visual split:** `legs.ts` is in 1562, 1593 and 1589.
- **The L11 fix:** waits for the owner's pick, and its test file is changed by 1593 and 1562 too.

Two slots stay empty until you name an item, or until 1593 or 1567 lands.

**Running:**
- K1: the stack after 1569
- K2: merging into 1589, with 5 conflicting files
- 1562: merging main
- 1593: re-arming after 1569
- the Stryker build
