// Desk S2a, next/ (the desk program fabrika/tezgah, ticket named by its title): law L5 of the
// approved plan, on the real `Layout.ts` and `Workspace.ts`. Written before both exist.
//
// The shape this law holds the build to, from the plan's "The shape" (the build may add more):
// - `Workspace.ts` exports the Effect Schemas `TileId` (Id.make("tile")), `WorkspaceId`
//   (Id.make("workspace")) and `Workspace`: {id, n, layout, focus, recent}. A layout is a tile id or
//   a container {dir: "row" | "column", parts: [{percent, inner}]}, `percent` on each part (0277).
// - `Layout.ts` is pure: `split(w, at, dir, tile)` gives the new tile half of `at`'s share, after
//   it; `remove(w, tile)` gives the tile's share to the part before and settles the tree; `order`
//   is the layout's reading order; `check(w)` lists every violation of a tidy workspace, empty when
//   it is tidy.
// - Tidy means (0505, read through 0277): each tile once; a container's parts' percents sum to
//   100; no container with one part; a container nested in another runs the other direction; focus
//   and every `recent` id name a live tile, and `recent` names each at most once.
//
// The walk is fc.commands from one tile: split right, split down and close on a live tile the
// model picks, a close only while two or more are live (the last tile is the program's refusal,
// L7). After every command the law reads the tree three ways: `Layout.check`, the law's own
// tidiness oracle written here from the plan's words, and the live set the model kept.
// The second property breaks a walked, tidy workspace in one named way and asks `check` to see it,
// so `check` is itself a checked oracle, as 0505's "a check that refuses a broken tree" asks.
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as fc from "fast-check";
import * as Layout from "./Layout.ts";
import { TileId, Workspace } from "./Workspace.ts";

const SEED = 119120;
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** A canonical UUIDv7 TypeID for `n`, made here so the law does not lean on the generator it checks. */
const typeId = (prefix: string, n: number): string => {
  let uuid = (BigInt(n) << 80n) | (7n << 76n) | (2n << 62n) | BigInt(n % 4096);
  let suffix = "";

  for (let i = 0; i < 26; i++) {
    suffix = ALPHABET[Number(uuid & 31n)] + suffix;
    uuid >>= 5n;
  }

  return `${prefix}_${suffix}`;
};

type Node = string | { readonly dir: string; readonly parts: ReadonlyArray<{ percent: number; inner: Node }> };

type Space = {
  readonly id: string;
  readonly n: number;
  readonly layout: Node;
  readonly focus: string;
  readonly recent: ReadonlyArray<string>;
};

/** The workspace as the wire shows it: what every client reads. */
const encode = (w: unknown): Space => Schema.encodeUnknownSync(Workspace)(w) as Space;
const decode = (w: Space) => Schema.decodeUnknownSync(Workspace)(w);
const tileId = (id: string) => Schema.decodeUnknownSync(TileId)(id);

/** Reading order, written here: a container's parts in order, depth first. */
const order = (node: Node): ReadonlyArray<string> =>
  typeof node === "string" ? [node] : Arr.flatMap(node.parts, (p) => order(p.inner));

/** Every way a workspace is untidy, by the plan's words; empty when tidy. */
const untidy = (w: Space): ReadonlyArray<string> => {
  const out: Array<string> = [];
  const walk = (node: Node, parent: string | null): void => {
    if (typeof node === "string") {
      return;
    }

    if (node.dir !== "row" && node.dir !== "column") {
      out.push(`direction ${node.dir}`);
    }

    if (node.parts.length < 2) {
      out.push(`a ${node.dir} of ${node.parts.length} part`);
    }

    if (parent === node.dir) {
      out.push(`a ${node.dir} inside a ${parent}`);
    }

    const sum = Arr.reduce(node.parts, 0, (total, p) => total + p.percent);

    if (Math.abs(sum - 100) > 1e-6) {
      out.push(`parts sum to ${sum}`);
    }

    for (const p of node.parts) {
      if (!(p.percent > 0)) {
        out.push(`a part of ${p.percent}%`);
      }

      walk(p.inner, node.dir);
    }
  };
  walk(w.layout, null);
  const tiles = order(w.layout);
  const live = new Set(tiles);

  if (live.size !== tiles.length) {
    out.push(`a tile twice in ${JSON.stringify(tiles)}`);
  }

  if (!live.has(w.focus)) {
    out.push(`focus ${w.focus} is not live`);
  }

  for (const id of w.recent) {
    if (!live.has(id)) {
      out.push(`recent ${id} is not live`);
    }
  }

  if (new Set(w.recent).size !== w.recent.length) {
    out.push("recent names a tile twice");
  }

  return out;
};

