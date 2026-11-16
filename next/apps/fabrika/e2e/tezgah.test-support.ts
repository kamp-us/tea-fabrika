// Desk S2b, next/ (the desk program fabrika/tezgah, ticket named by its title): what the tezgah frame's
// end-to-end law reads, on top of `p14.test-support.ts`'s scoped resources. tezgah's own view, read
// from the real brain by a granted reader as any client reads it; the tab's drawn workspace, read by
// role and accessible name as a person or a screen reader meets it; the keys a person presses; and
// the shots, taken only when `SHOTS` names a folder, never into the repo (0160).
import { join } from "node:path";
import * as Layout from "@kampus/libfabrika/tezgah/Layout";
import {
  type TezgahView,
  type Tile,
  type TileId,
  TezgahView as View,
  tezgahName,
} from "@kampus/libfabrika/tezgah/Workspace";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { String as Str, pipe, Array as Arr, Record as Rec } from "effect";
import type { Page } from "playwright";
import { expect } from "vitest";
import { PERSON, type reader } from "./p14.test-support.ts";

type Reader = Effect.Success<ReturnType<typeof reader>>;

/** The workspace the tab shows: the browser entry starts its window on workspace 1. */
export const WORKSPACE = 1;

/** How far a drawn tile's edge may sit from where the drawn rule puts it, in CSS pixels: the
 *  browser's rounding of flex shares to layout units, never a divider or a padding. */
const EDGE = 1;

/** The frame's padding inside the main and the gap between two parts: 0492's 4px divider, one
 *  number for both (plan amendment 7). */
const GAP = 4;

/** A rectangle in CSS pixels. */
type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** Where each tile is drawn inside `area` by the plan's seventh amendment, written here from the rule
 *  and never from the product's `rects`: a container leaves `parts - 1` gaps between its parts, and
 *  each part takes its percent of what is left. */
const drawnRule = (layout: TezgahView["workspaces"][number]["layout"], area: Box): ReadonlyMap<string, Box> => {
  const out = new Map<string, Box>();

  const walk = (node: typeof layout, box: Box): void => {
    if (typeof node === "string") {
      out.set(node, box);

      return;
    }

    const row = node.dir === "row";
    const left = (row ? box.width : box.height) - (node.parts.length - 1) * GAP;
    let at = row ? box.x : box.y;

    for (const p of node.parts) {
      const share = (left * p.percent) / 100;
      walk(
        p.inner,
        row
          ? { x: at, y: box.y, width: share, height: box.height }
          : { x: box.x, y: at, width: box.width, height: share },
      );
      at += share + GAP;
    }
  };

  walk(layout, area);

  return out;
};

const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** A canonical TypeID with prefix `prefix` and a body from `n`, for a tile id the test mints itself. */
export const typeId = (prefix: string, n: number): string => {
  let uuid = (BigInt(n) << 80n) | (7n << 76n) | (2n << 62n);
  let suffix = "";

  for (let i = 0; i < 26; i++) {
    suffix = ID_ALPHABET[Number(uuid & 31n)] + suffix;
    uuid >>= 5n;
  }

  return `${prefix}_${suffix}`;
};

/** format: a tile's accessible name, `tileName`'s words (0503, the plan): the program's own name after
 *  its pack, then `t<n>`, as `checklist, t1`. Tuval's L20 pins `tileName` to the same words. */
export const regionName = (tile: Pick<Tile, "program" | "n">): string =>
  `${Arr.lastNonEmpty(Str.split(tile.program, "/"))}, t${tile.n}`;

const Started = Schema.TaggedStruct("started", { body: Schema.Struct({ process: Schema.String }) });

const Opened = Schema.Struct({ result: Schema.Struct({ rev: Schema.Int, view: View }) });

/** tezgah's process id for the founder, from `processes/tezgah:<person>`, as the window finds it. */
export const tezgahPid = (r: Reader) =>
  Effect.gen(function* () {
    const entries = yield* r.read(`processes/${tezgahName(PERSON)}`);
    const started = Arr.flatMap(entries, (e) => {
      const decoded = Schema.decodeUnknownOption(Started)(e);

      return decoded._tag === "Some" ? [decoded.value.body.process] : [];
    });

    const pid = started.at(-1);

    if (pid === undefined) {
      return yield* Effect.die(new Error("the brain did not start the founder's tezgah"));
    }

    return pid;
  });

