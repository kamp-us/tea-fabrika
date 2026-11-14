// Desk S2b, next/ (the desk program fabrika/tezgah, ticket named by its title): what the tezgah frame's
// end-to-end law reads, on top of `p14.test-support.ts`'s scoped resources. tezgah's own view, read
// from the real brain by a granted reader as any client reads it; the tab's drawn workspace, read by
// role and accessible name as a person or a screen reader meets it; the keys a person presses; and
// the shots, taken only when `SHOTS` names a folder, never into the repo (0160).
import { join } from "node:path";
import * as Layout from "@kampus/libfabrika/tezgah/Layout";
import { type TezgahView, type Tile, TezgahView as View, tezgahName } from "@kampus/libfabrika/tezgah/Workspace";
import { Effect, Schema } from "effect";
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
  `${tile.program.slice(tile.program.lastIndexOf("/") + 1)}, t${tile.n}`;

const Started = Schema.TaggedStruct("started", { body: Schema.Struct({ process: Schema.String }) });
const Opened = Schema.Struct({ result: Schema.Struct({ rev: Schema.Int, view: View }) });

/** tezgah's process id for the founder, from `processes/tezgah:<person>`, as the window finds it. */
export const tezgahPid = (r: Reader) =>
  Effect.gen(function* () {
    const entries = yield* r.read(`processes/${tezgahName(PERSON)}`);
    const started = entries.flatMap((e) => {
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
    const names = snapshot.split("\n").flatMap((line) => {
      const m = REGION.exec(line);
      return m?.[1] === undefined ? [] : [m[1].replace(/\\(.)/g, "$1")];
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
  const space = view.workspaces.find((w) => w.n === WORKSPACE);

  if (space === undefined) {
    return ["tezgah has no workspace 1"];
  }

  const byId = new Map(view.tiles.map((t) => [t.id, t]));
  const named = (id: string) => {
    const tile = byId.get(id);
    return tile === undefined ? `a tile tezgah does not list (${id})` : regionName(tile);
  };
  const want = Layout.order(space.layout).map(named);
  const out: Array<string> = [];

  if (d.mains !== 1) {
    out.push(`${d.mains} mains`);
  }

  if (JSON.stringify(d.regions.map((r) => r.name)) !== JSON.stringify(want)) {
    out.push(`regions ${JSON.stringify(d.regions.map((r) => r.name))}, tezgah ${JSON.stringify(want)}`);
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
      const box = d.regions.find((r) => r.name === name)?.box ?? null;
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

      if (off.some((o) => Math.abs(o) > EDGE)) {
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
  const space = view.workspaces.find((w) => w.n === WORKSPACE);
  return space === undefined ? [] : Layout.order(space.layout).flatMap((id) => view.tiles.filter((t) => t.id === id));
};

/** The focused tile of workspace 1. */
export const focused = (view: TezgahView): Tile => {
  const space = view.workspaces.find((w) => w.n === WORKSPACE);
  const tile = view.tiles.find((t) => t.id === space?.focus);
  expect(tile, "tezgah's workspace 1 has a focused tile").toBeDefined();
  return tile as Tile;
};

/** Presses keys in order, as a person types them: `Control+b`, then `%`. */
export const keys = (page: Page, ...pressed: ReadonlyArray<string>) =>
  Effect.forEach(pressed, (key) => promised(() => page.keyboard.press(key)), { concurrency: 1, discard: true });

/** The five layouts a window is shot at (AGENTS.md, "Shoot more than one layout"). */
export type Shot = "one-tile" | "side-by-side" | "stacked" | "grid-2x2" | "small-1024x700";

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
    const started = entries.flatMap((e) => {
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
    const names = snapshot.split("\n").flatMap((line) => {
      const m = STRIP.exec(line);
      return m?.[1] === undefined ? [] : [m[1].replace(/\\(.)/g, "$1")];
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

/** The tiles of workspace 1 this tab must draw as strips, by the plan's rule written here from its
 *  words: every tile but the focused one that the frame draws under 220x120 in the tab's own main,
 *  inside its padding (plan amendment 7). Never read from the product's `fold`. */
export const stripsHere = (view: TezgahView, main: Box): ReadonlyArray<Tile> => {
  const space = view.workspaces.find((w) => w.n === WORKSPACE);

  if (space === undefined) {
    return [];
  }

  const rects = drawnRule(space.layout, {
    x: main.x + GAP,
    y: main.y + GAP,
    width: main.width - 2 * GAP,
    height: main.height - 2 * GAP,
  });
  return shown(view).filter((t) => {
    const r = rects.get(t.id);
    return t.id !== space.focus && r !== undefined && (r.width < SMALLEST.width || r.height < SMALLEST.height);
  });
};

/** Every way the tab's drawing differs from workspace 1 of tezgah's `view` folded at the tab's own
 *  size: the regions are the open tiles in reading order, each strip is a button named
 *  `open <program>, t<n>` in reading order, the focused tile is never a strip and alone has
 *  `aria-current`, every open tile but the focused one is drawn at least 220x120, and each strip is
 *  drawn inside the main. Empty when they agree. */
export const foldDifferences = (view: TezgahView, d: FoldDrawn): ReadonlyArray<string> => {
  const space = view.workspaces.find((w) => w.n === WORKSPACE);

  if (space === undefined || d.main === null) {
    return [space === undefined ? "tezgah has no workspace 1" : "no main is drawn"];
  }

  const strips = stripsHere(view, d.main);
  const open = shown(view).filter((t) => !strips.includes(t));
  const focus = view.tiles.find((t) => t.id === space.focus);
  const out: Array<string> = [];

  if (d.mains !== 1) {
    out.push(`${d.mains} mains`);
  }

  const regions = d.regions.map((r) => r.name);
  const want = open.map(regionName);

  if (JSON.stringify(regions) !== JSON.stringify(want)) {
    out.push(`regions ${JSON.stringify(regions)}, open tiles ${JSON.stringify(want)}`);
  }

  const drawnStrips = d.strips.map((s) => s.name);
  const wantStrips = strips.map(stripName);

  if (JSON.stringify(drawnStrips) !== JSON.stringify(wantStrips)) {
    out.push(`strips ${JSON.stringify(drawnStrips)}, tiles under 220x120 here ${JSON.stringify(wantStrips)}`);
  }

  if (focus !== undefined && drawnStrips.includes(stripName(focus))) {
    out.push(`the focused tile ${regionName(focus)} is a strip`);
  }

  if (JSON.stringify(d.current) !== JSON.stringify(focus === undefined ? [] : [regionName(focus)])) {
    out.push(`aria-current on ${JSON.stringify(d.current)}, tezgah's focus ${focus?.n}`);
  }

  for (const r of d.regions.filter((x) => focus === undefined || x.name !== regionName(focus))) {
    if (r.box === null || r.box.width < SMALLEST.width - EDGE || r.box.height < SMALLEST.height - EDGE) {
      out.push(`open ${r.name} is drawn at ${JSON.stringify(r.box)}, under 220x120`);
    }
  }

  for (const s of d.strips) {
    const b = s.box;
    const m = d.main;

    if (
      b === null ||
      b.x < m.x - EDGE ||
      b.y < m.y - EDGE ||
      b.x + b.width > m.x + m.width + EDGE ||
      b.y + b.height > m.y + m.height + EDGE
    ) {
      out.push(`${s.name} is drawn at ${JSON.stringify(b)}, outside the main ${JSON.stringify(m)}`);
    }
  }

  return out;
};

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
