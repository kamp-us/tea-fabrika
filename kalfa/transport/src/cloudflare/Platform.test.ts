// R0a: the probe Worker's routing, run in Node on a platform `Request` made as the Worker's runtime makes it. The Worker answers
// 500 for any URL its routing cannot read, as R0's second proof run saw, so this runs on every pull request what that run found
// only on real workerd.
import { expect, it } from "@effect/vitest";
import { Arbitrary, Option } from "effect";
import { HttpServerRequest } from "effect/http";
import { pick, SEED, wellFormedText, word } from "../Transport.test-support.ts";
import { route } from "./platform-wire.test-support.ts";
import { CLOSE_CLASSES, clientMayClose, closesFrom, platformCloses } from "./Platform.test-support.ts";

// R0a. Plant: read the route with `new URL(url)` and no base (the Worker's first version): `request.url` of an Effect request is a
// path, which `new URL` refuses with "Invalid URL string", and every path-only case is red; read the object from the first path
// segment without `decodeURIComponent`: the encoded names come back with their `%` marks; take the role from the query: the role
// is lost.
it.prop(
  "R0a property: the probe Worker reads object and role from the path an Effect request has, from a whole URL, and from a path with a query",
  {
    // An object name is a word, or any text that is well formed, which is written percent-encoded in a path.
    object: Arbitrary.all({ head: word, tail: wellFormedText }),
    role: pick(["main", "log"] as const),
    query: word,
  },
  ({ object, role, query }) => {
    const name = `${object.head}${object.tail}`;
    const path = `/${encodeURIComponent(name)}/${role}`;

    // The URL of a platform `Request` is whole; Effect's request keeps the path and its query, with no host.
    for (const made of [`http://127.0.0.1:41000${path}`, `http://127.0.0.1:41000${path}?x=${query}`]) {
      const effectRequest = HttpServerRequest.fromWeb(new Request(made));

      for (const url of [made, effectRequest.url, path, `${path}?x=${query}`]) {
        expect(route(url), `${url} names the object and the role`).toEqual(Option.some({ object: name, role }));
      }
    }
  },
  { arbitrary: { seed: SEED, runs: 100 } },
);

// R0a, pinned: the three paths the probe dials before any case, and the one the readiness check asks for (R0's second proof run).
it("R0a pinned: /diag/main and /diag/log are routes, /ready is none", () => {
  for (const role of ["main", "log"] as const) {
    expect(route(HttpServerRequest.fromWeb(new Request(`http://127.0.0.1:41000/diag/${role}`)).url)).toEqual(
      Option.some({ object: "diag", role }),
    );
  }

  expect(route("/ready")).toEqual(Option.none());
});

// R0a. Plant: draw a client close of 1001 (`made("client 1001", "client", 1001)` in `closesFrom`): the client's code is refused. R0's fifth
// proof run found it only on real workerd, as `InvalidAccessError: invalid code` from the client's own `close`.
it.prop(
  "R0a property: every close R0 asks a client to make is one a WebSocket client may send, with a reason that fits, and every class is drawn",
  { seeds: Arbitrary.array(platformCloses, { minLength: 3, maxLength: 3 }) },
  ({ seeds }) => {
    const closes = closesFrom(seeds);

    expect([...new Set(closes.map(({ id }) => id))], "every class is reached").toEqual([...CLOSE_CLASSES]);

    for (const { id, by, code, reason } of closes) {
      expect(by === "server" || clientMayClose(code), `${id}: code ${code} may be sent by the client`).toBe(true);
      expect(new TextEncoder().encode(reason).length <= 123, `${id}: the reason fits 123 bytes`).toBe(true);
    }
  },
  { arbitrary: { seed: SEED, runs: 100 } },
);

// R0a pinned: 1001 and the codes below 3000 are refused by a client, the failure of R0's fifth proof run (`InvalidAccessError: invalid code`).
it("R0a pinned: a client may close with 1000 and 3000 to 4999 and with no other code", () => {
  for (const code of [999, 1001, 1005, 1011, 2999, 5000]) {
    expect(clientMayClose(code), `${code} is refused`).toBe(false);
  }

  for (const code of [1000, 3000, 4999]) {
    expect(clientMayClose(code), `${code} is allowed`).toBe(true);
  }
});
