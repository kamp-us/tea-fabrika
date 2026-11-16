/**
 * Fabrika's one permission model, declared once (0526), and its rights.
 *
 * @stability unstable
 */
import * as Rebac from "./Rebac.ts";

/**
 * Fabrika's model. A fabrika has one owner, admins and members (0290), and any of them may start
 * any program on it and watch any process on it: 0170's first rule. A smarter rule changes this
 * value, never the check.
 *
 * @stability unstable
 * @category models
 */
export const Model = Rebac.make("fabrika")
  .type("person", {})
  .type("fabrika", {
    relations: { owner: ["person"], admin: ["person"], member: ["person"] },
    permissions: {
      start: (p) => p.union("owner", "admin", "member"),
      watch: (p) => p.union("owner", "admin", "member"),
    },
  });

/**
 * The right to start a program on a fabrika, checked against the member whose input caused the
 * start (0170).
 *
 * @stability unstable
 * @category rights
 */
export class StartProgram extends Rebac.Permission<StartProgram>()(
  "@kampus/libfabrika/permissions/Model/StartProgram",
  {
    model: Model,
    on: "fabrika",
    permission: "start",
  },
) {}

/**
 * The right to watch a process on a fabrika, as OTP's monitor, checked against the member behind
 * the program that asks (0170, 0531).
 *
 * @stability unstable
 * @category rights
 */
export class WatchProcess extends Rebac.Permission<WatchProcess>()(
  "@kampus/libfabrika/permissions/Model/WatchProcess",
  {
    model: Model,
    on: "fabrika",
    permission: "watch",
  },
) {}