/** tezgah's view now, as the brain sends it to any client that opens it. */
export const tezgahView = (r: Reader, pid: string): Effect.Effect<TezgahView> =>
  Effect.flatMap(r.call("view.open", { pid }), (frame) => Schema.decodeUnknownEffect(Opened)(frame)).pipe(
    Effect.map((o) => o.result.view),
    Effect.orDie,
  );

/** Sends tezgah one letter as a client does, through the door: for a layout no key reaches yet (focus
 *  moves are the next slice), never for what a law presses. */
export const tell = (r: Reader, pid: string, m: unknown, letter: string) =>
  Effect.flatMap(r.call("process.send", { pid, letter, m, sentAt: new Date().toISOString(), seen: 0 }), (frame) =>
    frame.error === undefined ? Effect.void : Effect.die(new Error(`the door refused ${JSON.stringify(frame.error)}`)),
  );

/** What the tab draws: how many mains, each region in document order with its name and box, the
 *  main's box, the names of every element marked `aria-current`, and the polite region's words. */
export type Drawn = {
  readonly mains: number;
  readonly regions: ReadonlyArray<{ readonly name: string; readonly box: Box | null }>;
  readonly main: Box | null;
  readonly current: ReadonlyArray<string>;
  readonly polite: string;
  readonly status: string;
};

/** format: Playwright's ARIA snapshot line for a region, `- region "<name>"`. */
const REGION = /^\s*- region "((?:[^"\\]|\\.)*)"/;

// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright's queries are Promises
const promised = <A>(f: () => Promise<A>) => Effect.promise(f);

/** Reads what the tab draws now, by role and accessible name. */
export const drawn = (page: Page): Effect.Effect<Drawn> =>
  Effect.gen(function* () {
    const mains = yield* promised(() => page.getByRole("main").count());
    const main = page.getByRole("main").first();
    const snapshot = mains === 0 ? "" : yield* promised(() => main.ariaSnapshot());
    const names = Arr.flatMap(Str.split(snapshot, "\n"), (line) => {
      const m = REGION.exec(line);
      return m?.[1] === undefined ? [] : [pipe(m[1], Str.replace(/\\(.)/g, "$1"))];
    });

    const regions = yield* Effect.forEach(
      names,
      (name) =>
        promised(() => page.getByRole("region", { name, exact: true }).first().boundingBox()).pipe(
          Effect.map((box) => ({ name, box })),
        ),
      { concurrency: 1 },
    );

    const mainBox = mains === 0 ? null : yield* promised(() => main.boundingBox());

    const facts = yield* promised(() =>
      page.evaluate(() => {
        const label = (el: Element) =>
          el.getAttribute("aria-labelledby") !== null
            ? (el.getAttribute("aria-labelledby") ?? "")
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
                .join(" ")
            : (el.getAttribute("aria-label") ?? "");

        return {
          current: [...document.querySelectorAll("[aria-current]")]
            .filter((el) => el.getAttribute("aria-current") !== "false")
            .map(label),
          polite: [...document.querySelectorAll('[aria-live="polite"]')]
            .map((el) => el.textContent ?? "")
            .join(" ")
            .trim(),
          status: [...document.querySelectorAll('[role="status"]')]
            .map((el) => el.textContent ?? "")
            .join(" ")
            .trim(),
        };
      }),
    );

    return { mains, regions, main: mainBox, ...facts };
  });

/** Every way the tab's drawing differs from workspace 1 of tezgah's `view`: the regions in reading
 *  order, each named by `tileName`'s words, `aria-current` on the focused tile alone, and each tile
 *  where tezgah's percents put it in the main. Empty when they agree. */
