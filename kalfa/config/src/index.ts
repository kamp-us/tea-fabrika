/**
 * The root entry of `@kalfa/config`: declare a setting with a pipe, group it, and read it through the group's layer. The twelve older modules keep their own entries beside this one.
 */
/**
 * Declares one setting: its name, its schema and, in a pipe, a default, a description, the files that may set it and the live mark.
 *
 * @category settings
 */
export * as Setting from "./Declaration.ts";

/**
 * Joins one app's settings into a group, and starts them from the repo configuration, the user configuration and the environment.
 *
 * @category settings
 */
export * as SettingGroup from "./SettingGroup.ts";
