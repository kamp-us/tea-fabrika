/**
 * Whether a pipe fits: every value the writer's declared shape can send is a value the reader's
 * declared shape takes (0550). The check reads Effect's own persisted schema form,
 * `SchemaRepresentation`, never the code, so the brain can judge two programs it does not run. It is
 * pure: no service and no clock. The brain runs it on a pipe; an editor can run it on two
 * declarations.
 *
 * @stability unstable
 */
import { Match, Option, Predicate, Result, Schema, SchemaAST, SchemaRepresentation } from "effect";

/**
 * The rule's own name, kept on every `piped` row, so a later rule never rewrites what this one
 * judged.
 *
 * @stability unstable
 * @category constants
 */
export const RULE = "fit/v1";

/**
 * Schema for where the check stopped: field names, with `"[]"` for a list's item.
 *
 * @stability unstable
 * @category schemas
 */
export const Path = Schema.Array(Schema.String);

/**
 * Schema for a port's declared shape, as the loader writes it: `doc`, Effect's persisted form of the
 * schema's encoded side (`SchemaRepresentation.toJson`), and `decodes`, the first path where the
 * schema decodes through a transformation, or `null` when it has none. The whole shape is `null`
 * when the persisted form cannot be written, as for a custom filter with no persistence id.
 *
 * @stability unstable
 * @category schemas
 */
export const Shape = Schema.NullOr(Schema.Struct({ doc: Schema.Json, decodes: Schema.NullOr(Path) }));
/**
 * A port's declared shape, as `Shape` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type Shape = typeof Shape.Type;

const Cases = {
  /** The reader needs `need` at `path`, and the writer has `has`: a shape word, `missing` or `optional`. */
  does_not_fit: { path: Path, need: Schema.String, has: Schema.String },
  /** The reader's shape at `path` is one this rule does not compare, named by `shape`. */
  cannot_tell: { path: Path, shape: Schema.String },
};

/**
 * Schema for why a pipe does not fit: `does_not_fit` names the first need the writer misses, and
 * `cannot_tell` the first reader shape this rule does not compare. Both say where.
 *
 * @stability unstable
 * @category schemas
 */
export const Unfit = Schema.TaggedUnion(Cases);

/**
 * Schema for the check's verdict: `fits`, or one of `Unfit`'s two cases.
 *
 * @stability unstable
 * @category schemas
 */
export const Fit = Schema.TaggedUnion({ fits: {}, ...Cases });
type Fit = typeof Fit.Type;

type Node = SchemaRepresentation.Representation;
type Check = SchemaRepresentation.Check;
type Path = ReadonlyArray<string>;

/** The ids of the checks and declarations Effect's own revivers know: only these mean one predicate
 *  on both ends, since a pack may put its own code under any other id. */
const EFFECT_IDS: ReadonlySet<string> = new Set(
  Object.values(SchemaRepresentation).flatMap((value) =>
    Predicate.hasProperty(value, "id") && Predicate.hasProperty(value, "revive") && Predicate.isString(value.id)
      ? [value.id]
      : [],
  ),
);

const FITS: Fit = Fit.cases.fits.make({});

const missing = (path: Path, need: string, has: string): Fit =>
  Fit.cases.does_not_fit.make({ path: [...path], need, has });

const unknown = (path: Path, shape: string): Fit => Fit.cases.cannot_tell.make({ path: [...path], shape });

/** A node in one word, as a verdict names it. */
const word = (node: Node): string =>
  Match.value(node).pipe(
    Match.tag("Literal", (literal) => JSON.stringify(literal.literal) ?? "Literal"),
    Match.tag("Union", (union) => union.types.map(word).join(" | ")),
    Match.orElse((other) => other._tag),
  );

/** One check's identity: Effect's id and its payload as JSON text, or none for a check with no id. */
const identity = (check: Check): Option.Option<{ readonly id: string; readonly key: string }> =>
  Option.map(Option.fromUndefinedOr(check.representation), (r) => ({
    id: r.id,
    key: `${r.id}:${JSON.stringify(r.payload)}`,
  }));

/** A node's checks: a reference carries none of its own. */
const checksIn = (node: Node): ReadonlyArray<Check> => ("checks" in node ? node.checks : []);

/** Every reader check must be one the writer carries: Effect's own id, the same payload, any order. */
const checked = (writer: Node, reader: Node, path: Path): Fit => {
  const carried = new Set(
    checksIn(writer).flatMap((check) => Option.toArray(Option.map(identity(check), ({ key }) => key))),
  );

  for (const check of checksIn(reader)) {
    const own = Option.getOrUndefined(identity(check));

    if (own === undefined) {
      return unknown(path, "check");
    }

    if (!EFFECT_IDS.has(own.id) || !carried.has(own.key)) {
      return unknown(path, `check ${own.id}`);
    }
  }

  return FITS;
};

