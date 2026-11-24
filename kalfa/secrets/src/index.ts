/**
 * The root entry point of `@kalfa/secrets`: secrets held by name, declared in code, routed to a store and fetched hidden.
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
 * Declares a secret, which is fetched by yielding it.
 *
 * @category declarations
 */
export * as Secret from "./Secret.ts";

/**
 * The service a declared secret asks for its value, and the Layer that starts it.
 *
 * @category services
 */
export * as Secrets from "./Secrets.ts";

/**
 * The settings of the package: which store and item each secret name points to.
 *
 * @category settings
 */
export * as SecretsSettings from "./Settings.ts";

/**
 * The ports of a secret store and what it answers.
 *
 * @category stores
 */
export * as Store from "./Store.ts";

export * from "./Errors.ts";

export * from "./Name.ts";
