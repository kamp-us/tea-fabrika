// Step.ts: one step of a flow, as data (0064). Today's lead tooling, read through its module:
// `Step.act("format", { dir })`. A step's kind is one of the six pipeline primitives
// (packages/pipeline/src/primitives.ts names them):
//
//   gather  code reads           act    code writes        listen  code waits on an outside event
//   draft   an agent's one turn  check  code judges        judge   a small classifier, one question
//
// A step holds no function: its `name` picks the runner a `Runners` layer gives for it, and its
// `args` are plain JSON the runner reads with its own schema. So a whole flow is saved to its state
// file before it starts. `lead` marks a step the runner may only do in the lead session's name (a
// lead sign, the merge queue); started without `--lead`, the flow parks there with `ask`.

import { Schema } from "effect";
import * as Function from "effect/Function";

const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/));

const fields = { name: Name, args: Schema.JsonObject, lead: Schema.Boolean };

export const Step = Schema.TaggedUnion({
  gather: fields,
  act: fields,
  listen: fields,
  draft: fields,
  check: fields,
  judge: fields,
});
export type Step = typeof Step.Type;
export type Kind = Step["_tag"];

/** Options a step may take: `lead` for a step only the lead session may run. */
export type Options = { readonly lead?: boolean };

const stepFields = (name: string, args: Schema.JsonObject, options: Options) => ({
  name,
  args,
  lead: options.lead ?? false,
});

/** A step maker: `Step.act(name, args, options)`, or piped from its name. */
type Make = {
  (args?: Schema.JsonObject, options?: Options): (name: string) => Step;
  (name: string, args?: Schema.JsonObject, options?: Options): Step;
};

// A direct call starts with the step's name, a string; a piped one with its args.
const named = (args: IArguments) => typeof args[0] === "string";

export const gather: Make = Function.dual(
  named,
  (name: string, args: Schema.JsonObject = {}, options: Options = {}): Step =>
    Step.cases.gather.make(stepFields(name, args, options)),
);

export const act: Make = Function.dual(
  named,
  (name: string, args: Schema.JsonObject = {}, options: Options = {}): Step =>
    Step.cases.act.make(stepFields(name, args, options)),
);

export const listen: Make = Function.dual(
  named,
  (name: string, args: Schema.JsonObject = {}, options: Options = {}): Step =>
    Step.cases.listen.make(stepFields(name, args, options)),
);

export const draft: Make = Function.dual(
  named,
  (name: string, args: Schema.JsonObject = {}, options: Options = {}): Step =>
    Step.cases.draft.make(stepFields(name, args, options)),
);

export const check: Make = Function.dual(
  named,
  (name: string, args: Schema.JsonObject = {}, options: Options = {}): Step =>
    Step.cases.check.make(stepFields(name, args, options)),
);

export const judge: Make = Function.dual(
  named,
  (name: string, args: Schema.JsonObject = {}, options: Options = {}): Step =>
    Step.cases.judge.make(stepFields(name, args, options)),
);
