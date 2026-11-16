/**
 * Fabrika's one permission model, declared once (0526), and its rights.
 *
 * @stability unstable
 */
import * as Rebac from "./Rebac.ts";

/**
 * Fabrika's model. A fabrika has one owner, admins and members (0290), and any of them may start
 * any program on it, watch any process on it and pipe any two programs on it: 0170's first rule. A
 * registered name may mail another name it pipes to. A smarter rule changes this value, never the
 * check.
 *
 * @stability unstable
 * @category models
 */
export const Model = Rebac.make("fabrika")
  .type("person", {})
  .type("name", {
    // A live pipe: the writer's registered name pipes to the reader's, and so may mail it (0526).
    relations: { pipes_to: ["name"] },
    permissions: { mail: (p) => p.union("pipes_to") },
  })
  .type("fabrika", {
    relations: { owner: ["person"], admin: ["person"], member: ["person"] },
    permissions: {
      start: (p) => p.union("owner", "admin", "member"),
      watch: (p) => p.union("owner", "admin", "member"),
      pipe: (p) => p.union("owner", "admin", "member"),
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
  "@kampus/libfabrika/permissions/Model.StartProgram",
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
  "@kampus/libfabrika/permissions/Model.WatchProcess",
  {
    model: Model,
    on: "fabrika",
    permission: "watch",
  },
) {}

/**
 * The right to pipe one program's output to another program's input on a fabrika, checked against
 * the member behind the program that asks (0551, 0531).
 *
 * @stability unstable
 * @category rights
 */
export class PipePrograms extends Rebac.Permission<PipePrograms>()(
  "@kampus/libfabrika/permissions/Model.PipePrograms",
  {
    model: Model,
    on: "fabrika",
    permission: "pipe",
  },
) {}

/**
 * The right of one registered name to mail another, checked for the sending name on the receiving
 * name: a live pipe's `pipes_to` row grants it, one way, while the pipe lives (0526).
 *
 * @stability unstable
 * @category rights
 */
export class MailName extends Rebac.Permission<MailName>()("@kampus/libfabrika/permissions/Model.MailName", {
  model: Model,
  on: "name",
  permission: "mail",
  subject: "name",
}) {}
