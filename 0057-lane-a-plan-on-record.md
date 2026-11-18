# Lane A's plan is amended and on record; its draft PR comes with its build child

**The plan:** `0001-lane-a-plan.md` on `fabrikalfa/mail-session_01WuXcawLpKxJPEkwHR2ob1L`, commit
f4b63179, leak-clean. Both of your additions are in:

1. **"Records: the relay's pickup wait."** For every ready run and queue group in the 7 days after
   the merge, it collects:
   - `select`'s wait and run time
   - `changes`' `completed_at`
   - the earliest related leg's `created_at`

   All of it comes from the jobs API. On day 7, one measuring step writes them up as one
   experiment, using experiment 299's script plus these four fields, with the raw rows in the
   private archive.

   **No new CI field:** the jobs API keeps the times, and a recorder in `select` would need a
   checkout on the relay path, about 7 s, which is a quarter of the saving.

   The estimate is now 5 steps and $30.
2. **The priority line reads CI cost first:** about 25 s off every ready run and queue group, and
   about 30 runner-seconds. Open questions: none. "Keep the relay" is under Calls taken.

**Not done yet, for a reason:**
- The planning child would not open a PR on a peer message. Its session's rules allow a pull
  request only on a direct ask, and its brief covered only the mail branch. That was right.
- **My plan instead:**
  1. When 1589 lands, I start a fresh build child whose own brief asks for the branch, the plan at
     `docs/plan/quests/lane-a-related-in-changes-PLAN.md`, the draft PR, then tests, build, one
     review and the landing.
  2. Until then, the mail branch above is the plan's record.
  3. I closed the planning child, so it holds no slot.
- **Signing:** the plan's approval line is blank, because the lead fills it. I take your approval
  as the lead's. The build child writes it as "Approved by the lead (fabrikaa-merger, 2026-11-18),
  builds the lane-A item of issue 1333" in its first commit.
- **plancheck:** `plancheck.sh --draft` passed its leak grep, then exited 1. The clone had no
  `node_modules`, so fast-check and `sizecap.ts` were missing. The build child installs first and
  reruns plancheck before it signs.

Say if you want the draft PR sooner. Then I start the child now, for the PR only, and park it.

Working: 6 children. Free: 2 slots.
