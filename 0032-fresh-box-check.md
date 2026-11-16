# 0032: fresh-box check of the setup script; the visual law hit the 0178 guard

A fresh box built with the new setup script (session started 06:03 UTC) shows:

- **ssh-keygen works.** `/usr/bin/ssh-keygen`, `OpenSSH_9.6p1 Ubuntu-3ubuntu13.20, OpenSSL 3.0.13 30 Jan 2024`;
  an ed25519 keygen printed `keygen-ok`.
- **Build 1248 is in place, with no links.** `chromium-1248`, `chromium_headless_shell-1248` and
  `ffmpeg-1013` are real folders in `/opt/pw-browsers`. The 1243 builds are still there too. The only
  link is the image's own `/opt/pw-browsers/chromium`, which points at `chromium-1243`.
- **Node and Playwright:** `node` is v26.13.0, `node_modules` is installed, and `next/packages/tuval`
  is on Playwright 1.64.1.
- **`key.laws.visual.test.ts` did not run.** The repo's own guard on main refused it at startup,
  before any browser launched:

  ```
  Error: Local host-only test run refused (decision 0178). This run reaches 1 real-resource file(s):
    next/packages/tuval/src/browser/key.laws.visual.test.ts
  Prove the law with a full run on its branch instead: gh workflow run scheduled.yaml --ref <branch>.
  Only after the lead's read and the owner's yes (0178), run it with FABRIKA_HOST_RUN_OWNER_APPROVED=1.
  ```

  The box did not set the override, since 0178 keeps it for the lead's read and the owner's yes. So
  the launch on 1248 is still unproven. An earlier box, built only with the openssh change, gave the
  same refusal and had no 1248 build.

**Two asks:**

1. **This check.** Does the owner say yes to one run of `key.laws.visual.test.ts` with
   `FABRIKA_HOST_RUN_OWNER_APPROVED=1` in a fresh box, just to prove the launch on 1248? Otherwise
   the proof waits for the next `scheduled.yaml` run.
2. **Box runs from now on.** That guard now stops every box run of a `.integration.` or `.visual.`
   law on a branch that has it, unless the override is set. That covers every slice's "laws your
   files reach" and runs like the PR 1462 one. The PR 1462 box at `262c210b4` is still running and
   has not reported. Its commit may be older than the guard. What is the standing rule for twin
   boxes: does a box run you or the owner asks for count as the owner's yes, so it sets the
   override, or does every such run go through `scheduled.yaml`?
