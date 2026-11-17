import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
// P16, next/. The tables one built brain file carries: each program's compiled source with its
// hash, each window file with its route. Outside values decode through Effect with typed failures,
// malformed JSON included. Builder contract: `app/built.ts` exports `Built`, `BuiltProgram`,
// `Asset` and `decodeBuilt(raw)`, and a bad value fails as `BuildError`. P40: a program's key is
// its qualified identity, `pack/program`, and a table with any other key fails whole: no entry is
// dropped to make it pass.

import * as Arr from "effect/Array";
import * as Digest from "effect/crypto/Digest";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

type Program = { readonly hash: string; readonly source: string };

type Asset = { readonly hash: string; readonly type: string; readonly body: string };

type Built = {
  readonly programs: Readonly<Record<string, Program>>;
  readonly assets: Readonly<Record<string, Asset>>;
};

type Api = {
  readonly Built: Schema.Codec<Built>;
  readonly Asset: Schema.Codec<Asset>;
  readonly BuiltProgram: Schema.Codec<Program>;
  readonly decodeBuilt: (raw: unknown) => Effect.Effect<Built, { _tag: string; reason: string }>;
};

const load = async () => {
  vi.resetModules();

  return vi.importActual<Api>(new URL("./Built.ts", import.meta.url).href);
};

/** A text's SHA-256 in hex, through Effect's Digest on the platform's WebCrypto. */
const sha = (s: string) =>
  Effect.runPromise(
    Digest.Digest.use((digest) => digest.digestHex(Digest.sha256, new TextEncoder().encode(s))).pipe(
      Effect.provide(Digest.layerWebCrypto),
    ),
  );

/** Each program row as the table holds it, keyed by its name, with its source's hash. */
const programTable = async (rows: ReadonlyArray<{ readonly name: string; readonly source: string }>) =>
  Rec.fromEntries(
    await Promise.all(Arr.map(rows, async ({ name, source }) => [name, { hash: await sha(source), source }] as const)),
  );

// P14 slice 1: a tab's page is one more checked asset type, generated beside scripts and stylesheets.
// The refusals below keep a bare `text/html` and every other type out.
const types = ["text/javascript; charset=utf-8", "text/css; charset=utf-8", "text/html; charset=utf-8"] as const;

const rows = fc.uniqueArray(
  fc.record({
    name: fc
      .tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 100 }))
      .map(([pack, n]) => `pack${pack}/program${n}`),
    source: fc.string({ minLength: 1, maxLength: 40, unit: "grapheme" }),
  }),
  { minLength: 2, maxLength: 4, selector: (r) => r.name },
);

const routes = fc.uniqueArray(
  fc.record({
    route: fc
      .array(fc.stringMatching(/^[\w-][\w.-]{0,8}$/), { minLength: 1, maxLength: 3 })
      .filter((parts) => Arr.every(parts, (p) => p !== "." && p !== ".."))
      .map((parts) => `/${Arr.join(parts, "/")}`),
    type: fc.constantFrom(...types),
    body: fc.string({ maxLength: 40, unit: "grapheme" }),
  }),
  { minLength: 1, maxLength: 4, selector: (a) => a.route },
);

const runs = { seed: 119120, numRuns: 100 };

const failed = async (api: Api, raw: unknown) => {
  // A throwing decode rejects here instead of returning a typed Failure.
  const result = await Effect.runPromise(Effect.result(api.decodeBuilt(raw)));
  expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "BuildError" } });
};

