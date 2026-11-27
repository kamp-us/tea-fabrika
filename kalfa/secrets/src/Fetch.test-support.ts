// What the laws of declaring, routing and fetching a secret share (slice 2): a proof key a test app owns, a declaration made from a drawn name, the
// stores that answer or that write down what they were asked, the starts the plan's classes (g) to (j) name, and the flows the leak laws watch.
// They live apart from `Secrets.test-support.ts`, which the laws of the store side import: a law there must not wait for the declaring side.
import { Arbitrary, Context, Effect, Layer, Predicate, Redacted, Schema, type Scope } from "effect";
import type * as Errors from "./Errors.ts";
import * as MemoryStore from "./MemoryStore.ts";
import * as Name from "./Name.ts";
import type * as Recorder from "./Recorder.ts";
import * as Secret from "./Secret.ts";
import { between, failingRecorder, failingStore, marker, nameTexture } from "./Secrets.test-support.ts";
import * as Secrets from "./Secrets.ts";
import * as SecretsSettings from "./Settings.ts";
import * as Store from "./Store.ts";

// ---- the app's side: a proof key and a declaration

/** The proof key of a test app, as `MayFetchSecret` is the real app's: a Context key whose value says which object its check was for. */
class MayFetch extends Context.Service<MayFetch, { readonly object: string }>()("@kalfa/secrets/test/MayFetch") {}

/** A secret declared from a drawn name. `Secret.make` takes a name written in code, so a drawn one is the one place the check is stepped over. */
export const declare = (name: string) =>
  // @ts-expect-error a drawn name is plain text, and `Secret.make` takes a name written in code
  Secret.make(name, { fetch: MayFetch });

type Declared = ReturnType<typeof declare>;

/** The object a permission check names for the secret `name`. */
export const proofFor = (name: string): string => `secret:${name}`;

/** A fetch of `secret` with a proof for `object`: what the app's guard does, with the object it is given. */
export const fetchAs = (secret: Declared, object: string) => secret.pipe(Effect.provideService(MayFetch, { object }));

// ---- names

/** What the name laws draw once. */
type Texture = typeof nameTexture extends Arbitrary.Arbitrary<infer A> ? A : never;

/** The name `index` of a texture: every one is a name, and no two of a texture are alike. */
export const nameAt = (texture: Texture, index: number): string => `${texture.segments.join("/")}/n${index}`;

// ---- routes and the settings that hold them

/** A route as the settings file writes it. */
interface Route {
  readonly name: string;
  readonly store: string;
  readonly item: string;
}

/** The values the app's own settings group gave for `secrets.routes`, decoded as the group decodes them. */
const settings = (routes: ReadonlyArray<Route>): SecretsSettings.Values => ({
  routes: Schema.decodeUnknownSync(SecretsSettings.routes.schema)(routes),
});

/** The one item the flows use. */
export const ITEM = "app-key";

/** A route for `name` to the memory store's `item`. */
export const memoryRoute = (name: string, item: string = ITEM): Route => ({ name, store: "memory", item });

// ---- stores that write down what they are asked

/** A store, and every item it was asked to read, in order. */
interface Spy<Item> {
  readonly store: Store.Store<string, Item, never>;
  readonly asked: Array<Item>;
}

/** What a spy answers: a value that says which item it is for, as version 1. */
const answer = (item: string | number, name: typeof Name.SecretName.Type): Store.Held =>
  new Store.Found({
    value: { value: Redacted.make(`value-of-${item}`, { label: name }), version: Name.Version.make("1") },
  });

/** A store whose items are any text but the empty one. */
export const spyStore = (id: string): Spy<string> => {
  const asked: Array<string> = [];

  return {
    asked,
    store: Store.make({
      id,
      item: Schema.NonEmptyString,
      place: "store",
      holds: {
        read: (item: string, name) =>
          Effect.sync(() => {
            asked.push(item);

            return answer(item, name);
          }),
      },
    }),
  };
};

