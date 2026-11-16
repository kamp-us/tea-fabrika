// p26/p82. Hello echoes the issued nonce, bound by the existing signature with the URL and tab.
// checkHello takes trusted upgrade values and asks the `Admissions` service to admit the key and
// spend the nonce. It answers online {who,version,ping} or refused {reason}; capability claims
// grant no rank. Each law that reads which admission calls ran watches `Admissions` with a Recorder
// (0579); one that only reads the answer provides `Layer.mock(Admissions, ...)` (ticket 1067 slice 2).
// Plants: accept the first version; omit one signed binding; consume before checking; admit verify.
import { createHash } from "node:crypto";
import { assert, describe, expect, it } from "@effect/vitest";
import { Recorder } from "@kampus/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as fc from "fast-check";
import { AdmissionError, Admissions } from "./Admissions.ts";
import { checkHello, sameOrigin, selectVersion } from "./Hello.ts";
import { Admission, type Who } from "./Wire.ts";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const SENT = "2026-11-08T04:00:00.000Z";
const SPACE = "fabrika-client";

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

const field = (value: string | Uint8Array) => {
  const b = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  return Buffer.concat([u32(b.length), b]);
};

const armor = (bytes: Uint8Array) =>
  `-----BEGIN SSH SIGNATURE-----\n${Buffer.from(bytes)
    .toString("base64")
    .match(/.{1,70}/g)
    ?.join("\n")}\n-----END SSH SIGNATURE-----\n`;

const fingerprint = (bytes: Uint8Array) =>
  `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`;

const signedBytes = (text: string, space: string = SPACE) =>
  Buffer.concat([
    Buffer.from("SSHSIG"),
    field(space),
    field(""),
    field("sha512"),
    field(createHash("sha512").update(text).digest()),
  ]);

const pack = (blob: Uint8Array, signature: Uint8Array, space: string = SPACE) =>
  armor(
    Buffer.concat([
      Buffer.from("SSHSIG"),
      u32(1),
      field(blob),
      field(space),
      field(""),
      field("sha512"),
      field(signature),
    ]),
  );

const web = <A>(call: () => Promise<A>): Effect.Effect<A, Error> =>
  Effect.tryPromise({ try: call, catch: () => new Error("test WebCrypto failed") });

const key = Effect.fn("test.key")(function* () {
  const pair = yield* web(() => crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]));
  const bytes = new Uint8Array(yield* web(() => crypto.subtle.exportKey("raw", pair.publicKey)));
  const blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
  return {
    raw: Buffer.from(bytes).toString("base64url"),
    line: `ssh-ed25519 ${blob.toString("base64")}`,
    fingerprint: fingerprint(bytes),
    sshFingerprint: fingerprint(blob),
    sign: (text: string, space: string = SPACE) =>
      web(() => crypto.subtle.sign("Ed25519", pair.privateKey, signedBytes(text, space))).pipe(
        Effect.map((raw) => pack(blob, Buffer.concat([field("ssh-ed25519"), field(new Uint8Array(raw))]), space)),
      ),
  };
});

const url = "https://fabrika.test/project-a",
  tab = "tab-a",
  nonce = "nonce-a";

/**
 * `Admissions` that answers every admit with `answer` and spends its nonce once, watched by a
 * Recorder. `consume` answers true the first time and false after, as the door's nonce does.
 */
const admissions = (answer: typeof Admission.Type) => {
  let used = false;
  return Recorder.layer(Admissions, {
    admit: () => Effect.succeed(answer),
    consume: Effect.sync(() => {
      if (used) {
        return false;
      }

      used = true;
      return true;
    }),
  });
};

/** The record of one admit call with this key fingerprint, and of one nonce spend. */
const admit = (key: string) => ({ method: "admit", args: [key] });
const consume = { method: "consume", args: [] };

