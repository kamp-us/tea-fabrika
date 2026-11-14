// Desk S2b, next/ (the desk program fabrika/tezgah, ticket named by its title): law L20 of the approved
// plan. Written before `window/Layout.tsx`.
//
// The shape this law holds `Layout.tsx` to, from the plan and 0503 (the build may add more props):
// - `tileName(tile)` is the one function that names a tile, program first: the program's own name
//   after its pack, then `t<n>`, as `checklist, t2` for `fabrika/checklist`'s tile 2 (0503).
// - `Layout({workspace, tiles, children})` draws one workspace of tezgah's view: `workspace` the
//   window's drawn workspace, `tiles` tezgah's tiles, and `children(tile)` the body drawn inside each
//   tile. It renders the window's one `main`, and inside it one region per open tile, in reading
//   order, named by `tileName`; only the focused tile's region carries `aria-current`. Focus is never
//   in a region's name, so a tile's name stays put while focus moves.
//
// The walk is fast-check's `fc.commands` over a workspace changed only by the library's real
// `Layout.split` and `Layout.remove`, so every drawn layout is one tezgah could send. The markup is
// React's own server render, read back into a tree of elements by role and accessible name.
import { describe, expect, it } from "@effect/vitest";
import * as Layout from "@kampus/libfabrika/tezgah/Layout";
import type { Tile, TileId, Workspace } from "@kampus/libfabrika/tezgah/Workspace";
import * as fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Layout as Desk, tileName } from "./Layout.tsx";

const SEED = 119120;
const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

const typeId = (prefix: string, n: number): string => {
  let uuid = (BigInt(n) << 80n) | (7n << 76n) | (2n << 62n);
  let suffix = "";

  for (let i = 0; i < 26; i++) {
    suffix = ID_ALPHABET[Number(uuid & 31n)] + suffix;
    uuid >>= 5n;
  }

  return `${prefix}_${suffix}`;
};

// --- Reading the markup back -----------------------------------------------------------------------

type Node = {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: Array<Node | string>;
};