/** A store whose items are numbers, written as text in a route: a text that is no number is no item. */
const numberStore = (id: string): Spy<number> => {
  const asked: Array<number> = [];

  return {
    asked,
    store: Store.make({
      id,
      item: Schema.FiniteFromString,
      place: "store",
      holds: {
        read: (item: number, name) =>
          Effect.sync(() => {
            asked.push(item);

            return answer(item, name);
          }),
      },
    }),
  };
};

/** A store that takes items and has no port: it holds nothing. */
const bareStore = (id: string) => Store.make({ id, item: Schema.NonEmptyString, place: "store" });

/** The memory store, with its reads counted. */
export const countingMemory = () => {
  const reads = { count: 0 };

  const store = Store.make({
    id: "memory",
    item: Schema.NonEmptyString,
    place: "memory",
    holds: {
      read: (item: string, name) =>
        Effect.suspend(() => {
          reads.count += 1;

          return MemoryStore.store.holds?.read(item, name) ?? Effect.die("the memory store holds");
        }),
    },
  });

  return { store, reads };
};

// ---- starting

/** Everything a layer reads and a use writes, in memory, and the recorder's own facts. */
export const memoryDeps = (values: Readonly<Record<string, string>> = {}) =>
  Layer.mergeAll(MemoryStore.layer({ values }), MemoryStore.recorder);

/** `Secrets.layer` over the given stores, declarations and routes, with its needs given by `deps`. */
export const environment = <ROut extends Recorder.Recorder | MemoryStore.Contents>(
  stores: ReadonlyArray<Store.Any>,
  declared: ReadonlyArray<Declared>,
  routes: ReadonlyArray<Route>,
  deps: Layer.Layer<ROut>,
) => Secrets.layer({ stores, declared, settings: settings(routes) }).pipe(Layer.provideMerge(deps));

/** `Secrets.layer` over the memory store alone. */
export const memoryEnvironment = (
  declared: ReadonlyArray<Declared>,
  routes: ReadonlyArray<Route>,
  values: Readonly<Record<string, string>>,
) => environment([MemoryStore.store], declared, routes, memoryDeps(values));

/** What the start check says: no error, or the error's tag, the name it is about and what else it says. */
interface Expected {
  readonly tag: "RouteMissing" | "RouteRefused";
  readonly secret: string;
  readonly store?: string;
  readonly reason?: string;
  readonly port?: string;
}

/** The part of a start's error the laws compare. */
export const summary = (error: Errors.RouteMissing | Errors.RouteRefused): Expected =>
  Predicate.isTagged(error, "RouteMissing")
    ? { tag: error._tag, secret: error.secret }
    : {
        tag: error._tag,
        secret: error.secret,
        store: error.store,
        reason: error.reason,
        ...("port" in error && Predicate.isString(error.port) ? { port: error.port } : {}),
      };

/** One start of an app: what it lists, what its routes say, and what the start check must answer. */
interface Start {
  readonly id: string;
  readonly stores: ReadonlyArray<Store.Any>;
  readonly declared: ReadonlyArray<Declared>;
  readonly routes: ReadonlyArray<Route>;
  readonly expected: Expected | undefined;
}

/** The plan's classes of a start that goes wrong: (g) no route, (h) no such store, (i) an item the store refuses, (j) no port. */
const BAD_CLASSES = ["g", "h", "i", "j"] as const;

export const startDrawn = Arbitrary.all({
  texture: nameTexture,
  weights: Arbitrary.array(between(0, 1000), { minLength: 4, maxLength: 4 }),
  refused: marker,
});

type StartDrawn = typeof startDrawn extends Arbitrary.Arbitrary<infer A> ? A : never;

/**
 * The starts one drawn texture makes: one for each class, each with good declarations around the bad one, one that is right, and one that
 * lists all four bad classes in a drawn order, whose first problem the check must give. Every start routes a name that is a prefix of a declared
 * name and one a declared name is a prefix of, so a lookup by prefix finds a route it must not.
 */
