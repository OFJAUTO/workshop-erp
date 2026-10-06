import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const PIN_PATTERN = /^\d{4}$/;

/** Scrambles a 4-digit PIN so the real digits are never stored. */
export function hashPin(pin: string): string {
  if (!PIN_PATTERN.test(pin)) {
    throw new Error("PIN must be exactly 4 digits");
  }
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

/** Checks a typed PIN against the stored scrambled value. */
export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored || !PIN_PATTERN.test(pin)) return false;
  const [algorithm, salt, hash] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const candidate = scryptSync(pin, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
