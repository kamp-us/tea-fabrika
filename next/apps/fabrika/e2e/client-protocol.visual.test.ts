// P18 slice 1, next/ (ticket 290): law L9 of the approved plan, the P18 row's "browser client in CI".
// One suite, run twice on a real local instance of its own: once in a Chromium tab and once with the
// library's headless client, through the same public start. Each backend dials, waits, is granted,
// signs the hello, pings in text, opens the checklist, submits one `add` and reads its checked view
// and its ledger input. It needs Alchemy, workerd and Chromium, so it runs in CI's end-to-end job,
// never on a laptop step. Every resource is acquired in the scope of `p14.test-support.ts`'s `suite`.
import { ClientKeyError } from "@kampus/libfabrika/transport/ClientKey";
import { KeyLine } from "@kampus/libfabrika/transport/Sshsig";
import { Array as Arr, Effect, Option, Order, Schema } from "effect";
import type { BrowserContext } from "playwright";
import { describe, expect, it } from "vitest";
import {
  type Backend,
  followRestart,
  headlessBackend,
  NAME,
  roundTrip,
  served,
  SuiteError,
} from "./client-protocol.test-support.ts";
import { browser, type Dev, devServer, home, profile, suite, tab, tile, waiting } from "./p14.test-support.ts";

/** Each run's own limit in ms: a dev.ts start (up to 180 s), a grant, a 12 s ping wait and a round trip. */
const LIMIT = 300_000;

/** A Chromium tab of a fresh profile, open at the instance. */
const browserBackend = (context: BrowserContext, dev: Dev) =>
  Effect.gen(function* () {
    const { page, seen } = yield* tab(context, dev.url);
    const t = tile(page, NAME);
    const backend: Backend = {
      name: "browser",
      waiting: waiting(page),
      online: t.live,
      live: Effect.tryPromise({
        try: () => page.getByRole("status").innerText(),
        catch: () => new SuiteError({ waited: "browser: the status line" }),
      }).pipe(
        Effect.map((text) => text.startsWith("Online")),
        Effect.orDie,
      ),
      add: (name) =>
        Effect.tryPromise({
          try: () => t.field.fill(name).then(() => t.field.press("Enter")),
          catch: () => new SuiteError({ waited: "browser: the add field" }),
        }).pipe(Effect.orDie),
      shown: t.shown,
      dials: () => seen.sockets.length,
      state: t.state,
      body: t.body,
      // The tab's socket path is `/client/<fingerprint>/<tab>`: its last part is the tab id.
      tab: Effect.sync(() => new URL(seen.sockets[0] ?? "ws://x/").pathname.split("/").at(-1) ?? ""),
      pid: Effect.succeed(null),
      close: Effect.tryPromise({
        try: () => page.close(),
        catch: () => new SuiteError({ waited: "browser: the tab's close" }),
      }).pipe(Effect.orDie),
    };
    return backend;
  });

/** A key of the headless client's own, made in WebCrypto as a browser makes one. */
const headlessKey = Effect.gen(function* () {
  const failed = () => new ClientKeyError({ op: "make", error: "OperationError" });
  const pair = yield* Effect.tryPromise({
    try: () => crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]),
    catch: failed,
  });
  const raw = new Uint8Array(
    yield* Effect.tryPromise({ try: () => crypto.subtle.exportKey("raw", pair.publicKey), catch: failed }),
  );
  const field = (bytes: Uint8Array) => [...new Uint8Array(new Uint32Array([bytes.length]).buffer).reverse(), ...bytes];
  const blob = new Uint8Array([...field(new TextEncoder().encode("ssh-ed25519")), ...field(raw)]);
  // The door hashes the 32 raw key bytes, as the browser key and the P14 client do; the line keeps the blob.
  const digest = new Uint8Array(
    yield* Effect.tryPromise({ try: () => crypto.subtle.digest("SHA-256", raw), catch: failed }),
  );
  return {
    fingerprint: `SHA256:${btoa(String.fromCharCode(...digest)).replace(/=+$/, "")}`,
    raw: btoa(String.fromCharCode(...raw))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, ""),
    line: Schema.decodeUnknownSync(KeyLine)(`ssh-ed25519 ${btoa(String.fromCharCode(...blob))}`),
    found: "created" as const,
    sign: (bytes: Uint8Array) =>
      Effect.tryPromise({
        try: () => crypto.subtle.sign("Ed25519", pair.privateKey, new Uint8Array(bytes)),
        catch: () => new ClientKeyError({ op: "sign", error: "OperationError" }),
      }).pipe(Effect.map((b) => new Uint8Array(b))),
  };
});