type Model = { live: Array<string>; next: number };
type Real = { w: ReturnType<typeof decode> };

const after = (m: Model, r: Real, label: string) => {
  const shown = encode(r.w);
  expect(Layout.check(r.w), `L5: check after ${label}`).toEqual([]);
  expect(untidy(shown), `L5: the tree after ${label}`).toEqual([]);
  expect([...order(shown.layout)].sort(), `L5: the live tiles after ${label}`).toEqual([...m.live].sort());
  expect(Layout.order(r.w.layout), `L5: reading order after ${label}`).toEqual(order(shown.layout));
};

const Split = (dir: "row" | "column", pick: number): fc.Command<Model, Real> => ({
  check: (m) => m.live.length > 0 && m.live.length < 24,
  run: (m, r) => {
    const at = m.live[pick % m.live.length]!;
    const tile = typeId("tile", m.next++);
    r.w = Layout.split(r.w, tileId(at), dir, tileId(tile));
    m.live.push(tile);
    after(m, r, `split ${dir} at ${at}`);
  },
  toString: () => `split ${dir} ${pick}`,
});

const Close = (pick: number): fc.Command<Model, Real> => ({
  check: (m) => m.live.length > 1,
  run: (m, r) => {
    const tile = m.live[pick % m.live.length]!;
    r.w = Layout.remove(r.w, tileId(tile));
    m.live = Arr.filter(m.live, (t) => t !== tile);
    after(m, r, `close ${tile}`);
  },
  toString: () => `close ${pick}`,
});

const commands = fc.commands(
  [
    fc.nat().map((pick) => Split("row", pick)),
    fc.nat().map((pick) => Split("column", pick)),
    fc.nat().map((pick) => Close(pick)),
  ],
  { maxCommands: 60, size: "max" },
);

/** One workspace of one tile, as tezgah makes workspace 1. */
const first = () => {
  const t1 = typeId("tile", 1);
  return decode({ id: typeId("workspace", 1), n: 1, layout: t1, focus: t1, recent: [t1] });
};

/** One named break of a tidy workspace, or null when this tree has no place for it. */
const BREAKS = ["one_part", "same_direction", "sum", "twice", "focus", "recent"] as const;

const broken = (w: Space, kind: (typeof BREAKS)[number], pick: number): Space | null => {
  const root = w.layout;
  const ghost = typeId("tile", 9_000 + pick);

  switch (kind) {
    case "one_part":
      return { ...w, layout: { dir: "row", parts: [{ percent: 100, inner: root }] } };
    case "same_direction":
      return typeof root === "string"
        ? null
        : {
            ...w,
            layout: {
              dir: root.dir,
              parts: [
                { percent: 50, inner: root },
                { percent: 50, inner: ghost },
              ],
            },
          };
    case "sum":
      return typeof root === "string"
        ? null
        : {
            ...w,
            layout: { ...root, parts: Arr.map(root.parts, (p, i) => (i === 0 ? { ...p, percent: p.percent + 1 } : p)) },
          };
    case "twice": {
      const tiles = order(root);
      const dir = typeof root === "string" ? "row" : root.dir === "row" ? "column" : "row";
      return {
        ...w,
        layout: {
          dir,
          parts: [
            { percent: 50, inner: root },
            { percent: 50, inner: tiles[pick % tiles.length]! },
          ],
        },
      };
    }
    case "focus":
      return { ...w, focus: ghost };
    case "recent":
      return { ...w, recent: [...w.recent, ghost] };
  }
};

