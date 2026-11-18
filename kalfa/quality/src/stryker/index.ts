/**
 * `@kalfa/quality/stryker`: what a catalog imports. Schemas only; the runner is `./Run`.
 */

/** What a catalog imports to write its plants. */
export {
  /**
   * The plants a catalog lists.
   *
   * @category models
   */
  Catalog,
  /**
   * The law that must kill a plant.
   *
   * @category models
   */
  Law,
  /**
   * One planted mutant, named by its code shape.
   *
   * @category models
   */
  Plant,
  /**
   * Reads a plant from its catalog entry.
   *
   * @category utils
   */
  plant,
} from "./Plant.ts";
