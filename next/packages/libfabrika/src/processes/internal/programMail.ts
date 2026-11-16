// Program mail's pure rules, next/ (P41 slice 1, T1041): a delivery's ID, the host's grant and the inbox cap.
import { Function } from "effect";
import type { Rev } from "../../Rev.ts";
import type { Grants } from "../ProgramMail.ts";

/**
 * A delivery's ID: its dispatched command's one child under `/mail`. Never `/answer`, which is the
 * runner's own reply space, so peer mail never passes as a runner's own letter.
 * @internal
 */
export const mailId = (command: string): string => `${command}/mail`;

/**
 * Whether the host's grant lets `source` reach `to`: only a source's own entry counts, never an
 * inherited key.
 * @internal
 */
export const granted: {
  (source: string, to: string): (grants: Grants) => boolean;
  (grants: Grants, source: string, to: string): boolean;
} = Function.dual(
  3,
  (grants: Grants, source: string, to: string): boolean =>
    Object.hasOwn(grants, source) && (grants[source] ?? []).includes(to),
);

/** The business `ref` a message carries, if it has one. @internal */
export const businessRef = (m: unknown): string | null =>
  typeof m === "object" && m !== null && "ref" in m && typeof m.ref === "string" ? m.ref : null;

/**
 * How many letters of an inbox ending at `end` sit past its reader's `acked` pos. Never negative:
 * an ack ahead of the end reads as none unread.
 * @internal
 */
export const unread: {
  (acked: Rev): (end: Rev) => number;
  (end: Rev, acked: Rev): number;
} = Function.dual(2, (end: Rev, acked: Rev): number => Math.max(0, end - acked));

/** Whether an inbox ending at `end` holds its cap of unread letters, so a new one is refused. @internal */
export const full: {
  (acked: Rev, cap: number): (end: Rev) => boolean;
  (end: Rev, acked: Rev, cap: number): boolean;
} = Function.dual(3, (end: Rev, acked: Rev, cap: number): boolean => unread(end, acked) >= cap);