const setup = Effect.fnUntraced(function* () {
  const k = yield* key();
  const signed = yield* k.sign(`fabrika-hello\n${url}\n${tab}\n${nonce}`);
  const hello = {
    versions: [1, 2],
    has: ["verify", "seal"],
    ping: "30s",
    key: k.raw,
    tab,
    nonce,
    platform: "browser",
    os: "ios",
    sentAt: SENT,
    signed,
  };
  const identity = {
    key: k.fingerprint,
    person: PERSON,
    as: "window",
  } satisfies typeof Who.Type;
  const trusted = {
    url,
    tab,
    nonce,
    name: k.fingerprint,
    versions: [2, 1],
    ping: { min: 10_000, max: 60_000 },
  };
  return {
    hello,
    trusted,
    identity,
    fingerprint: k.fingerprint,
    admissions: admissions(Admission.cases.admitted.make({ identity })),
  };
});

describe("P10 hello", () => {
  // H1 (d2): for any signed hello (a fresh key, any url, tab and nonce) that admission refuses
  // (not_granted, its one refusal), the refusal carries that caller's own checked fingerprint, and
  // the record is exactly one admit with that fingerprint: no nonce is spent.
  // Plants: return the refusal without the fingerprint; consume before admitting.
  it("d2: any refused signed hello names its own checked fingerprint", async () => {
    await fc.assert(
      fc.asyncProperty(fc.webUrl(), fc.string(), fc.string(), (url, tab, nonce) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const k = yield* key();
            const hello = {
              versions: [1, 2],
              has: [],
              ping: "30s",
              key: k.raw,
              tab,
              nonce,
              platform: "browser",
              os: "ios",
              sentAt: SENT,
              signed: yield* k.sign(`fabrika-hello\n${url}\n${tab}\n${nonce}`),
            };
            yield* Effect.gen(function* () {
              const result = yield* checkHello({
                hello,
                url,
                tab,
                nonce,
                name: k.fingerprint,
                versions: [2, 1],
                ping: { min: 10_000, max: 60_000 },
              });
              expect(result).toEqual({
                _tag: "refused",
                reason: "not_granted",
                fingerprint: k.fingerprint,
              });
              expect(yield* Recorder.calls(Admissions)).toEqual([admit(k.fingerprint)]);
            }).pipe(Effect.provide(admissions(Admission.cases.refused.make({ reason: "not_granted" }))));
          }),
        ),
      ),
      { seed: 119120, endOnFailure: true, numRuns: 40 },
    );
  });

  // H2: a hello whose unsigned tab or nonce differs from what the proof bound records no admission
  // call. Plant: admit before the signature check.
  for (const binding of ["tab", "nonce"] as const) {
    it.effect.prop(
      `p26: an unsigned ${binding} claim cannot differ from the ${binding} bound by the proof`,
      { generated: Schema.String },
      ({ generated }) =>
        Effect.forEach(
          [`another-${binding}`, generated],
          (value) =>
            Effect.gen(function* () {
              const x = yield* setup();
              yield* Effect.gen(function* () {
                expect(
                  yield* checkHello({
                    hello: {
                      ...x.hello,
                      [binding]: value === x.hello[binding] ? `another-${value}` : value,
                    },
                    ...x.trusted,
                  }),
                ).toMatchObject({ _tag: "refused", reason: "bad_signature" });
                expect(yield* Recorder.calls(Admissions)).toEqual([]);
              }).pipe(Effect.provide(x.admissions));
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.effect("p82: a client with an unknown OS can still initialize", () =>
    Effect.gen(function* () {
      const x = yield* setup();
      expect(
        yield* checkHello({ hello: { ...x.hello, os: "unknown" }, ...x.trusted }).pipe(Effect.provide(x.admissions)),
      ).toMatchObject({
        _tag: "online",
        hello: { os: "unknown" },
      });
    }),
  );
  // H3, scenario: the `setup` hello, checked, goes online, and the record is admit with its
  // fingerprint, then consume, in that order. Plant: consume before admitting.
  it.effect("p26: a checked window goes online with the fold's identity and chosen version", () =>
    Effect.gen(function* () {
      const x = yield* setup();
      yield* Effect.gen(function* () {
        const result = yield* checkHello({ hello: x.hello, ...x.trusted });
        expect(result).toMatchObject({
          _tag: "online",
          identity: x.identity,
          version: 2,
          ping: 30_000,
          hello: { nonce },
        });
        expect(yield* Recorder.calls(Admissions)).toEqual([admit(x.fingerprint), consume]);
      }).pipe(Effect.provide(x.admissions));
    }),
  );
  // H4: an admission that fails fails `checkHello` with that very `AdmissionError`, after one admit
  // with the hello's fingerprint, and consume is never run. Plant: catch the admission error and
  // answer `refused`.
  it.effect.prop(
    "H4: a failing admission fails checkHello with that very AdmissionError, and consume is never run",
    { cause: Schema.String },
    ({ cause }) =>
      Effect.gen(function* () {
        const x = yield* setup();
        const failure = AdmissionError.make({ cause });
        const failing = Recorder.layer(
          Admissions,
          {
            admit: () => Effect.succeed(Admission.cases.admitted.make({ identity: x.identity })),
            consume: Effect.succeed(true),
          },
          { fails: { admit: failure } },
        );
        yield* Effect.gen(function* () {
          const error = yield* Effect.flip(checkHello({ hello: x.hello, ...x.trusted }));
          expect(error).toBe(failure);
          expect(yield* Recorder.calls(Admissions)).toEqual([admit(x.fingerprint)]);
        }).pipe(Effect.provide(failing));
      }),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
  it("p82: agreement is the maximum intersection, independent of order and duplicates", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 9 })),
        fc.array(fc.integer({ min: 1, max: 9 })),
        (client, server) => {
          const common = [...new Set(client)].filter((v) => server.includes(v));
          expect(selectVersion(client, server)).toEqual(common.length ? Math.max(...common) : null);
        },
      ),
      { seed: 119120, numRuns: 100 },
    );
  });

  // H2: a changed trusted value refuses with no admission call recorded. Plant: admit before the
  // signature check.
  for (const binding of ["nonce", "url", "tab", "name"] as const) {
    it.effect(`p26: changed trusted ${binding} refuses before admission`, () =>
      Effect.gen(function* () {
        const x = yield* setup();
        yield* Effect.gen(function* () {
          const result = yield* checkHello({
            hello: x.hello,
            ...x.trusted,
            [binding]: "changed",
          });
          expect(result._tag).toBe("refused");
          expect(yield* Recorder.calls(Admissions)).toEqual([]);
        }).pipe(Effect.provide(x.admissions));
      }),
    );
  }

  it.effect("p26: a consumed nonce cannot initialize again", () =>
    Effect.gen(function* () {
      const x = yield* setup();
      yield* Effect.gen(function* () {
        expect((yield* checkHello({ hello: x.hello, ...x.trusted }))._tag).toBe("online");
        expect((yield* checkHello({ hello: x.hello, ...x.trusted }))._tag).toBe("refused");
      }).pipe(Effect.provide(x.admissions));
    }),
  );

  // H2: a bad signature, key or version records no admission call; an admission's own refusal
  // records exactly one admit with the fingerprint, and never consume. Plant: admit before the
  // signature check.
  for (const kind of ["signature", "key", "version", "unknown"] as const) {
    it.effect.prop(
      `p26/p82: ${kind} refusal has no nonce write or successful admission`,
      { generated: Admission.cases.refused },
      ({ generated }) =>
        Effect.forEach(
          [Admission.cases.refused.make({ reason: "not_granted" }), generated],
          (value) =>
            Effect.gen(function* () {
              const x = yield* setup();
              const hello = {
                ...x.hello,
                ...(kind === "signature"
                  ? { signed: "broken" }
                  : kind === "key"
                    ? { key: `${x.hello.key}=` }
                    : kind === "version"
                      ? { versions: [8] }
                      : {}),
              };
              yield* Effect.gen(function* () {
                const result = yield* checkHello({ hello, ...x.trusted });
                expect(result).toMatchObject({
                  _tag: "refused",
                  ...(kind === "version"
                    ? { reason: "no_version" }
                    : kind === "unknown"
                      ? { reason: value.reason }
                      : {}),
                });
                expect(yield* Recorder.calls(Admissions)).toEqual(kind === "unknown" ? [admit(x.fingerprint)] : []);
              }).pipe(Effect.provide(kind === "unknown" ? admissions(value) : x.admissions));
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.effect("p82/p66: additive hello fields are ignored, has/os preserved, ping clamped", () =>
    Effect.gen(function* () {
      const x = yield* setup();
      const result = yield* checkHello({
        ...x.trusted,
        hello: { ...x.hello, future: { rank: "person" }, ping: "1ms" },
      }).pipe(Effect.provide(x.admissions));
      expect(result).toMatchObject({ _tag: "online", identity: x.identity, version: 2, ping: 10_000 });
      assert(result._tag === "online");
      expect(result.hello).toMatchObject({ os: "ios", has: ["verify", "seal"] });
    }),
  );

  for (const [origin, host, accepted] of [
    ["https://fabrika.test", "127.0.0.1:8123", true],
    [null, "127.0.0.1:8123", true],
    ["null", "127.0.0.1:8123", false],
    ["https://fabrika.test.evil.test", "127.0.0.1:8123", false],
    ["https://fabrika.test@evil.test", "127.0.0.1:8123", false],
    ["not a URL", "127.0.0.1:8123", false],
    ["https://fabrika.test", "evil.test:8123", false],
  ] as const) {
    it(`p26 origin: ${origin} / ${host}`, () => {
      expect(
        sameOrigin({
          origin,
          host,
          origins: ["https://fabrika.test"],
          localHost: "127.0.0.1:8123",
          forwardedHost: "127.0.0.1:8123",
        }),
      ).toBe(accepted);
    });
  }
});

// T737 D1, next/. The origin check decodes its URL with Effect Schema now. An independent copy of the
// check before that change is the oracle: the same answer for every generated origin, allowlist and
// host relation, in the same order of checks (host first, then null, then the URL).
const oldSameOrigin = (a: Parameters<typeof sameOrigin>[0]): boolean => {
  if (a.localHost !== undefined && a.host !== a.localHost) {
    return false;
  }

  if (a.origin === null) {
    return true;
  }

  if (!URL.canParse(a.origin)) {
    return false;
  }

  const url = new URL(a.origin);
  return (
    (url.protocol === "https:" || url.protocol === "http:") && url.origin === a.origin && a.origins.includes(url.origin)
  );
};

/** What the URL parser makes of a text, or the text itself when it does not parse. */
const normalized = (text: string) => (URL.canParse(text) ? new URL(text).origin : text);

const Canonical = fc
  .record({
    protocol: fc.constantFrom("https", "http", "ftp", "ws", "file", "javascript", "blob"),
    host: fc.oneof(fc.domain(), fc.constantFrom("127.0.0.1", "[::1]", "localhost", "fabrika.test")),
    port: fc.option(fc.integer({ min: 0, max: 65_535 }), { nil: undefined }),
  })
  .map(({ protocol, host, port }) => `${protocol}://${host}${port === undefined ? "" : `:${port}`}`);

/** Mutations around the boundaries the old check drew: empty, relative, port, path, case, credentials, protocol. */
const Origin = fc.oneof(
  Canonical,
  fc.webUrl(),
  fc
    .tuple(Canonical, fc.constantFrom("/", "/path", "?q", "#h", ":80", ":443", ":", " ", "\n", "%2e"))
    .map(([origin, tail]) => `${origin}${tail}`),
  Canonical.map((origin) => origin.toUpperCase()),
  Canonical.map((origin) => origin.replace("://", "://user:pass@")),
  Canonical.map((origin) => origin.replace("://", ":")),
  Canonical.map((origin) => ` ${origin}`),
  fc.constantFrom("", "null", "/", "/relative", "//fabrika.test", "fabrika.test", "https:", "https://", "not a URL"),
  fc.string(),
);

const Origins = fc.record({
  origin: fc.option(Origin, { nil: null }),
  others: fc.array(Origin, { maxLength: 3 }),
  // Whether the allowlist holds the text as given, its normalized origin, both or neither.
  allow: fc.constantFrom("given", "normalized", "both", "neither"),
  host: fc.constantFrom("127.0.0.1:8123", "evil.test:8123", ""),
  localHost: fc.option(fc.constantFrom("127.0.0.1:8123", "evil.test:8123", ""), { nil: undefined }),
  forwardedHost: fc.option(fc.constantFrom("127.0.0.1:8123", "evil.test:8123"), { nil: undefined }),
});

describe("T737 D1 origin acceptance equals the old check, next/", () => {
  it("sameOrigin answers as the old URL check did for generated origins, allowlists and hosts", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(Origins, ({ origin, others, allow, host, localHost, forwardedHost }) => {
        const given = origin === null ? [] : [origin];
        const norm = origin === null ? [] : [normalized(origin)];
        const origins = [
          ...others,
          ...(allow === "given" || allow === "both" ? given : []),
          ...(allow === "normalized" || allow === "both" ? norm : []),
        ];
        const a = {
          origin,
          host,
          origins,
          ...(localHost === undefined ? {} : { localHost }),
          ...(forwardedHost === undefined ? {} : { forwardedHost }),
        };
        const expected = oldSameOrigin(a);
        expect(sameOrigin(a)).toBe(expected);
        seen.add(
          `${expected}:${origin === null ? "null" : origin === normalized(origin) ? "canonical" : "other"}:${allow}`,
        );
      }),
      { seed: 119120, numRuns: 2_000 },
    );

    // The boundaries the plants need: a canonical allowed origin, a refused non-canonical one whose
    // normalized form is allowed, a null origin, and a host mismatch that refuses first.
    for (const side of [
      "true:canonical:given",
      "false:other:normalized",
      "true:null:neither",
      "false:canonical:both",
    ]) {
      expect(seen, side).toContain(side);
    }
  });
});

it.effect.prop(
  "A3: checked hands hello keeps its own build and capabilities; an old window may omit build",
  { build: Schema.NonEmptyString, has: Schema.Array(Schema.NonEmptyString) },
  ({ build, has }) =>
    Effect.gen(function* () {
      const x = yield* setup();
      const identity = { ...x.identity, as: "hands" as const };
      const result = yield* checkHello({
        ...x.trusted,
        hello: { ...x.hello, has, build },
      }).pipe(
        Effect.provide(
          Layer.mock(Admissions, {
            admit: () => Effect.succeed(Admission.cases.admitted.make({ identity })),
            consume: Effect.succeed(true),
          }),
        ),
      );
      expect(result).toMatchObject({ _tag: "online", identity, hello: { has, build } });
      const old = yield* setup();
      expect(
        yield* checkHello({ ...old.trusted, hello: old.hello }).pipe(Effect.provide(old.admissions)),
      ).toMatchObject({ _tag: "online" });
      const bad = yield* setup();
      expect(
        yield* checkHello({ ...bad.trusted, hello: { ...bad.hello, build: 42 } }).pipe(Effect.provide(bad.admissions)),
      ).toMatchObject({
        _tag: "refused",
      });
    }),
  { arbitrary: { seed: 119120, runs: 100 } },
);
