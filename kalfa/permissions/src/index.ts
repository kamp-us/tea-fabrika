/**
 * The root entry point of `@kalfa/permissions`: declare a model of what a subject may do on an object.
 *
 * **Details**
 *
 * This is the first slice: the model and its relations. Checking a permission and guarding a step come in the next slice of the same
 * ticket (https://github.com/kamp-us/tea-fabrika/issues/2092).
 */
/**
 * A model of types, their relations and the permissions built from them.
 *
 * @category models
 */
export * as Model from "./Model.ts";

/**
 * The relations a type holds, each with the types of subject that may hold it.
 *
 * @category models
 */
export * as Relation from "./Relation.ts";