describe("Desk S2a L5: the layout stays tidy", () => {
  it("L5: after any sequence of splits and closes, Layout.check finds nothing: each tile once, parts sum to 100, no one-part split, directions alternate, focus and recent name only live tiles", () => {
    fc.assert(
      fc.property(commands, (cmds) => {
        const t1 = typeId("tile", 1);
        fc.modelRun(() => ({ model: { live: [t1], next: 2 }, real: { w: first() } }), cmds);
      }),
      { seed: SEED, numRuns: 300 },
    );
  });

  it("L5: check refuses a walked tree broken in any one way: one part, the same direction nested, a wrong sum, a tile twice, a dead focus, a dead recent", () => {
    fc.assert(
      fc.property(commands, fc.constantFrom(...BREAKS), fc.nat(), (cmds, kind, pick) => {
        const t1 = typeId("tile", 1);
        const real = { w: first() };
        fc.modelRun(() => ({ model: { live: [t1], next: 2 }, real }), cmds);
        const bad = broken(encode(real.w), kind, pick);

        if (bad === null) {
          return;
        }

        expect(untidy(bad).length, `the law's own oracle sees ${kind}`).toBeGreaterThan(0);
        const w = Schema.decodeUnknownOption(Workspace)(bad);

        // A schema that refuses the broken shape outright is stricter still.
        if (w._tag === "Some") {
          expect(Layout.check(w.value).length, `L5: check sees ${kind} in ${JSON.stringify(bad)}`).toBeGreaterThan(0);
        }
      }),
      { seed: SEED, numRuns: 300 },
    );
  });
});

// Desk S2b, the plan's seventh amendment (after S2b's first review): `Layout.rects(layout, size,
// {gap})` measures drawn tiles. Each container leaves exactly `parts - 1` gaps between its parts and
// gives each part its percent of what is left; a nested container loses its own gaps from its own
// share. The law reads every container's extent back from its tiles' rectangles, so it checks the
// drawing, not the arithmetic the product used.
type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** The smallest box around every tile under `node`, from the tiles' rectangles. */
const extent = (node: Node, at: ReadonlyMap<string, Box>): Box => {
  const boxes = Arr.map(order(node), (t) => at.get(t)!);
  const x = Math.min(...Arr.map(boxes, (b) => b.x));
  const y = Math.min(...Arr.map(boxes, (b) => b.y));
  return {
    x,
    y,
    width: Math.max(...Arr.map(boxes, (b) => b.x + b.width)) - x,
    height: Math.max(...Arr.map(boxes, (b) => b.y + b.height)) - y,
  };
};

/** Every way the tiles' rectangles break the gap rule, empty when they keep it. */
const gapBreaks = (layout: Node, at: ReadonlyMap<string, Box>, size: Box, gap: number): ReadonlyArray<string> => {
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  const out: Array<string> = [];
  const whole = extent(layout, at);

  if (
    !Arr.every([whole.x - size.x, whole.y - size.y, whole.width - size.width, whole.height - size.height], (d) =>
      near(d, 0),
    )
  ) {
    out.push(`the tiles fill ${JSON.stringify(whole)}, the window ${JSON.stringify(size)}`);
  }

  const walk = (node: Node): void => {
    if (typeof node === "string") {
      return;
    }

    const box = extent(node, at);
    const row = node.dir === "row";
    const start = (b: Box) => (row ? b.x : b.y);
    const long = (b: Box) => (row ? b.width : b.height);
    const parts = Arr.map(node.parts, (p) => extent(p.inner, at));
    const left = long(box) - (node.parts.length - 1) * gap;
    let edge = start(box);

    for (const [i, p] of parts.entries()) {
      if (!near(start(p), edge)) {
        out.push(`${node.dir} part ${i} starts at ${start(p)}, after ${i} gaps it is ${edge}`);
      }

      if (!near(long(p), (left * node.parts[i]!.percent) / 100)) {
        out.push(`${node.dir} part ${i} is ${long(p)} long, ${node.parts[i]!.percent}% of ${left} left after the gaps`);
      }

      if (
        !near(row ? p.y : p.x, row ? box.y : box.x) ||
        !near(row ? p.height : p.width, row ? box.height : box.width)
      ) {
        out.push(`${node.dir} part ${i} does not span its container across`);
      }

      edge = start(p) + long(p) + gap;
    }

    if (!near(edge - gap, start(box) + long(box))) {
      out.push(
        `${node.dir}'s parts and ${node.parts.length - 1} gaps end at ${edge - gap}, the container at ${start(box) + long(box)}`,
      );
    }

    for (const p of node.parts) {
      walk(p.inner);
    }
  };
  walk(layout);
  return out;
};

