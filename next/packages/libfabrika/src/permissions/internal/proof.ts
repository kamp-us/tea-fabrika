// The sealed proof a right's check gives (0526, after phoenix's `Grant`, 0107). Only `Rebac.ts`
// imports this file, and `mint` is the one way to make a proof. It is not a Schema, so nothing
// decodes one. What a proof needs again, the key it is provided under and its own check, is kept
// in a registry no other file can reach, so it never widens the proof's type.
import { type Context, Option, Function } from "effect";
import type { Tuples } from "../Relation.ts";
import type { Sender } from "../Senders.ts";

const ProofTypeId: unique symbol = Symbol.for("@kampus/libfabrika/permissions/Proof");

/**
 * The proof that a check of the right `P` passed, for one sender, permission and object. A proof of
 * one right is not a proof of another: `P` is the right's own class.
 *
 * @internal
 */
export interface Proof<out P> {
  readonly [ProofTypeId]: (_: never) => P;
  /** Who was checked, both ids kept (0261). */
  readonly sender: Sender;
  readonly permission: string;
  /** The one object this proof is for, as a ref. */
  readonly object: string;
}

/** What a minted proof keeps out of its type: the key it is provided under, and its check again. */
type Sealed = {
  readonly key: Context.Key<unknown, unknown>;
  readonly holds: (tuples: Tuples) => boolean;
};

const minted = new WeakMap<Proof<unknown>, Sealed>();

/**
 * The one way to make a proof: a check that passed. `holds` checks the same subject, permission
 * and object again on other tuples.
 *
 * @internal
 */
export const mint: {
  <P>(
    permission: string,
    object: string,
    key: Context.Key<unknown, Proof<P>>,
    holds: (tuples: Tuples) => boolean,
  ): (sender: Sender) => Proof<P>;
  <P>(
    sender: Sender,
    permission: string,
    object: string,
    key: Context.Key<unknown, Proof<P>>,
    holds: (tuples: Tuples) => boolean,
  ): Proof<P>;
} = Function.dual(
  5,
  <P>(
    sender: Sender,
    permission: string,
    object: string,
    key: Context.Key<unknown, Proof<P>>,
    holds: (tuples: Tuples) => boolean,
  ): Proof<P> => {
    const proof: Proof<P> = { [ProofTypeId]: (never) => never, sender, permission, object };
    minted.set(proof, { key, holds });
    return proof;
  },
);

/**
 * What `mint` kept for this proof; none for a value `mint` never made.
 *
 * @internal
 */
export const sealed = (proof: Proof<unknown>): Option.Option<Sealed> => Option.fromUndefinedOr(minted.get(proof));