export const starts = (drawn: StartDrawn): ReadonlyArray<Start> => {
  const { texture } = drawn;
  const word = texture.word;
  const strings = spyStore(`${word}-s`).store;
  const numbers = numberStore(`${word}-n`).store;
  const bare = bareStore(`${word}-b`);
  const stores: ReadonlyArray<Store.Any> = [strings, numbers, bare];

  const route = (index: number, store: string, item: string): Route => ({ name: nameAt(texture, index), store, item });

  const around: ReadonlyArray<Route> = [
    { name: texture.segments.join("/"), store: strings.id, item: "prefix" },
    { name: `${nameAt(texture, 2)}-longer`, store: strings.id, item: "longer" },
  ];

  const good = (index: number) => ({
    secret: declare(nameAt(texture, index)),
    route: route(index, strings.id, `${word}-${index}`),
  });

  const bad = {
    g: {
      secret: declare(nameAt(texture, 2)),
      routes: [],
      expected: { tag: "RouteMissing", secret: nameAt(texture, 2) },
    },
    h: {
      secret: declare(nameAt(texture, 3)),
      routes: [route(3, `${word}-ghost`, "x")],
      expected: { tag: "RouteRefused", secret: nameAt(texture, 3), store: `${word}-ghost`, reason: "store" },
    },
    i: {
      secret: declare(nameAt(texture, 4)),
      routes: [route(4, numbers.id, `${drawn.refused}x`)],
      expected: { tag: "RouteRefused", secret: nameAt(texture, 4), store: numbers.id, reason: "item" },
    },
    j: {
      secret: declare(nameAt(texture, 5)),
      routes: [route(5, bare.id, "x")],
      expected: { tag: "RouteRefused", secret: nameAt(texture, 5), store: bare.id, reason: "port", port: "holds" },
    },
  } as const;

  const first = good(0);
  const last = good(1);

  const make = (id: string, chosen: ReadonlyArray<(typeof BAD_CLASSES)[number]>): Start => {
    const picked = chosen.map((each) => bad[each]);

    return {
      id,
      stores,
      declared: [first.secret, ...picked.map((each) => each.secret), last.secret],
      routes: [...around, first.route, ...picked.flatMap((each) => each.routes), last.route],
      expected: picked[0]?.expected,
    };
  };

  const order = BAD_CLASSES.map((each, index) => ({ each, weight: drawn.weights[index] ?? 0, index })).sort(
    (left, right) => (left.weight === right.weight ? left.index - right.index : left.weight - right.weight),
  );

  const fine = [good(0), good(1), { secret: declare(nameAt(texture, 6)), route: route(6, numbers.id, "42") }];

  return [
    ...BAD_CLASSES.map((each) => make(each, [each])),
    {
      id: "right",
      stores,
      declared: fine.map((each) => each.secret),
      routes: [...around, ...fine.map((each) => each.route)],
      expected: undefined,
    },
    make(
      "first",
      order.map((each) => each.each),
    ),
  ];
};

// ---- routing: which store and which item a fetch asks

export const routingDrawn = Arbitrary.all({
  texture: nameTexture,
  extra: Arbitrary.array(between(0, 1), { maxLength: 4 }),
});

/** A routed name: its declaration, the spy store that must be asked, and the item it must be asked for. */
interface Routed {
  readonly secret: Declared;
  readonly store: "strings" | "numbers";
  readonly item: string | number;
}

/** Declared names routed to two spy stores, at least one to each, with items the stores read in their own kinds. */
export const routing = (drawn: Drawn<typeof routingDrawn>) => {
  const { texture } = drawn;
  const strings = spyStore(`${texture.word}-s`);
  const numbers = numberStore(`${texture.word}-n`);
  const picks = [0, 1, ...drawn.extra];

  const routed: ReadonlyArray<Routed> = picks.map((pickAt, index) => ({
    secret: declare(nameAt(texture, index)),
    store: pickAt === 0 ? "strings" : "numbers",
    item: pickAt === 0 ? `${texture.word}-${index}` : 100 + index,
  }));

  return {
    strings,
    numbers,
    routed,
    routes: routed.map((each): Route => ({
      name: each.secret.name,
      store: each.store === "strings" ? strings.store.id : numbers.store.id,
      item: String(each.item),
    })),
  };
};

