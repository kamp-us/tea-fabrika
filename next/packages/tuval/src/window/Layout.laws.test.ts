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
import { type Tile, type TileId, Workspace } from "@kampus/libfabrika/tezgah/Workspace";
import { Schema } from "effect";
import * as Arr from "effect/Array";
import * as Function from "effect/Function";
import * as Option from "effect/Option";
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
      const open = Arr.map(stack, (n) => n.tag).lastIndexOf(tag);

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
  ...Arr.flatMap(node.children, (c) => (typeof c === "string" ? [] : all(c))),
];

const text = (node: Node): string =>
  Function.pipe(
    node.children,
    Arr.map((c) => (typeof c === "string" ? c : text(c))),
    Arr.join(""),
  );

/** An element's accessible name by HTML-AAM's first two steps: `aria-labelledby`, then `aria-label`. */
const nameIn = (root: Node, node: Node): string | null => {
  const by = node.attrs["aria-labelledby"];

  if (by !== undefined) {
    return Function.pipe(
      by.split(/\s+/),
      Arr.map((id) =>
        Option.match(
          Arr.findFirst(all(root), (n) => n.attrs["id"] === id),
          { onNone: () => "", onSome: (n) => text(n).trim() },
        ),
      ),
      Arr.join(" "),
    );
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
  const mains = Arr.filter(all(root), isMain);
  expect(mains, "L20: the markup has one main").toHaveLength(1);
  const regions = Arr.filter(all(root), (n) => isRegion(root, n));
  const open = Layout.order(d.w.layout);
  const byId = new Map(Arr.map(d.tiles, (t) => [t.id, t]));
  expect(
    Arr.map(regions, (r) => nameIn(root, r)),
    "L20: one region per open tile, in reading order, each named by tileName",
  ).toEqual(Arr.map(open, (id) => tileName(byId.get(id)!)));
  expect(
    Arr.every(regions, (r) => all(mains[0]!).includes(r)),
    "L20: every tile's region is inside the main",
  ).toBe(true);
  expect(
    Function.pipe(
      all(root),
      Arr.filter(current),
      Arr.map((n) => nameIn(root, n)),
    ),
    "L20: aria-current is on the focused tile's region only",
  ).toEqual([tileName(byId.get(d.w.focus)!)]);
  expect(
    Function.pipe(
      regions,
      Arr.filter(current),
      Arr.map((r) => nameIn(root, r)),
    ),
    "L20: the element with aria-current is the focused tile's region",
  ).toEqual([tileName(byId.get(d.w.focus)!)]);

  for (const [i, id] of open.entries()) {
    expect(text(regions[i]!), `L20: ${tileName(byId.get(id)!)} holds its own body`).toContain(
      `body of ${byId.get(id)!.shows}`,
    );
  }

  seen.regions = Math.max(seen.regions, regions.length);
  seen.nested +=
    typeof d.w.layout !== "string" && Arr.some(d.w.layout.parts, (p) => typeof p.inner !== "string") ? 1 : 0;
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
    d.tiles = Arr.filter(d.tiles, (t) => t.id !== gone);
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
            w: Schema.decodeUnknownSync(Workspace)({
              id: typeId("workspace", 1),
              n: 1,
              layout: first,
              focus: first,
              recent: [first],
            }),
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

// Desk S4, next/: law L31's markup half, written before `Layout.tsx` draws a strip. The library's
// `tezgah/Fold.laws.test.ts` holds which tiles fold. The shape this law holds `Layout.tsx` to, from
// the plan, 0506's lessons and the brief (the build may add more props):
// - `Layout` takes `strips`, the tiles this window draws as strips (`fold(workspace, size)`, which the
//   page works out from the window's size; never stored, never sent). Without it nothing folds, so
//   L20's walk is unchanged.
// - A strip is a real `button`, in the Tab order, named `open <program>, t<n>`: `open ` and then
//   `tileName`'s words. A strip is not a region, so the regions are the open tiles alone, in reading
//   order, and `aria-current` stays on the focused tile's region. A strip holds no tile body: a
//   button may hold no interactive content (HTML, the button element's content model), and programs
//   know nothing about folds (0506). The focused tile is never a strip.
// - How a strip opens (Enter or a click focuses its tile, so it opens) is the page's, walked in the
//   app's `e2e/tezgah-fold.visual.test.ts` (L33).
//
// The walk draws a window size from 320x240 to 2560x1600 and a layout walked from one tile with the
// library's real `Layout.split` and `Layout.remove`. The markup law holds for any set of strips
// without the focused tile, so the set is worked out here and never from the product's `fold`: each
// tile but the focused one drawn under 220x120 at its full share (`Layout.rects` with `GAP`), which
// folds whole containers often. Where each strip and band is drawn (plan amendment 13) is the fold
// laws' and the app's end-to-end law's: static markup carries no drawn size.
const SMALLEST = { width: 220, height: 120 } as const;

/** A set of strips for the walk: every tile but the focused one drawn under 220x120 at its full share. */
const stripsAt = (w: Workspace, size: { readonly width: number; readonly height: number }): ReadonlySet<TileId> => {
  const drawn = Layout.rects(w.layout, size, { gap: Layout.GAP });
  return new Set(
    Arr.filter(Layout.order(w.layout), (t) => {
      const r = drawn.get(t)!;
      return t !== w.focus && (r.width < SMALLEST.width || r.height < SMALLEST.height);
    }),
  );
};

/** A button: a `button` element, or `role="button"`. */
const isButton = (n: Node) => n.attrs["role"] === "button" || (n.tag === "button" && n.attrs["role"] === undefined);

/** Every element on the way from `root` down to `node`, `node` last; empty when it is not there. */
const pathTo = (root: Node, node: Node): ReadonlyArray<Node> => {
  if (root === node) {
    return [node];
  }

  for (const c of root.children) {
    const below = typeof c === "string" ? [] : pathTo(c, node);

    if (below.length > 0) {
      return [root, ...below];
    }
  }

  return [];
};

const INTERACTIVE = new Set(["a", "button", "input", "select", "textarea", "details", "iframe", "label"]);

const Folded = fc.record({
  width: fc.integer({ min: 320, max: 2_560 }),
  height: fc.integer({ min: 240, max: 1_600 }),
  cuts: fc.array(fc.record({ at: fc.nat(), down: fc.boolean(), close: fc.boolean(), program: fc.nat() }), {
    minLength: 0,
    maxLength: 12,
  }),
  focus: fc.nat(),
});

describe("Desk S4 L31: a strip in the markup is a real button named by its program, never the focused tile", () => {
  it("L31: at any size and layout, each strip is a button in the Tab order named open <program>, t<n>, outside every region and holding no body; the regions are the open tiles in reading order, and the focused tile is never a strip", () => {
    const seen = { strips: 0, open: 0, nested: 0 };
    fc.assert(
      fc.property(Folded, ({ width, height, cuts, focus }) => {
        const first = typeId("tile", 1) as TileId;
        let w: Workspace = Schema.decodeUnknownSync(Workspace)({
          id: typeId("workspace", 1),
          n: 1,
          layout: first,
          focus: first,
          recent: [first],
        });
        const tiles: Array<Tile> = [
          {
            id: first,
            n: 1,
            shows: "checklist:1",
            program: "fabrika/checklist",
            child: false,
            keep: "failed",
            cursor: null,
          } as Tile,
        ];

        for (const [k, cut] of cuts.entries()) {
          const live = Layout.order(w.layout);
          const at = live[cut.at % live.length]!;

          if (cut.close && live.length > 1) {
            w = Layout.remove(w, at);
            continue;
          }

          const id = typeId("tile", k + 2) as TileId;
          const program = PROGRAMS[cut.program % PROGRAMS.length]!;
          w = Layout.split(w, at, cut.down ? "column" : "row", id);
          tiles.push({
            id,
            n: k + 2,
            shows: `${program.slice(program.indexOf("/") + 1)}:t${k + 2}`,
            program,
            child: true,
            keep: "failed",
            cursor: null,
          } as Tile);
        }

        const live = Layout.order(w.layout);
        w = Layout.focus(w, live[focus % live.length]!);
        const shown = Arr.filter(tiles, (t) => live.includes(t.id));
        const strips = stripsAt(w, { width, height });
        const byId = new Map(Arr.map(shown, (t) => [t.id, t]));
        const root = parse(
          renderToStaticMarkup(
            createElement(Desk, {
              workspace: w,
              tiles: shown,
              strips,
              children: (t: Tile) => createElement("p", null, `body of ${t.shows}`),
            } as Parameters<typeof Desk>[0]),
          ),
        );
        const mains = Arr.filter(all(root), isMain);
        expect(mains, "L31: the markup has one main").toHaveLength(1);
        const open = Arr.filter(live, (t) => !strips.has(t));
        const folded = Arr.filter(live, (t) => strips.has(t));
        const regions = Arr.filter(all(root), (n) => isRegion(root, n));
        expect(
          Arr.map(regions, (r) => nameIn(root, r)),
          `L31: at ${width}x${height} the regions are the open tiles, in reading order`,
        ).toEqual(Arr.map(open, (t) => tileName(byId.get(t)!)));
        expect(
          Function.pipe(
            all(root),
            Arr.filter(current),
            Arr.map((n) => nameIn(root, n)),
          ),
          "L31: aria-current is on the focused tile's region only",
        ).toEqual([tileName(byId.get(w.focus)!)]);
        const buttons = Arr.filter(all(root), (n) => isButton(n) && (nameIn(root, n) ?? "").startsWith("open "));
        expect(
          Arr.map(buttons, (b) => nameIn(root, b)),
          `L31: at ${width}x${height} each strip is one button named open <program>, t<n>, in reading order`,
        ).toEqual(Arr.map(folded, (t) => `open ${tileName(byId.get(t)!)}`));
        expect(
          Arr.some(buttons, (b) => nameIn(root, b) === `open ${tileName(byId.get(w.focus)!)}`),
          "L31: the focused tile is never a strip",
        ).toBe(false);

        for (const [i, b] of buttons.entries()) {
          const name = nameIn(root, b);
          const way = pathTo(root, b);
          expect(b.tag, `L31: ${name} is a real button element`).toBe("button");
          expect(b.attrs["tabindex"] === "-1", `L31: ${name} is in the Tab order`).toBe(false);
          expect("disabled" in b.attrs, `L31: ${name} is not disabled`).toBe(false);
          expect(
            Arr.some(way, (n) => "inert" in n.attrs || n.attrs["aria-hidden"] === "true"),
            `L31: ${name} is neither inert nor hidden`,
          ).toBe(false);
          expect(way.includes(mains[0]!), `L31: ${name} is inside the main`).toBe(true);
          expect(
            Arr.some(way, (n) => isRegion(root, n)),
            `L31: ${name} sits in no region`,
          ).toBe(false);
          expect(text(b), `L31: ${name} holds no tile body`).not.toContain(`body of ${byId.get(folded[i]!)!.shows}`);
          expect(
            Function.pipe(
              all(b).slice(1),
              Arr.filter(
                (n) => INTERACTIVE.has(n.tag) || (n.attrs["tabindex"] !== undefined && n.attrs["tabindex"] !== "-1"),
              ),
              Arr.map((n) => n.tag),
            ),
            `L31: ${name} holds nothing interactive`,
          ).toEqual([]);
        }

        for (const t of folded) {
          expect(text(root), `L31: the folded tile ${tileName(byId.get(t)!)} draws no body`).not.toContain(
            `body of ${byId.get(t)!.shows}`,
          );
        }

        for (const [i, t] of open.entries()) {
          expect(text(regions[i]!), `L31: ${tileName(byId.get(t)!)} holds its own body`).toContain(
            `body of ${byId.get(t)!.shows}`,
          );
        }

        seen.strips += folded.length > 0 ? 1 : 0;
        seen.open += folded.length > 0 && open.length > 1 ? 1 : 0;
        seen.nested +=
          folded.length > 0 &&
          typeof w.layout !== "string" &&
          Arr.some(w.layout.parts, (p) => typeof p.inner !== "string")
            ? 1
            : 0;
      }),
      { seed: SEED, numRuns: 300 },
    );
    expect(seen.strips, "L31: the walks draw strips").toBeGreaterThan(0);
    expect(seen.open, "L31: the walks draw strips beside more than one open tile").toBeGreaterThan(0);
    expect(seen.nested, "L31: the walks draw strips inside nested containers").toBeGreaterThan(0);
  });
});
