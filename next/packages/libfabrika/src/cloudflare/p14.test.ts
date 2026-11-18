import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Match from "effect/Match";
// P14 slice 1, next/ (ticket 698): the Worker serves a built tab's page at `/` (S1.3). Later slices
// add the control and bootstrap laws here.
//
// The shape this law holds the code to, from the approved plan: `fetch(request, env, config, assets)`
// takes P16's table of window files by route, each `{hash, type, body}`. The page is the asset at
// `/index.html`. `GET` or `HEAD /` answers it with its type and ETag when the table holds it, and
// the plain answer when it does not. Every other route, the Host and Origin checks first, HEAD
// without a body, the ETag of the current table and 404 for a missing file stay as P16 has them.
//
// S1.3 is a generated walk. Each step reads the walk's state (the table the brain carries now, the
// tables it carried before) and builds a move that state allows: a rebuild, or a request for a route
// the current table holds, a fresh absent route or `/`, with the current validator or a stale one.

import { Stub } from "@kampus/vitest";
import * as Digest from "effect/crypto/Digest";
import * as Rec from "effect/Record";

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as Start from "../settings/Start.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import type { ConnectionBinding, ProcessBinding, ProjectBinding, RecordBinding } from "./bindings.ts";
import * as Route from "./fetch.ts";
import type { Env } from "./runtime.ts";

type Asset = { readonly hash: string; readonly type: string; readonly body: string };

type Assets = Readonly<Record<string, Asset>>;

/** A text's SHA-256 in hex, through Effect's Digest on the platform's WebCrypto. */
const sha = (text: string) =>
  Effect.runPromise(
    Digest.Digest.use((digest) => digest.digestHex(Digest.sha256, new TextEncoder().encode(text))).pipe(
      Effect.provide(Digest.layerWebCrypto),
    ),
  );

const HTML = "text/html; charset=utf-8";

const JS = "text/javascript; charset=utf-8";

const CSS = "text/css; charset=utf-8";

const PAGE = "/index.html";

const config = (port: number) =>
  Effect.runPromise(
    StartsTest.fixture({
      name: "p14",
      port,
      person: "person-test",
      founder: "public-test",
      window: null,
      build: "test",
    }),
  );

/** An environment whose every stub call is written down, so the law can say none was made. */
const world = (input: Awaited<ReturnType<typeof config>>) => {
  const calls: Array<string> = [];
  /** Any call on the stub for `to`: written down, and answered `{ _tag: "ok" }`. */
  const recorded = (to: string) => (method: string) => async () => {
    calls.push(`${to}.${method}`);
    return { _tag: "ok" };
  };

  // SAFETY: these routes reach only these four namespaces, and each answers with a Stub of its binding that records any call.
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node doubles implement only the RPC members these routes call
  const env = {
    INSTANCE: JSON.stringify(input),
    PROJECT: {
      getByName: () =>
        Stub.make<ProjectBinding>(recorded("project"), {
          settingsStart: async () => Start.Reply.cases.ok.make({ value: StartsTest.receipt(input) }),
        }),
    },
    CONNECTION: {
      getByName: () =>
        Stub.make<ConnectionBinding>(
          // @ts-expect-error the canned `{ _tag: "ok" }` is no Connection call's answer; any call fails this law anyway
          recorded("connection"),
        ),
    },
    PROCESS: { getByName: () => Stub.make<ProcessBinding>(recorded("process")) },
    RECORD: { getByName: () => Stub.make<RecordBinding>(recorded("record")) },
  } as unknown as Env;

  return { env, calls };
};

const must = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  throw new Error(Cause.pretty(exit.cause));
};

/** One generated step: choice seeds and values the walk turns into a move against its state. */
const step = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  method: fc.nat(),
  host: fc.nat(),
  origin: fc.nat(),
  validator: fc.nat(),
  text: fc.string({ unit: "grapheme", maxLength: 40 }),
  word: fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,8}$/),
  extra: fc.array(fc.stringMatching(/^[a-z0-9]{1,8}$/), { maxLength: 3 }),
});

type Step = typeof step extends fc.Arbitrary<infer S> ? S : never;

const METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE"] as const;

/** A rebuild's table, derived from the step: a page or none, the tab's script, and other files. */
const rebuilt = async (s: Step, generation: number): Promise<Assets> => {
  const assets: Record<string, Asset> = {};

  const add = async (route: string, type: string, body: string) => {
    assets[route] = { hash: await sha(body), type, body };
  };

  if (s.pick % 3 !== 0) {
    await add(PAGE, HTML, `<!doctype html>${s.text}<!-- ${generation} -->`);
  }

  await add("/window.js", JS, `export const g = ${generation}; ${JSON.stringify(s.text)};`);

  for (const [n, name] of s.extra.entries()) {
    await add(`/${name}-${n}.${n % 2 === 0 ? "js" : "css"}`, n % 2 === 0 ? JS : CSS, `/* ${generation} ${name} */`);
  }

  return assets;
};