/** The shortest side any tile gets under the amendment's rule, written here: what is left after a
 *  container's gaps, shared by percent. A walk whose tiles would get none is too small to read. */
const shortest = (node: Node, width: number, height: number, gap: number): number => {
  if (typeof node === "string") {
    return Math.min(width, height);
  }

  const left = (node.dir === "row" ? width : height) - (node.parts.length - 1) * gap;
  return Math.min(
    ...Arr.map(node.parts, (p) =>
      node.dir === "row"
        ? shortest(p.inner, (left * p.percent) / 100, height, gap)
        : shortest(p.inner, width, (left * p.percent) / 100, gap),
    ),
  );
};

describe("Desk S2b: rects measure drawn tiles, with the frame's gap between parts", () => {
  it("S2b amendment 7: after any splits and closes, rects(layout, size, {gap}) leaves exactly parts - 1 gaps per container, each part its percent of what is left, and the parts and gaps fill each container", () => {
    let nested = 0;
    fc.assert(
      fc.property(
        commands,
        fc.integer({ min: 200, max: 2_600 }),
        fc.integer({ min: 150, max: 1_700 }),
        fc.integer({ min: 0, max: 12 }),
        (cmds, width, height, gap) => {
          const t1 = typeId("tile", 1);
          const real = { w: first() };
          fc.modelRun(() => ({ model: { live: [t1], next: 2 }, real }), cmds);
          const layout = encode(real.w).layout;
          fc.pre(shortest(layout, width, height, gap) > 1);
          const at = Layout.rects(real.w.layout, { width, height }, { gap }) as ReadonlyMap<string, Box>;
          nested += typeof layout !== "string" && Arr.some(layout.parts, (p) => typeof p.inner !== "string") ? 1 : 0;
          expect([...at.keys()].sort(), "every tile has its rectangle").toEqual([...order(layout)].sort());
          expect(gapBreaks(layout, at, { x: 0, y: 0, width, height }, gap), `gap ${gap} in ${width}x${height}`).toEqual(
            [],
          );
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
    expect(nested, "the walks reach nested containers").toBeGreaterThan(0);
  });
});

// Desk S3, next/: law L26's layout half, `Layout.neighbor(layout, from, to)`. Written before it
// exists. The shape it holds the build to, from the plan's "The shape" (the build may add more):
// - `neighbor(layout, from, "left" | "right" | "up" | "down")` answers the tile on that side of
//   `from` with the most overlap along that side, or null when `from` sits on the workspace's edge
//   there, or is not in the layout. It is pure geometry of the percents: a tile on that side touches
//   `from`'s edge, and its overlap is how much of that edge they share. A tie for the most overlap
//   goes to the tile first in reading order (plan amendment 9, point 4).
// The walk is L5's own fc.commands of splits and closes, so the layouts are every tidy tree a desk
// reaches, nested and uneven. The law's oracle reads each tile's box in the unit square from the
// percents, written here and never from the product's `rects`.
type Side = "left" | "right" | "up" | "down";
const SIDES: ReadonlyArray<Side> = ["left", "right", "up", "down"];

/** Each tile's box in the unit square, from the percents alone. */
const unit = (node: Node, box: Box = { x: 0, y: 0, width: 1, height: 1 }, out = new Map<string, Box>()) => {
  if (typeof node === "string") {
    out.set(node, box);
    return out;
  }

  let at = 0;

  for (const p of node.parts) {
    const share = p.percent / 100;
    unit(
      p.inner,
      node.dir === "row"
        ? { x: box.x + box.width * at, y: box.y, width: box.width * share, height: box.height }
        : { x: box.x, y: box.y + box.height * at, width: box.width, height: box.height * share },
      out,
    );
    at += share;
  }

  return out;
};

const EPS = 1e-9;

/** How much of `from`'s `side` edge `other` shares, or 0 when it does not touch that edge. */
const overlap = (from: Box, other: Box, side: Side): number => {
  const touches =
    side === "left"
      ? Math.abs(other.x + other.width - from.x) < EPS
      : side === "right"
        ? Math.abs(from.x + from.width - other.x) < EPS
        : side === "up"
          ? Math.abs(other.y + other.height - from.y) < EPS
          : Math.abs(from.y + from.height - other.y) < EPS;
  const across =
    side === "left" || side === "right"
      ? Math.min(from.y + from.height, other.y + other.height) - Math.max(from.y, other.y)
      : Math.min(from.x + from.width, other.x + other.width) - Math.max(from.x, other.x);
  return touches && across > EPS ? across : 0;
};

describe("Desk S3 L26: neighbor picks the tile with the most overlap on that side", () => {
  it("L26: on any walked layout, neighbor answers a tile touching that side with the most overlap, the first in reading order on a tie, and null only when no tile touches it", () => {
    const seen = { found: 0, edge: 0, uneven: 0, tie: 0 };
    fc.assert(
      fc.property(commands, fc.nat(), (cmds, pick) => {
        const t1 = typeId("tile", 1);
        const real = { w: first() };
        fc.modelRun(() => ({ model: { live: [t1], next: 2 }, real }), cmds);
        const layout = encode(real.w).layout;
        const boxes = unit(layout);

        for (const from of order(layout)) {
          const box = boxes.get(from)!;

          for (const side of SIDES) {
            const shares = Arr.filter(
              Arr.map(
                Arr.filter(order(layout), (t) => t !== from),
                (t) => ({ t, share: overlap(box, boxes.get(t)!, side) }),
              ),
              (x) => x.share > 0,
            );
            const most = Math.max(0, ...Arr.map(shares, (x) => x.share));
            const got = Layout.neighbor(real.w.layout, tileId(from), side);

            if (shares.length === 0) {
              seen.edge++;
              expect(got, `L26: ${from} is on the ${side} edge of ${JSON.stringify(layout)}`).toBeNull();
              continue;
            }

            seen.found++;
            seen.uneven += new Set(Arr.map(shares, (x) => x.share.toFixed(9))).size > 1 ? 1 : 0;
            const picked = Option.getOrUndefined(Arr.findFirst(shares, (x) => x.t === got));
            expect(
              picked,
              `L26: ${side} of ${from} is a tile touching that side in ${JSON.stringify(layout)}`,
            ).toBeDefined();
            expect(
              picked!.share,
              `L26: ${side} of ${from} has the most overlap of ${JSON.stringify(shares)} in ${JSON.stringify(layout)}`,
            ).toBeGreaterThan(most - 1e-6);
            // The tie rule: of the tiles sharing the most overlap, the first in reading order.
            const tied = Arr.filter(shares, (x) => x.share > most - 1e-6);
            seen.tie += tied.length > 1 ? 1 : 0;
            expect(
              got,
              `L26: a tie on the ${side} of ${from} among ${JSON.stringify(tied)} goes to the first in reading order`,
            ).toBe(tied[0]!.t);
          }
        }

        // A tile the layout does not hold has no neighbor.
        const ghost = tileId(typeId("tile", 70_000 + (pick % 1_000)));
        expect(Layout.neighbor(real.w.layout, ghost, SIDES[pick % 4]!), "L26: a tile not in the layout").toBeNull();
      }),
      { seed: SEED, numRuns: 300 },
    );
    expect(seen.found, "L26: the walks find neighbors").toBeGreaterThan(0);
    expect(seen.edge, "L26: the walks reach the workspace's edges").toBeGreaterThan(0);
    expect(seen.uneven, "L26: the walks reach a side shared unevenly by two or more tiles").toBeGreaterThan(0);
    expect(seen.tie, "L26: the walks reach a tie for the most overlap").toBeGreaterThan(0);
  });
});