/** The answer to keep when a writer must fit one of several reader cases and fits none: a reader
 *  case this rule cannot judge wins, else the most precise miss. */
const closest = (verdicts: ReadonlyArray<Fit>): Fit =>
  verdicts.find(Fit.guards.cannot_tell) ??
  verdicts.reduce((best, v) =>
    Fit.guards.does_not_fit(v) && Fit.guards.does_not_fit(best) && v.path.length > best.path.length ? v : best,
  );

const PRIMITIVES = new Set(["String", "Number", "Boolean", "Null"]);

/** The primitive a literal is a value of. */
const primitive = (literal: SchemaAST.LiteralValue): string =>
  Predicate.isString(literal)
    ? "String"
    : Predicate.isNumber(literal)
      ? "Number"
      : Predicate.isBoolean(literal)
        ? "Boolean"
        : "BigInt";

/** A walk of the two documents: the reader's node is read first, then the writer's. */
const walker = (writerDoc: SchemaRepresentation.Document, decodes: Path | null) => {
  /** A writer node behind its references, so a recursive writer compares as far as the reader asks. */
  const resolved = (node: Node): Node =>
    Match.value(node).pipe(
      Match.tag("Reference", (ref) => {
        const target = writerDoc.references[ref.$ref];
        return target === undefined ? node : resolved(target);
      }),
      Match.tag("Suspend", (suspend) => resolved(suspend.thunk)),
      Match.orElse(() => node),
    );

  const same = (a: Path, b: Path) => a.length === b.length && a.every((part, n) => part === b[n]);

  /** Every index signature of a writer struct must fit the reader's need at a key it may send. Any
   *  index is taken to match the key, which can only refuse more, never pass a value wrongly. */
  const indexes = (writer: SchemaRepresentation.Objects, need: Node, at: Path): Fit => {
    for (const index of writer.indexSignatures) {
      const verdict = walk(index.type, need, at);

      if (!Fit.guards.fits(verdict)) {
        return verdict;
      }
    }

    return FITS;
  };

  const walk = (writerNode: Node, reader: Node, path: Path): Fit => {
    const writer = resolved(writerNode);

    // A reader that decodes through a transformation here can refuse what its encoded side shows.
    if (decodes !== null && same(decodes, path)) {
      return unknown(path, "transformation");
    }

    if ((reader._tag === "Unknown" || reader._tag === "Any") && checksIn(reader).length === 0) {
      return FITS;
    }

    // A union on the writer: each case it can send must fit.
    if (writer._tag === "Union") {
      for (const one of writer.types) {
        const verdict = walk(one, reader, path);

        if (!Fit.guards.fits(verdict)) {
          return verdict;
        }
      }

      return FITS;
    }

    return Match.value(reader).pipe(
      Match.tag("Union", (union): Fit => {
        // Effect decodes a oneOf union only when exactly one case takes the value: v1 cannot tell.
        if (union.options?.mode === "oneOf" || union.checks.length > 0) {
          return unknown(path, "Union oneOf");
        }

        const verdicts = union.types.map((one) => walk(writer, one, path));
        return verdicts.some(Fit.guards.fits)
          ? FITS
          : verdicts.length === 0
            ? missing(path, "Never", word(writer))
            : closest(verdicts);
      }),
      Match.tag("Literal", (literal): Fit => {
        if (writer._tag !== "Literal" || writer.literal !== literal.literal) {
          return missing(path, word(literal), word(writer));
        }

        return checked(writer, literal, path);
      }),
      Match.tag("Arrays", (list): Fit => {
        const [item, ...more] = list.rest;

        if (list.elements.length > 0 || item === undefined || more.length > 0) {
          return unknown(path, "tuple");
        }

        if (writer._tag !== "Arrays") {
          return missing(path, "Arrays", word(writer));
        }

        const inner = [...path, "[]"];

        // Every element and the rest of a writer's list must fit the reader's item.
        for (const one of [...writer.elements.map((e) => e.type), ...writer.rest]) {
          const verdict = walk(one, item, inner);

          if (!Fit.guards.fits(verdict)) {
            return verdict;
          }
        }

        return checked(writer, list, path);
      }),
      Match.tag("Objects", (struct): Fit => {
        if (struct.indexSignatures.length > 0) {
          return unknown(path, "Record");
        }

        if (writer._tag !== "Objects") {
          return missing(path, "Objects", word(writer));
        }

        for (const need of struct.propertySignatures) {
          if (!Predicate.isString(need.name)) {
            return unknown(path, "symbol key");
          }

          const at = [...path, need.name];
          const has = writer.propertySignatures.find((p) => p.name === need.name);

          // A field the reader makes optional may be missing; extra writer fields are fine (0550).
          if (has === undefined) {
            if (!need.isOptional) {
              return missing(at, word(need.type), "missing");
            }

            // A writer's index signature may still send this key, and Effect reads every key an
            // index matches: its value must then fit what the reader needs here.
            const verdict = indexes(writer, need.type, at);

            if (!Fit.guards.fits(verdict)) {
              return verdict;
            }

            continue;
          }

          if (has.isOptional && !need.isOptional) {
            return missing(at, word(need.type), "optional");
          }

          const verdict = walk(has.type, need.type, at);

          if (!Fit.guards.fits(verdict)) {
            return verdict;
          }
        }

        return checked(writer, struct, path);
      }),
      Match.tag("Declaration", (declaration) =>
        unknown(path, `Declaration ${declaration.representation?.id ?? "unnamed"}`),
      ),
      Match.orElse((other): Fit => {
        if (!PRIMITIVES.has(other._tag)) {
          return unknown(path, other._tag);
        }

        // The kind first, then the checks: a case of the wrong kind is does_not_fit.
        if (writer._tag === "Literal") {
          if (primitive(writer.literal) !== other._tag) {
            return missing(path, other._tag, word(writer));
          }

          // A literal is a value of its primitive, when that primitive asks nothing more of it.
          return checksIn(other).length === 0 ? FITS : checked(writer, other, path);
        }

        return writer._tag === other._tag ? checked(writer, other, path) : missing(path, other._tag, word(writer));
      }),
    );
  };

  return walk;
};