/** What reached means for this walk: each a case a run must have exercised to claim coverage. */
const REACH = ["page", "plain-root", "asset", "absent", "head", "write", "stale", "current", "host", "origin"] as const;

describe("P14 S1.3: the brain serves the built page at / and keeps P16's serving rules", () => {
  it("generated walks of rebuilds and requests: GET, HEAD, ETag, missing routes, root fallback and access checks", async () => {
    const fetch = Route.fetch;
    const reached = new Set<(typeof REACH)[number]>();
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1024, max: 65_535 }),
        fc.array(step, { minLength: 1, maxLength: 24 }),
        async (port, steps) => {
          const input = await config(port);
          const { env, calls } = world(input);
          const origin = `http://127.0.0.1:${port}`;
          // The walk's state: the table the brain carries now (none before the first build), and every
          // validator an earlier table served.
          let current: Assets | undefined;
          const stale: Array<string> = [];
          let generation = 0;

          for (const s of steps) {
            // A rebuild is always possible; the first move of a walk with no table yet may also be one.
            if (s.move % 4 === 0) {
              for (const asset of Rec.values(current ?? {})) {
                stale.push(asset.hash);
              }

              current = await rebuilt(s, ++generation);
              continue;
            }

            const routes = Rec.keys(current ?? {});
            const choices = ["/", ...routes, `/${s.word}-absent.js`];
            const path = choices[s.pick % choices.length]!;
            const method = METHODS[s.method % METHODS.length]!;
            const wrongHost = s.host % 5 === 0;
            const originHeader = Match.value(s.origin % 5).pipe(
              Match.when(0, () => "http://evil.example"),
              Match.when(1, () => origin),
              Match.orElse(() => null),
            );
            const target = path === "/" ? (current !== undefined && Rec.has(current, PAGE) ? PAGE : null) : path;

            const asset =
              target !== null && current !== undefined && Rec.has(current, target) ? current[target] : undefined;

            const validators = [
              ...(asset === undefined ? [] : [`"${asset.hash}"`]),
              ...stale.filter((h) => h !== asset?.hash).map((h) => `"${h}"`),
            ];

            const validator =
              validators.length > 0 && s.validator % 3 !== 0 ? validators[s.validator % validators.length]! : null;

            const headers: Record<string, string> = { host: wrongHost ? "evil.example" : `127.0.0.1:${port}` };

            if (originHeader !== null) {
              headers.origin = originHeader;
            }

            if (validator !== null) {
              headers["if-none-match"] = validator;
            }

            const response = must(
              await Effect.runPromiseExit(
                fetch(
                  new Request(`${origin}${path}`, {
                    method,
                    headers,
                    ...(method === "GET" || method === "HEAD" ? {} : { body: s.text }),
                  }),
                  env,
                  input,
                  current,
                ),
              ),
            );

            const body = await response.text();

            if (wrongHost) {
              reached.add("host");
              expect(response.status, "a wrong host is refused before any route").toBe(421);
              continue;
            }

            if (originHeader === "http://evil.example") {
              reached.add("origin");
              expect(response.status, "a foreign origin is refused before any route").toBe(403);
              continue;
            }

            const reads = method === "GET" || method === "HEAD";

            if (method === "HEAD") {
              reached.add("head");
            }

            if (!reads) {
              reached.add("write");
            }

            if (reads && asset !== undefined) {
              reached.add(path === "/" ? "page" : "asset");
              expect(response.headers.get("content-type"), `${method} ${path}`).toBe(asset.type);
              expect(response.headers.get("etag"), `${method} ${path} carries the current table's validator`).toBe(
                `"${asset.hash}"`,
              );

              if (validator === `"${asset.hash}"`) {
                reached.add("current");
                // The current validator may be answered as unchanged, never with another body.
                expect([200, 304]).toContain(response.status);
                expect(body).toBe(response.status === 304 || method === "HEAD" ? "" : asset.body);
              } else {
                if (validator !== null) {
                  reached.add("stale");
                }

                expect(response.status, `${method} ${path}`).toBe(200);
                expect(body, `${method} ${path}: HEAD has no body, GET the current one`).toBe(
                  method === "HEAD" ? "" : asset.body,
                );
              }
            } else if (path === "/" || !reads || current === undefined) {
              if (path === "/") {
                reached.add("plain-root");
              }

              // No page, a write, or a brain with no table: the plain answer, as P12 and P16 have it.
              expect(response.status, `${method} ${path}`).toBe(200);
              expect(response.headers.get("content-type"), `${method} ${path}`).toContain("text/plain");
            } else {
              reached.add("absent");
              expect(response.status, `${method} ${path} is not in the table`).toBe(404);
            }
          }

          expect(calls, "serving files reaches no object").toEqual([]);
        },
      ),
      { seed: 119120, numRuns: 100 },
    );
    expect([...reached].sort(), "every serving case was reached by the generated walks").toEqual([...REACH].sort());
  });
});