export const differences = (view: TezgahView, d: Drawn): ReadonlyArray<string> => {
  const space = Option.getOrUndefined(Arr.findFirst(view.workspaces, (w) => w.n === WORKSPACE));

  if (space === undefined) {
    return ["tezgah has no workspace 1"];
  }

  const byId = new Map(Arr.map(view.tiles, (t) => [t.id, t]));
  const named = (id: TileId) => {
    const tile = byId.get(id);

    return tile === undefined ? `a tile tezgah does not list (${id})` : regionName(tile);
  };
  const want = Arr.map(Layout.order(space.layout), named);
  const out: Array<string> = [];

  if (d.mains !== 1) {
    out.push(`${d.mains} mains`);
  }

  if (JSON.stringify(Arr.map(d.regions, (r) => r.name)) !== JSON.stringify(want)) {
    out.push(`regions ${JSON.stringify(Arr.map(d.regions, (r) => r.name))}, tezgah ${JSON.stringify(want)}`);
  }

  const focused = named(space.focus);

  if (JSON.stringify(d.current) !== JSON.stringify([focused])) {
    out.push(`aria-current on ${JSON.stringify(d.current)}, tezgah's focus ${focused}`);
  }

  if (d.main !== null && out.length === 0) {
    // The parts are laid out inside the main's padding.
    const rects = drawnRule(space.layout, {
      x: d.main.x + GAP,
      y: d.main.y + GAP,
      width: d.main.width - 2 * GAP,
      height: d.main.height - 2 * GAP,
    });

    for (const id of Layout.order(space.layout)) {
      const name = named(id);
      const box = Option.getOrUndefined(Arr.findFirst(d.regions, (r) => r.name === name))?.box ?? null;
      const r = rects.get(id);

      if (box === null || r === undefined) {
        out.push(`${name} is not drawn`);
        continue;
      }

      const off = [
        box.x - r.x,
        box.y - r.y,
        box.x + box.width - (r.x + r.width),
        box.y + box.height - (r.y + r.height),
      ];

      if (Arr.some(off, (o) => Math.abs(o) > EDGE)) {
        out.push(`${name} drawn at ${JSON.stringify(box)}, tezgah's ${JSON.stringify(r)} in ${JSON.stringify(d.main)}`);
      }
    }
  }

  return out;
};

/** Polls until `check` holds of the tab and tezgah's view, or fails with the last of both after 30 s. */
export const settle = (
  page: Page,
  r: Reader,
  pid: string,
  check: (view: TezgahView, d: Drawn) => ReadonlyArray<string>,
  label: string,
) =>
  Effect.gen(function* () {
    for (let tries = 0; ; tries++) {
      const view = yield* tezgahView(r, pid);
      const wrong = check(view, yield* drawn(page));

      if (wrong.length === 0 || tries >= 120) {
        expect(wrong, `${label}: ${JSON.stringify(view)}`).toEqual([]);

        return view;
      }

      yield* Effect.sleep("250 millis");
    }
  });

/** The tiles of workspace 1 in reading order. */
export const shown = (view: TezgahView): ReadonlyArray<Tile> => {
  const space = Option.getOrUndefined(Arr.findFirst(view.workspaces, (w) => w.n === WORKSPACE));
  return space === undefined
    ? []
    : Arr.flatMap(Layout.order(space.layout), (id) => Arr.filter(view.tiles, (t) => t.id === id));
};

/** The focused tile of workspace 1. */
export const focused = (view: TezgahView): Tile => {
  const space = Option.getOrUndefined(Arr.findFirst(view.workspaces, (w) => w.n === WORKSPACE));
  const tile = Option.getOrUndefined(Arr.findFirst(view.tiles, (t) => t.id === space?.focus));
  expect(tile, "tezgah's workspace 1 has a focused tile").toBeDefined();

  return tile as Tile;
};

/** Presses keys in order, as a person types them: `Control+b`, then `%`. */
export const keys = (page: Page, ...pressed: ReadonlyArray<string>) =>
  Effect.forEach(pressed, (key) => promised(() => page.keyboard.press(key)), { concurrency: 1, discard: true });

/** The five layouts a window is shot at (AGENTS.md, "Shoot more than one layout"), and the narrow
 *  420x700 window the fold law draws a band in. */
export type Shot = "one-tile" | "side-by-side" | "stacked" | "grid-2x2" | "small-1024x700" | "narrow-420x700";

/** A shot of the tab as it is now, named by state and layout, into the folder `SHOTS` names; nothing
 *  when `SHOTS` is unset, so a plain run writes no file. */
export const shoot = (page: Page, state: string, layout: Shot) => {
  const folder = process.env.SHOTS;

  return folder === undefined || folder === ""
    ? Effect.void
    : promised(() => page.screenshot({ path: join(folder, `tezgah-${state}-${layout}.png`), fullPage: false }));
};

// Desk S3, next/: what the focus law reads on top of the frame's helpers.