type Drawn<A> = A extends Arbitrary.Arbitrary<infer B> ? B : never;

// ---- what a fetch is asked: proofs

/** The proofs a fetch of `name` must refuse, each for a declared name that is not it or a text that is only like it: (o) and (p), and texts that hold it. */
export const refusedProofs = (
  texture: Texture,
): ReadonlyArray<{ readonly id: string; readonly object: (name: string) => string }> => [
  { id: "o: another declared name", object: () => proofFor(nameAt(texture, 9)) },
  { id: "p: this name under another type word", object: (name) => `key:${name}` },
  { id: "the name with no type word", object: (name) => name },
  { id: "the object and more", object: (name) => `${proofFor(name)}/more` },
  { id: "the object short of a letter", object: (name) => proofFor(name).slice(0, -1) },
  { id: "the empty text", object: () => "" },
];

// ---- flows: what the leak laws watch

/** The five flows of a fetch: it works, there is nothing to find, the store fails, the recorder fails, and the proof is for another secret. */
export const FLOW_IDS = ["success", "missing", "store", "record", "proof"] as const;

export type FlowId = (typeof FLOW_IDS)[number];

/** A thing that holds a value, or holds what holds it, and a name for it, so a failure says which. */
export interface Carrier {
  readonly name: string;
  readonly thing: object;
}

/** One flow, built and ready to run: the fetch, and what to read after it. */
export interface Built {
  readonly id: FlowId;
  readonly name: string;
  readonly secret: Declared;
  readonly object: string;
  readonly store: string;
  readonly context: Context.Context<Secrets.Secrets>;
  readonly carriers: ReadonlyArray<Carrier>;
  readonly facts: Effect.Effect<ReadonlyArray<Recorder.Fact>>;
}

/** The flow's declared name. */
export const FLOW_NAME = "transport/turn-key";

/**
 * Builds one flow for a value the person put in the store: a decoy under another item when there is nothing to find, a failing store or a failing
 * recorder that quote the value in their error, and a proof for another secret. A value is in the store in every flow, so a leak has one to show.
 */
export const built = (id: FlowId, text: string): Effect.Effect<Built, never, Scope.Scope> =>
  Effect.gen(function* () {
    const secret = declare(FLOW_NAME);
    const object = id === "proof" ? proofFor("transport/other-key") : proofFor(FLOW_NAME);
    const values = id === "missing" ? { decoy: text } : { [ITEM]: text };

    const caseEnvironment = () => {
      switch (id) {
        case "store":
          return environment(
            [failingStore(text)],
            [secret],
            [{ name: FLOW_NAME, store: "failing", item: ITEM }],
            memoryDeps(values),
          );
        case "record":
          return environment(
            [MemoryStore.store],
            [secret],
            [memoryRoute(FLOW_NAME)],
            Layer.merge(MemoryStore.layer({ values }), failingRecorder(text)),
          );
        default:
          return environment([MemoryStore.store], [secret], [memoryRoute(FLOW_NAME)], memoryDeps(values));
      }
    };

    const context = yield* Layer.build(caseEnvironment()).pipe(Effect.orDie);

    const facts = Context.getOrUndefined(context, MemoryStore.Recorded);

    return {
      id,
      name: FLOW_NAME,
      secret,
      object,
      store: id === "store" ? "failing" : "memory",
      context,
      carriers: [
        { name: "the declaration", thing: secret },
        { name: "the Secrets service", thing: Context.get(context, Secrets.Secrets) },
        { name: "the contents", thing: Context.get(context, MemoryStore.Contents) },
      ],
      facts: facts === undefined ? Effect.succeed([]) : facts.facts,
    };
  });