const backends = {
  browser: (dev: Dev) =>
    Effect.gen(function* () {
      const b = yield* browser;
      return yield* browserBackend(yield* profile(b), dev);
    }),
  headless: (dev: Dev) => Effect.flatMap(headlessKey, (key) => headlessBackend(dev, key)),
} as const;

describe("P18 L9: one client, two backends, one real round trip", () => {
  for (const [name, make] of Object.entries(backends)) {
    it(
      `scenario: the ${name} client dials, waits, is granted, pings in text, opens the checklist, submits one add and reads it back, through the library's one start`,
      { timeout: LIMIT },
      (context) =>
        suite(
          Effect.gen(function* () {
            const h = yield* home;
            const dev = yield* devServer(h);
            const backend = yield* make(dev);
            const trip = yield* roundTrip(h, dev, backend);
            expect(trip.first, `${name} dials once before its grant`).toBe(1);
            expect(trip.kept, `${name} stays online on its one dial: its text pings are answered`).toBe(true);
            expect(trip.sent, `${name}'s add reached the ledger once`).toBe(1);
          }),
          context,
        ),
    );
  }
});

// P18 slice 2, next/ (ticket 979): law E1 of the approved plan. On a real local instance of its own,
// started in this process so the test holds its control endpoint, each backend opens the checklist,
// sees its process end as crashed, follows its successor and submits one `add` to it. The ledger
// then holds one watch per pid for the tab, and the close ends the last one. Like L9, it needs
// Alchemy, workerd and Chromium, so it runs in CI's end-to-end job, never on a laptop step.
// Plant: drop the window's DOWN handler; the tile stays `Online` on the dead pid and the wait for
// `Ended (crashed)` runs out.
describe("P18 E1: a tile monitors its process and follows the restart, on both backends", () => {
  for (const [name, make] of Object.entries(backends)) {
    it(
      `scenario: the ${name} client's tile says Ended (crashed), opens the successor, sends it one add, and its watch ends when the client closes`,
      { timeout: LIMIT },
      (context) =>
        suite(
          Effect.gen(function* () {
            const h = yield* home;
            const s = yield* served(h);
            const backend = yield* make(s.dev);
            const walk = yield* followRestart(h, s, backend);
            expect(walk.ended, `${name}'s tile says why its process ended`).toBe("Ended (crashed)");

            // The tile guideline's empty state, which a tile kept after a crash follows: one word where
            // the content will start, in `--tile-text`, and never the ended process's last view.
            if (walk.endedBody !== null) {
              expect(
                /^\S+$/.test(walk.endedBody.words),
                `${name}'s ended tile shows one word where its view was, not ${JSON.stringify(walk.endedBody.words)}`,
              ).toBe(true);
              expect(walk.endedBody.ink, `${name}'s ended tile's word is in the tile's text token`).toBe(true);
            }

            expect(walk.second, `${name}: the successor is a new pid`).not.toBe(walk.first);

            if (walk.shownPid !== null) {
              expect(walk.shownPid, `${name}'s tile shows the successor`).toBe(walk.second);
            }

            expect(walk.restartedAt, `${name}: the successor's restart is in the name's stream`).not.toBeNull();
            expect(walk.sent, `${name}'s add reached the ledger once`).toHaveLength(1);
            expect(walk.sent[0], `${name}'s add came after the successor started`).toBeGreaterThan(
              walk.restartedAt ?? Number.POSITIVE_INFINITY,
            );
            expect(
              Arr.sort(
                Arr.map(walk.watched, (w) => w.process),
                Order.String,
              ),
              `${name}: processes holds one watch per pid, each for the tab`,
            ).toEqual(Arr.sort([walk.first, walk.second], Order.String));
            const last = Option.getOrUndefined(Arr.findFirst(walk.watched, (w) => w.process === walk.second));
            expect(
              walk.unwatched,
              `${name}: the close ends the successor's watch, and only the client's leaving ends it`,
            ).toEqual([{ ref: last?.ref, reason: "watcher_exited" }]);
          }),
          context,
        ),
    );
  }
});