/** A registered process's id, from `processes/<name>`, as a window finds it. */
export const processId = (r: Reader, name: string) =>
  Effect.gen(function* () {
    const entries = yield* r.read(`processes/${name}`);
    const started = Arr.flatMap(entries, (e) => {
      const decoded = Schema.decodeUnknownOption(Started)(e);

      return decoded._tag === "Some" ? [decoded.value.body.process] : [];
    });

    const pid = started.at(-1);

    return pid === undefined ? yield* Effect.die(new Error(`the brain did not start ${name}`)) : pid;
  });

/** Where DOM focus is in a tab: the name of the tile region holding it (null outside every tile),
 *  the `data-cursor` key of the nearest element around it that carries one (0165), and the first
 *  `data-cursor` key in that region, the top of the tile. */
export type DomFocus = {
  readonly region: string | null;
  readonly cursor: string | null;
  readonly first: string | null;
};

export const domFocus = (page: Page): Effect.Effect<DomFocus> =>
  promised(() =>
    page.evaluate(() => {
      const active = document.activeElement;
      const region = active?.closest("section[aria-label]") ?? null;

      return {
        region: region?.getAttribute("aria-label") ?? null,
        cursor: active?.closest("[data-cursor]")?.getAttribute("data-cursor") ?? null,
        first: region?.querySelector("[data-cursor]")?.getAttribute("data-cursor") ?? null,
      };
    }),
  );

/** Polls until `check` holds of where DOM focus is, or fails with the last reading after 30 s. */
export const domSettles = (page: Page, check: (f: DomFocus) => boolean, label: string) =>
  Effect.gen(function* () {
    for (let tries = 0; ; tries++) {
      const f = yield* domFocus(page);

      if (check(f) || tries >= 120) {
        expect(check(f), `${label}: DOM focus is ${JSON.stringify(f)}`).toBe(true);

        return f;
      }

      yield* Effect.sleep("250 millis");
    }
  });

// Desk S4, next/: what the fold law reads on top of the frame's helpers.

/** The readability floor from fold, not tabs: a tile drawn under it in a window is a strip there. */
const SMALLEST = { width: 220, height: 120 } as const;

/** format: a strip's accessible name, `open ` and then `tileName`'s words (the plan's L31). */
export const stripName = (tile: Pick<Tile, "program" | "n">): string => `open ${regionName(tile)}`;

/** format: Playwright's ARIA snapshot line for a strip, `- button "open <name>"`. */
const STRIP = /^\s*- button "(open (?:[^"\\]|\\.)*)"/;

/** What the tab draws, with each strip in document order: its name and box. */
export type FoldDrawn = Drawn & { readonly strips: ReadonlyArray<{ readonly name: string; readonly box: Box | null }> };

/** Reads what the tab draws now, strips included, by role and accessible name. */
export const foldDrawn = (page: Page): Effect.Effect<FoldDrawn> =>
  Effect.gen(function* () {
    const d = yield* drawn(page);
    const main = page.getByRole("main").first();
    const snapshot = d.mains === 0 ? "" : yield* promised(() => main.ariaSnapshot());
    const names = Arr.flatMap(Str.split(snapshot, "\n"), (line) => {
      const m = STRIP.exec(line);
      return m?.[1] === undefined ? [] : [pipe(m[1], Str.replace(/\\(.)/g, "$1"))];
    });

    const strips = yield* Effect.forEach(
      names,
      (name) =>
        promised(() => main.getByRole("button", { name, exact: true }).first().boundingBox()).pipe(
          Effect.map((box) => ({ name, box })),
        ),
      { concurrency: 1 },
    );

    return { ...d, strips };
  });

/** A strip's size along its container (plan amendment 13, after the fold-not-tabs note): 22px wide in
 *  a row, 20px tall in a column. */
const STRIP_ACROSS = { row: 22, column: 20 } as const;

type Space = TezgahView["workspaces"][number];

const tilesIn = (node: Space["layout"]): ReadonlyArray<string> =>
  typeof node === "string" ? [node] : Arr.flatMap(node.parts, (p) => tilesIn(p.inner));

/** What amendment 13's rule draws in `area` when `strips` are strips: each tile's box outside a band,
 *  and each band (a container whose tiles all fold) with its tiles. Written here from the
 *  amendment's words, never from the product's `drawn`: a container leaves `GAP` between each two
 *  parts; a part all of whose tiles are strips takes `STRIP_ACROSS[dir]`; the open parts share what is
 *  left by percent; and the part on the focused tile's path is held at `min(220 in a row or 120 in a
 *  column, what the container has)`, the other open parts sharing the rest by percent. */
