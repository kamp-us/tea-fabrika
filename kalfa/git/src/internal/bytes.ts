// Bytes put one after the other: the memory adapter hashes a patch's fields as one string of bytes, and the process adapter
// joins the chunks git printed.

/**
 * The parts one after the other, as one array of bytes.
 *
 * @internal
 */
export const joined = (parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const whole = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;

  for (const part of parts) {
    whole.set(part, at);
    at += part.length;
  }

  return whole;
};