const fromJson = (doc: Schema.Json) => Result.try(() => SchemaRepresentation.fromJson(doc));

/**
 * Whether every encoded value of the writer's shape is an encoded value the reader's shape takes, by
 * this rule's v1.
 *
 * **Details**
 *
 * The reader's node is read first. A reader of anything takes everything. A union on the writer fits
 * when each of its cases fits; a union on the reader when the writer fits one case. A primitive takes
 * the same primitive or a literal of it; a literal, that literal; a list, a list whose items fit; a
 * struct, a struct with each field it requires, required and fitting, where extra fields are fine. A
 * check fits when the writer carries the same Effect check with the same payload, in any order.
 *
 * Everything else on the reader's side is `cannot_tell`: a declaration (a date, `Option`, a class),
 * recursion, a tuple, a record, a template literal, an enum, a union in `oneOf` mode, a check whose id
 * is not Effect's own, a field that decodes through a transformation, and a port with no persisted
 * shape.
 *
 * @stability unstable
 * @category checks
 */
export const fits = (writer: Shape, reader: Shape): Fit => {
  if (writer === null || reader === null) {
    return unknown([], "no persisted form");
  }

  const w = fromJson(writer.doc);
  const r = fromJson(reader.doc);

  if (Result.isFailure(w) || Result.isFailure(r)) {
    return unknown([], "no persisted form");
  }

  const verdict = walker(w.success, reader.decodes)(w.success.representation, r.success.representation, []);

  // A transformation the walk never reached, as under an optional field, still keeps it from vouching.
  return Fit.guards.fits(verdict) && reader.decodes !== null ? unknown(reader.decodes, "transformation") : verdict;
};

/** The first path where a schema decodes through a transformation, or none. */
const decodesAt = (ast: SchemaAST.AST, path: Path): Path | null => {
  if (ast.encoding !== undefined) {
    return path;
  }

  const first = (pairs: ReadonlyArray<readonly [SchemaAST.AST, Path]>): Path | null => {
    for (const [inner, at] of pairs) {
      const found = decodesAt(inner, at);

      if (found !== null) {
        return found;
      }
    }

    return null;
  };

  if (SchemaAST.isObjects(ast)) {
    return first(ast.propertySignatures.map((p) => [p.type, [...path, String(p.name)]] as const));
  }

  if (SchemaAST.isArrays(ast)) {
    return first([
      ...ast.elements.map((e, n) => [e, [...path, String(n)]] as const),
      ...ast.rest.map((e) => [e, [...path, "[]"]] as const),
    ]);
  }

  if (SchemaAST.isUnion(ast)) {
    return first(ast.types.map((t) => [t, path] as const));
  }

  // A declaration's type parameters and a recursion are never compared, so they decide nothing here.
  return null;
};

/**
 * A port's declared shape, from the schema a program gave: its encoded side in Effect's persisted
 * form, and where it first decodes through a transformation. A schema whose form cannot be persisted,
 * such as one with a custom filter that has no id, has no shape: `null`.
 *
 * @stability unstable
 * @category constructors
 */
export const shape = (schema: Schema.Top): Shape =>
  Result.getOrNull(
    Result.map(
      Result.try(() => SchemaRepresentation.toJson(SchemaRepresentation.toRepresentation(schema.ast))),
      (doc) => ({ doc, decodes: decodesAt(schema.ast, []) }),
    ),
  );