const foldRule = (space: Space, area: Box, strips: ReadonlySet<string>) => {
  const boxes = new Map<string, Box>();
  const bands: Array<{ readonly box: Box; readonly tiles: ReadonlyArray<string> }> = [];

  const walk = (node: Space["layout"], box: Box): void => {
    if (typeof node === "string") {
      boxes.set(node, box);

      return;
    }

    const row = node.dir === "row";
    const left = (row ? box.width : box.height) - (node.parts.length - 1) * GAP;
    const fixed = Arr.map(node.parts, (p) => Arr.every(tilesIn(p.inner), (t) => strips.has(t)));
    const has = left - Arr.filter(fixed, (f) => f).length * STRIP_ACROSS[node.dir];
    const total = Arr.reduce(node.parts, 0, (sum, p, i) => (fixed[i] ? sum : sum + p.percent));
    const lead = Arr.findFirstIndex(node.parts, (p) => tilesIn(p.inner).includes(space.focus));
    let shares = Arr.map(node.parts, (p, i) => (fixed[i] ? STRIP_ACROSS[node.dir] : (has * p.percent) / total));
    const least = Math.min(row ? SMALLEST.width : SMALLEST.height, has);

    if (Option.isSome(lead) && (shares[lead.value] ?? 0) < least) {
      const rest = total - (node.parts[lead.value]?.percent ?? 0);
      shares = Arr.map(node.parts, (p, i) =>
        i === lead.value
          ? least
          : fixed[i]
            ? STRIP_ACROSS[node.dir]
            : rest > 0
              ? ((has - least) * p.percent) / rest
              : 0,
      );
    }

    let at = row ? box.x : box.y;

    for (const [i, p] of node.parts.entries()) {
      const b = row
        ? { x: at, y: box.y, width: shares[i] ?? 0, height: box.height }
        : { x: box.x, y: at, width: box.width, height: shares[i] ?? 0 };

      if (fixed[i] && typeof p.inner !== "string") {
        bands.push({ box: b, tiles: tilesIn(p.inner) });
      } else {
        walk(p.inner, b);
      }

      at += (shares[i] ?? 0) + GAP;
    }
  };

  walk(space.layout, area);

  return { boxes, bands };
};

/** The main's area the parts are laid out in, inside its padding. */
const padded = (main: Box): Box => ({
  x: main.x + GAP,
  y: main.y + GAP,
  width: main.width - 2 * GAP,
  height: main.height - 2 * GAP,
});

/** The tiles of workspace 1 this tab must draw as strips, in reading order: amendment 13's fixpoint,
 *  written here from its words. From no strips, every open tile but the focused one that the rule
 *  draws under 220x120 in the tab's own main folds, again, until nothing changes. Never read from the
 *  product's `fold`. */
export const stripsHere = (view: TezgahView, main: Box): ReadonlyArray<Tile> => {
  const space = Option.getOrUndefined(Arr.findFirst(view.workspaces, (w) => w.n === WORKSPACE));

  if (space === undefined) {
    return [];
  }

  let strips = new Set<string>();

  for (;;) {
    const { boxes } = foldRule(space, padded(main), strips);
    const due = Arr.filter(
      [...boxes],
      ([t, r]) => !strips.has(t) && t !== space.focus && (r.width < SMALLEST.width || r.height < SMALLEST.height),
    );

    if (due.length === 0) {
      return Arr.filter(shown(view), (t) => strips.has(t.id));
    }

    strips = new Set([...strips, ...Arr.map(due, ([t]) => t)]);
  }
};

const off = (a: Box, b: Box) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width), Math.abs(a.height - b.height));

/** Every way the tab's drawing differs from workspace 1 of tezgah's `view` folded at the tab's own
 *  size by amendment 13: the regions are the open tiles in reading order, each strip is a button named
 *  `open <program>, t<n>` in reading order, the focused tile is never a strip and alone has
 *  `aria-current`, every open tile but the focused one is drawn at least 220x120, every region and
 *  every strip outside a band is drawn where the rule puts it, within 1px, and the strips of a band lie
 *  inside it, apart. Empty when they agree. */
