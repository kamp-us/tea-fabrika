// p44's writer half (docs/plan/tier-1-detail.md, "Properties"), for `transport/sshsig.ts`: what
// writeSshsig makes, checked against the real `ssh-keygen`. Split from Sshsig.test.ts, which keeps
// p27's vectors and the properties: this file drives a process and a temp folder, so it runs on
// the schedule (0536).
//
// p44 runs the real `ssh-keygen`. With no `ssh-keygen` on the machine it fails loudly, never
// skips: a skipped law is a hole. Its keys are made in a fresh temp folder, removed after.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Str from "effect/String";
import {
  SPACE,
  refused,
  text,
  other,
  check,
  utf8,
  join8,
  u32,
  str,
  base64,
  rows,
  keyBlob,
  type Key,
  freshKey,
  write,
} from "./Sshsig.test-support.ts";

// p44: one signature shape, against the real `ssh-keygen`.
// Each scenario makes its keys in its own temp folder, and the test's scope removes it (0061).
const folder = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "p44-"))),
  (home) => Effect.sync(() => rmSync(home, { recursive: true, force: true })),
);

const keygen = (args: ReadonlyArray<string>, input?: string) =>
  Effect.sync(() => {
    const run = spawnSync("ssh-keygen", args, { input, encoding: "utf8" });

    if (run.error !== undefined) {
      throw new Error(`p44 needs ssh-keygen and it did not run: ${run.error.message}`);
    }

    return run;
  });

const file = (home: string, name: string, body: string, mode = 0o644): string => {
  const path = join(home, name);
  writeFileSync(path, body, { mode });

  return path;
};

/** An unencrypted `openssh-key-v1` private key file, so `ssh-keygen` can sign with a WebCrypto key. */
const opensshPrivate = (key: Key): string => {
  const checkWord = u32(0x5a5a5a5a);

  const inner = join8(
    checkWord,
    checkWord,
    str("ssh-ed25519"),
    str(key.publicKey),
    str(join8(key.seed, key.publicKey)),
    str("same@fabrika.test"),
  );

  const pad = Uint8Array.from({ length: (8 - (inner.length % 8)) % 8 }, (_, i) => i + 1);

  const blob = join8(
    utf8("openssh-key-v1\0"),
    str("none"),
    str("none"),
    str(""),
    u32(1),
    str(keyBlob(key.publicKey)),
    str(join8(inner, pad)),
  );

  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${rows(base64(blob))}\n-----END OPENSSH PRIVATE KEY-----\n`;
};

describe("p44, one signature shape, with real ssh-keygen", () => {
  it.effect("scenario: what writeSshsig makes passes ssh-keygen -Y verify and checkSshsig", () =>
    Effect.gen(function* () {
      const home = yield* folder;
      const key = yield* freshKey("ours@fabrika.test");
      const body = "grant: a window key\nfor: a person\n";
      const armored = yield* write(key, body);
      const allowed = file(home, "ours.allowed", `ours@fabrika.test ${key.line}\n`);
      const sig = file(home, "ours.sig", armored);

      const run = yield* keygen(
        ["-Y", "verify", "-f", allowed, "-I", "ours@fabrika.test", "-n", SPACE, "-s", sig],
        body,
      );

      expect(run.status, run.stderr).toBe(0);
      expect(yield* check(armored, [key.line], body)).toStrictEqual({ signer: key.line });

      const elsewhere = yield* keygen(
        ["-Y", "verify", "-f", allowed, "-I", "ours@fabrika.test", "-n", "fabrika-other", "-s", sig],
        body,
      );

      expect(elsewhere.status).not.toBe(0);
    }),
  );

  it.effect("scenario: what ssh-keygen -Y sign makes passes checkSshsig, sha512 and sha256", () =>
    Effect.gen(function* () {
      const home = yield* folder;
      const made = join(home, "made");
      const keys = yield* keygen(["-q", "-t", "ed25519", "-N", "", "-C", "made@fabrika.test", "-f", made]);
      expect(keys.status, keys.stderr).toBe(0);
      const line = Str.trim(readFileSync(`${made}.pub`, "utf8"));
      const body = "made by ssh-keygen\nä ü ş\n";

      for (const options of [[], ["-O", "hashalg=sha256"]]) {
        const msg = file(home, "made.msg", body);
        const run = yield* keygen(["-Y", "sign", "-f", made, "-n", SPACE, ...options, msg]);
        expect(run.status, run.stderr).toBe(0);
        const armored = readFileSync(`${msg}.sig`, "utf8");
        rmSync(`${msg}.sig`);
        expect(yield* check(armored, [other, line], body)).toStrictEqual({ signer: line });
        expect(yield* check(armored, [other], body)).toStrictEqual(refused);
      }
    }),
  );

  it.effect("scenario: writeSshsig and ssh-keygen -Y sign give the same file, byte for byte", () =>
    Effect.gen(function* () {
      // Ed25519 is deterministic: one key and one text give one signature, so one file.
      const home = yield* folder;
      const key = yield* freshKey();
      const body = text;
      const ours = yield* write(key, body);
      const keyFile = file(home, "same", opensshPrivate(key), 0o600);
      const msg = file(home, "same.msg", body);
      const run = yield* keygen(["-Y", "sign", "-f", keyFile, "-n", SPACE, msg]);
      expect(run.status, run.stderr).toBe(0);
      expect(ours).toBe(readFileSync(`${msg}.sig`, "utf8"));
    }),
  );
});
