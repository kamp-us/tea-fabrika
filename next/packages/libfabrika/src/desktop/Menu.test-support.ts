import { applyCell, type Machine } from "@demlik/tea";
// next/, P21 slice 1. The factory takes checked settings at start; no provider is read by update.
import { arbGuidedSequence, stubCtxThrowingProxy } from "@demlik/tea/pbt";
import { Equal, Schema } from "effect";
import * as fc from "fast-check";
import * as Access from "../access/Access.ts";
import * as Id from "../Id.ts";
import * as Menu from "./Menu.ts";

export const seed = 119120;
export const ttl = 137;
export const ctx = stubCtxThrowingProxy<unknown>();
export const machine = Menu.machine({ linkTtl: ttl, browserLink: true });
export type Model = ReturnType<typeof machine.init>[0];
export type Msg = typeof machine extends Machine<infer _Model, infer M, infer _Cmd, infer _Sub, infer _Ctx> ? M : never;
export type Command = ReturnType<typeof machine.init>[1][number];
export type Row = typeof Menu.Row.Type;
type Client = typeof Menu.Client.Type;

export const same = (a: unknown, b: unknown) => Equal.equals(a, b);
export const cmdId = (n: number) => Id.Cmd.make(`cmd_0000000000e008${n.toString(16).padStart(12, "0")}`);
export const command = fc.nat({ max: 0xfffffff }).map(cmdId);
const stale = cmdId(0xffffffffff);
const kind = fc.constantFrom(...Access.Grant.fields.as.literals);
const Tabs = Schema.TaggedUnion({ known: { online: Schema.Int }, unknown: {} });
const Link = Schema.TaggedUnion({ connecting: {}, online: {}, lost: {} });

// Machine.make exposes its plain Msg as Schema.Schema, so these test makers keep each case's fields.
export const Messages = Schema.TaggedUnion({
  link: { link: Link },
  rows: { rows: Schema.Array(Menu.Row), at: Schema.Number },
  clients: { clients: Schema.Array(Menu.Client) },
  approve: { key: Schema.String, cmd: Id.Cmd },
  deny: { key: Schema.String, cmd: Id.Cmd },
  remove: { key: Schema.String, cmd: Id.Cmd },
  enter: {},
  checked: { cmd: Id.Cmd, check: Schema.Literals(["touch", "click"]) },
  not_checked: { cmd: Id.Cmd, reason: Schema.Literals(["declined", "unavailable"]) },
  open_browser: { cmd: Id.Cmd },
  opened: { cmd: Id.Cmd, digest: Schema.String, at: Schema.Number },
});

export const label = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,23}$/);
const code = fc.integer({ min: 0, max: 999999 }).map((n) => String(n).padStart(6, "0"));
const digest = fc.constantFrom("digest-a", "digest-b", "digest-c");
// Waiting and admitted snapshots arrive independently, so either can still hold the same key.
const key = fc.constantFrom("waiting-a", "waiting-b", "waiting-c", "client-a", "client-b", "client-c");

export const row: fc.Arbitrary<Row> = fc.record({
  key,
  label,
  location: fc.constantFrom("this Mac", "another Mac"),
  code,
  tabs: fc.integer({ min: 1, max: 20 }),
  pass: fc.option(digest, { nil: null }),
  has: fc.uniqueArray(fc.constantFrom("screen", "files", "terminal"), { maxLength: 3 }),
  as: kind,
});

const client: fc.Arbitrary<Client> = fc.record({
  key,
  label,
  location: fc.constantFrom("this Mac", "another Mac"),
  as: kind,
  tabs: fc.oneof(
    fc.nat({ max: 20 }).map((online) => Tabs.cases.known.make({ online })),
    fc.constant(Tabs.cases.unknown.make({})),
  ),
  own: fc.boolean(),
});

const rows = fc.uniqueArray(row, { selector: (r) => r.key, maxLength: 3 });
const clients = fc.uniqueArray(client, { selector: (c) => c.key, maxLength: 3 });
const at = fc.constantFrom(0, 1, ttl - 1, ttl, ttl + 1, ttl * 2);

const click = (type: "approve" | "deny" | "remove", keys: ReadonlyArray<string>) =>
  fc.record({ key: fc.constantFrom(...keys), cmd: command }).map((fields) => Messages.cases[type].make(fields));

// tea draws the operation order and answers commands actually sent. The second fold below
// chooses click targets from the reached lists, retaining deliberately stale replies.
const proposals = arbGuidedSequence(
  machine,
  ctx,
  {
    outside: {
      rows: fc.record({ rows, at }).map((fields) => Messages.cases.rows.make(fields)),
      clients: fc.record({ clients }).map((fields) => Messages.cases.clients.make(fields)),
      link: fc
        .constantFrom(Link.cases.connecting.make({}), Link.cases.online.make({}), Link.cases.lost.make({}))
        .map((link) => Messages.cases.link.make({ link })),
      approve: click("approve", ["waiting-a", "waiting-b", "waiting-c"]),
      deny: click("deny", ["waiting-a", "waiting-b", "waiting-c"]),
      remove: click("remove", ["client-a", "client-b", "client-c"]),
      enter: fc.constant(Messages.cases.enter.make({})),
      checked: fc.constantFrom("touch", "click").map((check) => Messages.cases.checked.make({ cmd: stale, check })),
      not_checked: fc
        .constantFrom("declined", "unavailable")
        .map((reason) => Messages.cases.not_checked.make({ cmd: stale, reason })),
      open_browser: command.map((cmd) => Messages.cases.open_browser.make({ cmd })),
      opened: digest.map((d) => Messages.cases.opened.make({ cmd: stale, digest: d, at: 0 })),
    },
    answers: {
      check: {
        draw: fc.constantFrom("touch", "click", "declined", "unavailable"),
        make: (pending, answer): Msg =>
          answer === "touch" || answer === "click"
            ? Messages.cases.checked.make({ cmd: pending.cmd, check: answer })
            : Messages.cases.not_checked.make({ cmd: pending.cmd, reason: answer }),
      },
      open: {
        draw: digest,
        make: (pending, digest): Msg => Messages.cases.opened.make({ cmd: pending.cmd, digest, at: 0 }),
      },
    },
  },
  { maxLength: 160, size: "max" },
);

export const walks = proposals.map((messages): ReadonlyArray<Msg> => {
  let [model] = machine.init(null, ctx);
  const output: Array<Msg> = [];

  for (const proposal of messages) {
    let msg = proposal;

    if (proposal._tag === "approve" || proposal._tag === "deny" || proposal._tag === "remove") {
      const targets = proposal._tag === "remove" ? model.clients : model.rows;
      const index = proposal.key.endsWith("a") ? 0 : proposal.key.endsWith("b") ? 1 : 2;
      const target = targets[index % Math.max(1, targets.length)];
      msg = target === undefined ? proposal : { ...proposal, key: target.key };
    }

    if (
      (proposal._tag === "checked" || proposal._tag === "not_checked") &&
      proposal.cmd !== stale &&
      model._tag === "checking"
    ) {
      msg = { ...proposal, cmd: model.cmd };
    }

    output.push(msg);
    [model] = applyCell<Model, Msg, Command>(machine, model, msg);
  }

  return output;
});

export const modelJson = Schema.fromJsonString(Schema.toType(machine.model));
export const encoded = (model: Model) => Schema.encodeSync(modelJson)(model);