export const foldDifferences = (view: TezgahView, d: FoldDrawn): ReadonlyArray<string> => {
  const space = Option.getOrUndefined(Arr.findFirst(view.workspaces, (w) => w.n === WORKSPACE));

  if (space === undefined || d.main === null) {
    return [space === undefined ? "tezgah has no workspace 1" : "no main is drawn"];
  }

  const strips = stripsHere(view, d.main);
  const open = Arr.filter(shown(view), (t) => !strips.includes(t));
  const focus = Option.getOrUndefined(Arr.findFirst(view.tiles, (t) => t.id === space.focus));
  const out: Array<string> = [];

  if (d.mains !== 1) {
    out.push(`${d.mains} mains`);
  }

  const regions = Arr.map(d.regions, (r) => r.name);
  const want = Arr.map(open, regionName);

  if (JSON.stringify(regions) !== JSON.stringify(want)) {
    out.push(`regions ${JSON.stringify(regions)}, open tiles ${JSON.stringify(want)}`);
  }

  const drawnStrips = Arr.map(d.strips, (s) => s.name);
  const wantStrips = Arr.map(strips, stripName);

  if (JSON.stringify(drawnStrips) !== JSON.stringify(wantStrips)) {
    out.push(`strips ${JSON.stringify(drawnStrips)}, the fold's strips here ${JSON.stringify(wantStrips)}`);
  }

  if (focus !== undefined && drawnStrips.includes(stripName(focus))) {
    out.push(`the focused tile ${regionName(focus)} is a strip`);
  }

  if (JSON.stringify(d.current) !== JSON.stringify(focus === undefined ? [] : [regionName(focus)])) {
    out.push(`aria-current on ${JSON.stringify(d.current)}, tezgah's focus ${focus?.n}`);
  }

  for (const r of Arr.filter(d.regions, (x) => focus === undefined || x.name !== regionName(focus))) {
    if (r.box === null || r.box.width < SMALLEST.width - EDGE || r.box.height < SMALLEST.height - EDGE) {
      out.push(`open ${r.name} is drawn at ${JSON.stringify(r.box)}, under 220x120`);
    }
  }

  if (out.length > 0) {
    return out;
  }

  const rule = foldRule(space, padded(d.main), new Set(Arr.map(strips, (t) => t.id)));
  const banded = new Set(Arr.flatMap(rule.bands, (b) => b.tiles));
  const boxFor = (t: Tile) =>
    (strips.includes(t)
      ? Option.getOrUndefined(Arr.findFirst(d.strips, (s) => s.name === stripName(t)))
      : Option.getOrUndefined(Arr.findFirst(d.regions, (r) => r.name === regionName(t)))
    )?.box ?? null;

  for (const t of Arr.filter(shown(view), (t) => !banded.has(t.id))) {
    const box = boxFor(t);
    const r = rule.boxes.get(t.id);

    if (box === null || r === undefined || off(box, r) > EDGE) {
      out.push(
        `${strips.includes(t) ? stripName(t) : regionName(t)} drawn at ${JSON.stringify(box)}, the rule's ${JSON.stringify(r)}`,
      );
    }
  }

  for (const band of rule.bands) {
    const inBand = Arr.filter(shown(view), (t) => band.tiles.includes(t.id));
    const boxes = Arr.map(inBand, boxFor);

    for (const [i, b] of boxes.entries()) {
      const tile = inBand[i];
      const name = tile === undefined ? "a strip" : stripName(tile);

      if (
        b === null ||
        b.x < band.box.x - EDGE ||
        b.y < band.box.y - EDGE ||
        b.x + b.width > band.box.x + band.box.width + EDGE ||
        b.y + b.height > band.box.y + band.box.height + EDGE
      ) {
        out.push(`${name} drawn at ${JSON.stringify(b)}, outside its band ${JSON.stringify(band.box)}`);
      }

      for (const c of boxes.slice(i + 1)) {
        if (
          b !== null &&
          c !== null &&
          Math.min(b.x + b.width, c.x + c.width) - Math.max(b.x, c.x) > EDGE &&
          Math.min(b.y + b.height, c.y + c.height) - Math.max(b.y, c.y) > EDGE
        ) {
          out.push(`${name} overlaps another strip of its band`);
        }
      }
    }
  }

  return out;
};

/** Whether each named element's text is drawn whole in tab `on`: no element in it cut by its own box
 *  (its scroll size within its client size, either way it is written), as a person reads it. */