describe("P16 checked built tables", () => {
  it("table: generated programs and assets round-trip with checked hashes and schemas", async () => {
    const api = await load();
    await fc.assert(
      fc.asyncProperty(rows, routes, async (rows, assets) => {
        const raw: Built = {
          programs: await programTable(rows),
          assets: Rec.fromEntries(
            await Promise.all(
              Arr.map(assets, async ({ route, type, body }) => [route, { hash: await sha(body), type, body }] as const),
            ),
          ),
        };

        expect(await Effect.runPromise(api.decodeBuilt(raw))).toEqual(raw);
        expect(await Effect.runPromise(Schema.decodeUnknownEffect(api.Built)(raw))).toEqual(raw);

        for (const program of Rec.values(raw.programs)) {
          expect(await Effect.runPromise(Schema.decodeUnknownEffect(api.BuiltProgram)(program))).toEqual(program);
        }

        for (const asset of Rec.values(raw.assets)) {
          expect(await Effect.runPromise(Schema.decodeUnknownEffect(api.Asset)(asset))).toEqual(asset);
        }
      }),
      runs,
    );
  });
  it("table plants: one program's hash on another's source, bad routes, MIME types and malformed metadata are typed failures", async () => {
    const api = await load();
    await fc.assert(
      fc.asyncProperty(
        rows,
        routes,
        fc.jsonValue(),
        fc.constantFrom("../escape", "/./x.js", "/a/../b.js", "no-slash.js", "", "/a//b.js"),
        fc.constantFrom("text/html", "application/json", "text/javascript"),
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)),
        async (rows, assets, junk, route, type, other) => {
          const [a, b] = rows as [(typeof rows)[0], (typeof rows)[0]];
          const asset = assets[0]!;

          const good = {
            programs: { [a.name]: { hash: await sha(a.source), source: a.source } },
            assets: { [asset.route]: { hash: await sha(asset.body), type: asset.type, body: asset.body } },
          };

          await expect(Effect.runPromise(api.decodeBuilt(good))).resolves.toEqual(good);

          for (const raw of [
            null,
            junk,
            "{malformed JSON",
            { programs: junk, assets: null },
            { ...good, programs: { [a.name]: { hash: await sha(b.source), source: a.source } } },
            { ...good, programs: { "": { hash: await sha(a.source), source: a.source } } },
            {
              ...good,
              assets: {
                [asset.route]: { hash: await sha(asset.body), type: asset.type, body: `${asset.body}x` },
              },
            },
            {
              ...good,
              assets: { [route]: { hash: await sha(asset.body), type: asset.type, body: asset.body } },
            },
            { ...good, assets: { [asset.route]: { hash: await sha(asset.body), type, body: asset.body } } },
            // A missing or non-text source or body fails even when the hash is its text's.
            { ...good, programs: { [a.name]: { hash: await sha("") } } },
            { ...good, programs: { [a.name]: { hash: await sha(String(other)), source: other } } },
            { ...good, assets: { [asset.route]: { hash: await sha(""), type: asset.type } } },
            {
              ...good,
              assets: { [asset.route]: { hash: await sha(String(other)), type: asset.type, body: other } },
            },
          ]) {
            if (raw === junk && typeof junk === "object" && junk !== null) {
              continue;
            }

            await failed(api, raw);
          }
        },
      ),
      runs,
    );
  });
  it("L2: a table with one key that is not a qualified name fails whole, and a good table keeps every key", async () => {
    const api = await load();

    // Each break keeps the current key inside it, so a check on one end or one segment passes it.
    const breaks: ReadonlyArray<(key: string) => string> = [
      (key) => Str.split(key, "/")[1]!,
      (key) => Str.split(key, "/")[0]!,
      (key) => `/${key}`,
      (key) => `${key}/`,
      (key) => Str.replace("/", "//")(key),
      (key) => `${key}/extra`,
      (key) => `../${key}`,
      (key) => Str.replace("/", "/./")(key),
      (key) => Str.replace("/", ".")(key),
      (key) => Str.replace("/", ":")(key),
      (key) => `${key} `,
      (key) => `${key}${Str.repeat(257 - key.length)("x")}`,
    ];

    // The walk: start from a completed table, then each step either adds a program under a fresh
    // qualified key, which must decode with every key kept, or mutates one current key, which must
    // fail. A mutation never enters the state, so every later step starts from a good table.
    const tape = fc.array(fc.nat(), { minLength: 2, maxLength: 12 });
    await fc.assert(
      fc.asyncProperty(rows, tape, async (rows, tape) => {
        const programs: Record<string, Program> = await programTable(rows);

        let added = 0,
          refused = 0;

        for (const [i, n] of tape.entries()) {
          const keys = Rec.keys(programs);

          if (i % 2 === 0) {
            const key = `pack${n % 5}/added${i}`;
            programs[key] = { hash: await sha(key), source: key };
            const decoded = await Effect.runPromise(api.decodeBuilt({ programs, assets: {} }));
            expect(Rec.keys(decoded.programs).sort()).toEqual(Rec.keys(programs).sort());
            expect(decoded.programs).toEqual(programs);
            added++;
          } else {
            const key = keys[n % keys.length]!;
            const bad = breaks[Math.floor(n / keys.length) % breaks.length]!(key);
            const { [key]: entry, ...rest } = programs;
            await failed(api, { programs: { ...rest, [bad]: entry }, assets: {} });
            refused++;
          }
        }

        expect(added).toBeGreaterThan(0);
        expect(refused).toBeGreaterThan(0);
      }),
      { ...runs, numRuns: 100 },
    );
  });
});
