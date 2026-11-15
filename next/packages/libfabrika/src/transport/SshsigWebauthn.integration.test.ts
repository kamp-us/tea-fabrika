// p27, question 19's independent control, split from SshsigWebauthn.test.ts: OpenSSH's own
// `ssh-keygen -Y verify` passes the same recorded assertion the shared verifier passes. It runs a
// process and writes a temp folder, so it runs on the schedule (0536).
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { line, realArmor, SPACE, text } from "./SshsigWebauthn.test-support.ts";

describe("P10 WebAuthn SSHSIG", () => {
  it("vector: independent control: OpenSSH verifies the same recorded assertion", () => {
    const dir = mkdtempSync(join(tmpdir(), "p10-vector-"));

    try {
      writeFileSync(join(dir, "allowed_signers"), `spike ${line}\n`);
      writeFileSync(join(dir, "assertion.sig"), realArmor);
      const result = spawnSync(
        "ssh-keygen",
        [
          "-Y",
          "verify",
          "-n",
          SPACE,
          "-I",
          "spike",
          "-f",
          join(dir, "allowed_signers"),
          "-s",
          join(dir, "assertion.sig"),
        ],
        { input: text, encoding: "utf8" },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
