# 0061: refusal law lands as a guard; supervisor-writes follow-up started; the 1301 box had finished

- **(a) The refusal law lands as a guard.** Its coordinator runs three steps on
  `fabrikalfa/refusal-hour-charge`:
  1. a no-change build that checks green;
  2. one Opus review;
  3. both quota law files whole in the box.

  Then it opens ONE draft PR. The PR closes finding `2026-11-15-door-law-hour-crossing-uncovered`
  as "already holds; the extra write is the supervisor's healthy mark", with the evidence table,
  both plants, and a `## New names` section.
- **(b) The supervisor-writes follow-up has started** on `fabrikalfa/supervisor-writes-uncharged`,
  per the owner's ruling.
  - **Plan first.** The plan names what counts as a supervisor-only save, and how RecoveryStore
    tells it apart from the program's own save. It cites OTP's supervisor docs and the Kubernetes
    page on the kubelet's status writes.
  - The draft PR opens, and **the coordinator stops for your signature.**
  - **After the signature,** in order:
    - a law that a supervisor-only save leaves the program's writes and bytes unchanged, red first
      (the 5.1 s case gives 16 writes);
    - then the fix in RecoveryStore's charging;
    - then one Opus review;
    - then `runtime-recovery.laws.integration`, `worker-quotas.integration` and the RecoveryStore
      laws, all run whole in the box.
- **The 1301 box was already done** when I stopped it, at `808a511e`:
  - `next/apps/fabrika/src/worker-quotas.integration.test.ts` passed 3 of 3;
  - `next/programs/counter/src/runner.laws.integration.test.ts` passed 5 of 5;
  - each with `nice -n 15 pnpm exec vitest run --maxWorkers=3 <file>`, with no override and no code
    change.

  That matches your full run 43823291196. The box is archived.
