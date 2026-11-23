/**
 * What a use of a secret leaves behind: a fact a recorder writes, and the slot that takes it.
 *
 * **Details**
 *
 * A fact says the name, the store and the version of one use, and never a value. It is a Schema, so a ledger saves exactly those
 * fields and refuses a name, a store id or a version that is none when it reads them back.
 */
import { Context, type Effect, Schema } from "effect";
import type * as Errors from "./Errors.ts";
import * as Name from "./Name.ts";

/**
 * A secret's value was fetched.
 *
 * @category facts
 */
export class Fetched extends Schema.TaggedClass<Fetched, { readonly brand: unique symbol }>()("Fetched", {
  name: Name.SecretName,
  store: Name.StoreId,
  version: Name.Version,
}) {}

/**
 * Every kind of fact a use can leave.
 *
 * @category facts
 */
export type Fact = Fetched;

/**
 * The slot that takes a fact. An app fills it with a ledger; the memory store fills it with a list, for tests.
 *
 * @category services
 */
export class Recorder extends Context.Service<
  Recorder,
  {
    readonly record: (fact: Fact) => Effect.Effect<void, Errors.RecordFailed>;
  }
>()("@kalfa/secrets/Recorder") {}
