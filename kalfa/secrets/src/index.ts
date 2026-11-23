/**
 * The root entry point of `@kalfa/secrets`: secrets held by name, and the store side that holds them.
 *
 * **Details**
 *
 * Values are hidden from the moment a store hands them out. The memory store is `@kalfa/secrets/memory`, and the laws every store
 * passes are `@kalfa/secrets/test`.
 */
/**
 * What a use leaves behind: the facts, and the slot that takes them.
 *
 * @category recording
 */
export * as Recorder from "./Recorder.ts";

/**
 * The ports of a secret store and what it answers.
 *
 * @category stores
 */
export * as Store from "./Store.ts";

export * from "./Errors.ts";

export * from "./Name.ts";