const VOID = new Set(["area", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const TAG = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>/g;
const ATTR = /([^\s=>/]+)(?:="([^"]*)")?/g;

const unescape = (text: string) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** React's static markup as a tree: every element with its attributes, and its text. */
const parse = (html: string): Node => {
  const root: Node = { tag: "#root", attrs: {}, children: [] };
  const stack: Array<Node> = [root];
  let last = 0;

  for (const m of html.matchAll(TAG)) {
    const text = html.slice(last, m.index);
    last = m.index + m[0].length;

    if (text !== "") {
      stack.at(-1)!.children.push(unescape(text));
    }

    const tag = m[1]!.toLowerCase();

    if (m[0].startsWith("</")) {
      const open = stack.map((n) => n.tag).lastIndexOf(tag);

      if (open > 0) {
        stack.length = open;
      }

      continue;
    }

    const attrs: Record<string, string> = {};

    for (const a of (m[2] ?? "").matchAll(ATTR)) {
      attrs[a[1]!.toLowerCase()] = unescape(a[2] ?? "");
    }

    const node: Node = { tag, attrs, children: [] };
    stack.at(-1)!.children.push(node);

    if (!VOID.has(tag) && m[3] !== "/") {
      stack.push(node);
    }
  }

  return root;
};

const all = (node: Node): ReadonlyArray<Node> => [
  node,
  ...node.children.flatMap((c) => (typeof c === "string" ? [] : all(c))),
];

const text = (node: Node): string => node.children.map((c) => (typeof c === "string" ? c : text(c))).join("");

/** An element's accessible name by HTML-AAM's first two steps: `aria-labelledby`, then `aria-label`. */
const nameIn = (root: Node, node: Node): string | null => {
  const by = node.attrs["aria-labelledby"];

  if (by !== undefined) {
    return by
      .split(/\s+/)
      .map((id) => all(root).find((n) => n.attrs["id"] === id))
      .map((n) => (n === undefined ? "" : text(n).trim()))
      .join(" ");
  }

  return node.attrs["aria-label"] ?? null;
};

/** A landmark main: a `main` element or `role="main"`. */
const isMain = (n: Node) => n.attrs["role"] === "main" || (n.tag === "main" && n.attrs["role"] === undefined);

/** A region: `role="region"`, or a `section` with an accessible name (HTML-AAM). */
const isRegion = (root: Node, n: Node) =>
  n.attrs["role"] === "region" || (n.tag === "section" && n.attrs["role"] === undefined && nameIn(root, n) !== null);

const current = (n: Node) => n.attrs["aria-current"] !== undefined && n.attrs["aria-current"] !== "false";

// --- The walk ---------------------------------------------------------------------------------------

/** The desk as tezgah holds it: workspace 1 and every tile it shows, with the next tile's number. */
type Desk = { w: Workspace; tiles: Array<Tile>; next: number };

const PROGRAMS = ["fabrika/checklist", "fabrika/counter", "acme/notes", "fabrika/inbox"] as const;

const draw = (d: Desk) =>
  renderToStaticMarkup(
    createElement(Desk, {
      workspace: d.w,
      tiles: d.tiles,
      children: (t: Tile) => createElement("p", null, `body of ${t.shows}`),
    }),
  );

const check = (d: Desk, seen: { regions: number; nested: number }) => {
  const root = parse(draw(d));
  const mains = all(root).filter(isMain);
  expect(mains, "L20: the markup has one main").toHaveLength(1);
  const regions = all(root).filter((n) => isRegion(root, n));
  const open = Layout.order(d.w.layout);
  const byId = new Map(d.tiles.map((t) => [t.id, t]));
  expect(
    regions.map((r) => nameIn(root, r)),
    "L20: one region per open tile, in reading order, each named by tileName",
  ).toEqual(open.map((id) => tileName(byId.get(id)!)));
  expect(
    regions.every((r) => all(mains[0]!).includes(r)),
    "L20: every tile's region is inside the main",
  ).toBe(true);
  expect(
    all(root)
      .filter(current)
      .map((n) => nameIn(root, n)),
    "L20: aria-current is on the focused tile's region only",
  ).toEqual([tileName(byId.get(d.w.focus)!)]);
  expect(
    regions.filter(current).map((r) => nameIn(root, r)),
    "L20: the element with aria-current is the focused tile's region",
  ).toEqual([tileName(byId.get(d.w.focus)!)]);

  for (const [i, id] of open.entries()) {
    expect(text(regions[i]!), `L20: ${tileName(byId.get(id)!)} holds its own body`).toContain(
      `body of ${byId.get(id)!.shows}`,
    );
  }

  seen.regions = Math.max(seen.regions, regions.length);
  seen.nested += typeof d.w.layout !== "string" && d.w.layout.parts.some((p) => typeof p.inner !== "string") ? 1 : 0;
};

class Split implements fc.Command<Desk, Desk> {
  constructor(
    readonly at: number,
    readonly dir: "row" | "column",
    readonly program: string,
    readonly seen: { regions: number; nested: number },
  ) {}

  check = () => true;

  run(_: Desk, d: Desk) {
    const tiles = Layout.order(d.w.layout);
    const at = tiles[this.at % tiles.length]!;
    const id = typeId("tile", d.next) as TileId;
    d.w = Layout.split(d.w, at, this.dir, id);
    d.tiles.push({
      id,
      n: d.next,
      shows: `${this.program.slice(this.program.indexOf("/") + 1)}:t${d.next}`,
      program: this.program,
      child: true,
      keep: "failed",
      cursor: null,
    } as Tile);
    d.next++;
    check(d, this.seen);
  }

  toString = () => `split ${this.at} ${this.dir} ${this.program}`;
}

class Close implements fc.Command<Desk, Desk> {
  constructor(
    readonly at: number,
    readonly seen: { regions: number; nested: number },
  ) {}

  check = (d: Readonly<Desk>) => Layout.order(d.w.layout).length > 1;

  run(_: Desk, d: Desk) {
    const tiles = Layout.order(d.w.layout);
    const gone = tiles[this.at % tiles.length]!;
    d.w = Layout.remove(d.w, gone);
    d.tiles = d.tiles.filter((t) => t.id !== gone);
    check(d, this.seen);
  }

  toString = () => `close ${this.at}`;
}

describe("L20: one main, one region per open tile named by tileName, aria-current on the focused one", () => {
  it("L20: tileName is the program's own name, then t<n>", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("fabrika", "acme", "kamp-us"),
        fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
        fc.integer({ min: 1, max: 10_000 }),
        (pack, name, n) => {
          const tile = {
            id: typeId("tile", n),
            n,
            shows: `${name}:1`,
            program: `${pack}/${name}`,
            child: n > 1,
            keep: "failed",
            cursor: null,
          } as Tile;
          expect(tileName(tile), "L20: program first, then t<n>").toBe(`${name}, t${n}`);
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
  });

  it("L20: after any splits and closes, the markup has one main, one region per open tile in reading order named by tileName, and aria-current only on the focused tile", () => {
    const seen = { regions: 0, nested: 0 };
    fc.assert(
      fc.property(
        fc.commands(
          [
            fc
              .tuple(fc.nat(), fc.constantFrom("row" as const, "column" as const), fc.constantFrom(...PROGRAMS))
              .map(([at, dir, program]) => new Split(at, dir, program, seen)),
            fc.nat().map((at) => new Close(at, seen)),
          ],
          { size: "+1", maxCommands: 12 },
        ),
        (cmds) => {
          const first = typeId("tile", 1) as TileId;
          const real: Desk = {
            w: { id: typeId("workspace", 1), n: 1, layout: first, focus: first, recent: [first] } as Workspace,
            tiles: [
              {
                id: first,
                n: 1,
                shows: "checklist:1",
                program: "fabrika/checklist",
                child: false,
                keep: "failed",
                cursor: null,
              } as Tile,
            ],
            next: 2,
          };
          check(real, seen);
          fc.modelRun(() => ({ model: real, real }), cmds);
        },
      ),
      { seed: SEED, numRuns: 100 },
    );
    expect(seen.regions, "L20: the walks draw several tiles").toBeGreaterThan(3);
    expect(seen.nested, "L20: the walks draw nested containers").toBeGreaterThan(0);
  });
});
