// Program mail's pure rules, next/ (P41 slice 1, T1041): a delivery's ID, the host's grant and the inbox cap.
import { Predicate } from "effect";
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
export const granted = (grants: Grants, source: string, to: string): boolean =>
  Object.hasOwn(grants, source) && (grants[source] ?? []).includes(to);

/** The business `ref` a message carries, if it has one. @internal */
export const businessRef = (m: unknown): string | null =>
  Predicate.isObjectOrArray(m) && "ref" in m && Predicate.isString(m.ref) ? m.ref : null;

/**
 * How many letters of an inbox ending at `end` sit past its reader's `acked` pos. Never negative:
 * an ack ahead of the end reads as none unread.
 * @internal
 */
export const unread = (end: Rev, acked: Rev): number => Math.max(0, end - acked);

/** Whether an inbox ending at `end` holds its cap of unread letters, so a new one is refused. @internal */
export const full = (end: Rev, acked: Rev, cap: number): boolean => unread(end, acked) >= cap;