export const whole = (on: Page, selector: string) =>
  promised(() =>
    on.evaluate((css) => {
      const found = [...document.querySelectorAll(css)];

      return {
        found: found.length,
        cut: found
          .flatMap((el) => [el, ...el.querySelectorAll("*")])
          .filter(
            (el) =>
              el instanceof HTMLElement &&
              (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1),
          )
          .map((el) => el.textContent ?? ""),
      };
    }, selector),
  );

/** The status bar as a person reads it: its words, its height, its two ends (the mode word and the way
 *  out) each with whether it is drawn whole inside the bar and the window, how far the way out's right
 *  edge sits from the bar's right inner edge beside the bar's right padding (modes M3: the way out at
 *  the right), the box of each tile and strip on the desk, and the name of each tile or strip the bar
 *  is drawn over. */
export const statusBar = (on: Page) =>
  promised(() =>
    on.evaluate(() => {
      const bar = document.querySelector(".statusbar");
      const tiles = Rec.fromEntries(
        [...document.querySelectorAll("main [data-tile], main [data-strip]")].map((el) => {
          const box = el.getBoundingClientRect();
          const id = el.getAttribute("data-tile") ?? `strip ${el.getAttribute("data-strip")}`;

          return [id, `${box.left},${box.top} ${box.width}x${box.height}`];
        }),
      );

      if (!(bar instanceof HTMLElement)) {
        return { text: "", height: 0, ends: [], right: null, tiles, over: ["no status bar"] };
      }

      const edge = bar.getBoundingClientRect();

      const within = (el: Element) => {
        const r = el.getBoundingClientRect();

        return (
          r.left >= edge.left - 0.5 &&
          r.right <= edge.right + 0.5 &&
          r.top >= edge.top - 0.5 &&
          r.bottom <= edge.bottom + 0.5 &&
          r.right <= window.innerWidth + 0.5
        );
      };

      const uncut = (el: Element) => el instanceof HTMLElement && el.scrollWidth <= el.clientWidth + 1;

      const ends = [...bar.querySelectorAll("*")]
        .filter((el) => el.textContent === "prefix" || el.textContent === "Esc cancel")
        .map((el) => ({ text: el.textContent ?? "", whole: within(el) && uncut(el) }));

      const out = [...bar.querySelectorAll("*")].find((el) => el.textContent === "Esc cancel");
      const padding = Number.parseFloat(getComputedStyle(bar).paddingRight);

      return {
        text: bar.textContent ?? "",
        height: edge.height,
        ends,
        right: out === undefined ? null : { gap: edge.right - padding - out.getBoundingClientRect().right, padding },
        tiles,
        over: [...document.querySelectorAll("main section[aria-label], main button[aria-label]")]
          .filter((el) => el.getBoundingClientRect().bottom > edge.top + 0.5)
          .map((el) => el.getAttribute("aria-label") ?? ""),
      };
    }),
  );

/** Polls until `check` holds of the tab, strips included, and tezgah's view, or fails with the last
 *  of both after 30 s. */
export const foldSettle = (
  page: Page,
  r: Reader,
  pid: string,
  check: (view: TezgahView, d: FoldDrawn) => ReadonlyArray<string>,
  label: string,
) =>
  Effect.gen(function* () {
    for (let tries = 0; ; tries++) {
      const view = yield* tezgahView(r, pid);
      const d = yield* foldDrawn(page);
      const wrong = check(view, d);

      if (wrong.length === 0 || tries >= 120) {
        expect(wrong, `${label}: ${JSON.stringify(view)} ${JSON.stringify(d)}`).toEqual([]);

        return { view, d };
      }

      yield* Effect.sleep("250 millis");
    }
  });

/** The element that has DOM focus: its tag, its accessible name, and whether the page draws a focus
 *  ring on it (an outline or a box shadow), as a person sees it. */
export const focusRing = (page: Page) =>
  promised(() =>
    page.evaluate(() => {
      const el = document.activeElement;

      if (el === null) {
        return { tag: "", name: "", ring: false };
      }

      const css = getComputedStyle(el);
      const outline = css.outlineStyle !== "none" && Number.parseFloat(css.outlineWidth) > 0;

      return {
        tag: el.tagName.toLowerCase(),
        name: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "",
        ring: outline || css.boxShadow !== "none",
      };
    }),
  );
