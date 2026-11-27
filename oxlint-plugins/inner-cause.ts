// Ticket 2018, kalfa/. An error that holds an inner failure sets it as its JavaScript `cause`, as Effect's own wrappers do.
// A `Schema.TaggedError` passes a field named `cause` to the `Error` constructor, and Effect's printer follows `error.cause` and nothing else
// (`node_modules/effect/src/internal/effect.ts:355-358`). A wrapper that holds its inner failure in `reason` and has no `cause` prints as its tag alone,
// and so does the exception a failed span records, which `OtlpTracer` builds with the same printer. Effect's `SqlError` writes
// `override readonly cause = this.reason;` for this. The rule holds every kalfa error class to it.
//
// An error class is what `fabrika/hidden-cause` calls one (oxlint-plugins/error-class.ts). A field holds a failure when its schema, followed through
// same-file `const`s and through `Schema`'s `optional`, `optionalKey`, `NullOr`, `UndefinedOr`, `NullishOr`, `Array`, `NonEmptyArray` and `Union`, reaches:
// - a same-file class that is itself an error class (`reason: Inner`, `reason: Schema.Union([A, B])`);
// - `Schema.Defect()` under a key that is not `cause`;
// - under the key `reason` only, a name imported from a module that is not Effect's (`reason: Errors.Failure`, `reason: Failure`): by the repo's pattern
//   (`.kalfa/patterns/effect-errors-keep-their-cause.md`) a `reason` that is no literal is a union of tagged errors, and without types an import says nothing more.
// A class that holds a failure carries it when either holds:
// - its fields have a `cause` key (`fabrika/hidden-cause` holds that key's form), or
// - its body has a non-static property `cause` whose value is exactly `this.<k>`, `k` a field that holds a failure.
// Otherwise the rule reports it once, at the class name.
// What passes: `reason: Schema.Literals([...])`, `reason: Schema.String`, a union of `Schema.TaggedStruct`s, an imported schema under any key but `reason`,
// and a class that is no error class (`Schema.Class`). What fires too: a `cause` of the wrong form (`= undefined`, `= this.other`, a getter).
// Misses: a failure behind a helper call, fields imported from another file, an imported error under a key that is not `reason`, a constructor that
// passes `cause` to `super` (SocketError's form), and anything outside kalfa's product files: `.oxlintrc.json` leaves kalfa's test files and test support
// out, since a test makes errors of any shape to probe them.
import type { CreateRule, ESTree } from "@oxlint/plugins";
import { errorClass, written } from "./error-class.ts";
import { imported } from "./match.ts";
import type { Node } from "./match.ts";

/** Combinators that hold what their argument holds. */
const WRAPPERS = ["optional", "optionalKey", "NullOr", "UndefinedOr", "NullishOr", "Array", "NonEmptyArray"];

const message = (key: string): string =>
  `This error holds a failure in \`${key}\` and has no cause, so a printed error and a span's exception drop it. Add \`override readonly cause = this.${key};\`, as Effect's SqlError does (oxlint-plugins/inner-cause.ts, ticket 2018).`;

/** A module that is not Effect's. */
const isOther = (from: string): boolean =>
  from !== "effect" && !from.startsWith("effect/") && !from.startsWith("@effect/");

export const innerCause: CreateRule = {
  create(context) {
    const { resolve, schemaCall, classBase, followed, properties, fieldsOf } = errorClass(context);

    /** Whether a field's schema, at the key it is under, holds a failure. */
    const holds = (node: Node, key: string, seen = new Set<Node>()): boolean => {
      if (seen.has(node)) {
        return false;
      }

      seen.add(node);

      const found = followed(node);

      if (found !== null) {
        return holds(found, key, seen);
      }

      if (node.type === "Identifier") {
        const base = classBase(node);

        if (base !== null) {
          return fieldsOf(base) !== null;
        }

        const at = imported(resolve(node));

        return key === "reason" && at !== null && isOther(at.from);
      }

      if (node.type === "MemberExpression" && !node.computed && node.object.type === "Identifier") {
        const at = imported(resolve(node.object));

        return key === "reason" && at !== null && at.name === "*" && isOther(at.from);
      }

      if (schemaCall(node, ["Defect"]) !== null) {
        return key !== "cause";
      }

      const wrapped = schemaCall(node, WRAPPERS);

      if (wrapped !== null) {
        const [inner] = wrapped.arguments;

        return inner !== undefined && inner.type !== "SpreadElement" && holds(inner, key, seen);
      }

      const union = schemaCall(node, ["Union"]);
      const [members] = union === null ? [] : union.arguments;

      return (
        members !== undefined &&
        members.type === "ArrayExpression" &&
        members.elements.some((each) => each !== null && each.type !== "SpreadElement" && holds(each, key, seen))
      );
    };

    /** Whether a class member is `cause = this.<k>`, with `k` a field that holds a failure. */
    const carries = (member: ESTree.ClassBody["body"][number], failures: ReadonlyArray<string>): boolean => {
      if (member.type !== "PropertyDefinition" || member.static || written(member.key, member.computed) !== "cause") {
        return false;
      }

      const value = member.value;

      return (
        value?.type === "MemberExpression" &&
        value.object.type === "ThisExpression" &&
        failures.some((key) => key === written(value.property, value.computed))
      );
    };

    const check = (node: ESTree.Class) => {
      const fields = fieldsOf(node.superClass);

      if (fields === null) {
        return;
      }

      const own = properties(fields).flatMap((each) =>
        each.type === "Property" ? [{ key: written(each.key, each.computed), value: each.value }] : [],
      );

      const failures = own.flatMap(({ key, value }) => (key !== null && holds(value, key) ? [key] : []));
      const [first] = failures;

      if (first === undefined || own.some(({ key }) => key === "cause")) {
        return;
      }

      if (!node.body.body.some((member) => carries(member, failures))) {
        context.report({ node: node.id ?? node, message: message(first) });
      }
    };

    return { ClassDeclaration: check, ClassExpression: check };
  },
};
