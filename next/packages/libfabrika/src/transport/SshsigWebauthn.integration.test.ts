// p27, question 19's independent control, split from SshsigWebauthn.test.ts: OpenSSH's own
// `ssh-keygen -Y verify` passes the same recorded assertion the shared verifier passes. It runs a
// process and writes a temp folder, so it runs on the schedule (0536).
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { line, realArmor, SPACE, text } from "./SshsigWebauthn.test-support.ts";

describe("P10 WebAuthn SSHSIG", () => {
  it.effect("vector: independent control: OpenSSH verifies the same recorded assertion", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      // The test's scope removes the folder (0061).
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "p10-vector-" });
      const signers = path.join(dir, "allowed_signers");
      const signature = path.join(dir, "assertion.sig");
      yield* fs.writeFileString(signers, `spike ${line}\n`);
      yield* fs.writeFileString(signature, realArmor);
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      // A missing `ssh-keygen` fails the spawn, and so the law.
      const handle = yield* spawner.spawn(
        ChildProcess.make("ssh-keygen", ["-Y", "verify", "-n", SPACE, "-I", "spike", "-f", signers, "-s", signature], {
          stdin: Stream.make(new TextEncoder().encode(text)),
        }),
      );
      const [stderr, , code] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(handle.stderr)), Stream.runDrain(handle.stdout), handle.exitCode],
        { concurrency: "unbounded" },
      );
      expect(Number(code), stderr).toBe(0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
