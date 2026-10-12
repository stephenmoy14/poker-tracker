import type { AmountStyle } from "../engine/money";

// Dollar amounts typed by the host <-> integer cents.

/** "1.25", "$1.25", "1", ".5" → cents. Null if it isn't a plain dollar amount. */
export function parseDollars(input: string): number | null {
  const s = input.trim().replace(/^\$/, "").replace(/,/g, "");
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) return null;
  const whole = m[1] === "" ? 0 : Number(m[1]);
  const frac = Number(((m[2] ?? "") + "00").slice(0, 2));
  return whole * 100 + frac;
}

/** Cents → text for an input box: 125 → "1.25", 100 → "1". */
export function centsToInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** Rounds down to the chip unit, then clamps. */
export function clampToUnit(cents: number, unit: number, min: number, max: number): number {
  const rounded = Math.floor(cents / unit) * unit;
  return Math.min(max, Math.max(min, rounded));
}

// ── Money or chips ──


/** Parses what the host typed: dollars in money games, whole chips in chip games. */
export function parseAmount(input: string, style: AmountStyle): number | null {
  if (style.format !== "chips") return parseDollars(input);
  const s = input.trim().replace(/,/g, "");
  return /^\d+$/.test(s) ? Number(s) : null;
}

/** Amount → text for an input box. */
export function amountToInput(amount: number, style: AmountStyle): string {
  return style.format === "chips" ? String(amount) : centsToInput(amount);
}
