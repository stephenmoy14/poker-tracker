import type { Cents } from "./types";

/** What the numbers mean: real money (cents) or plain chip counts. */
export type AmountFormat = "money" | "chips";

/** The parts of the game config that decide how amounts are shown. */
export interface AmountStyle {
  format?: AmountFormat; // missing = "money" (games saved before chip mode)
  currency: string;
}

/** A valid amount is a non-negative integer that is a multiple of the unit. */
export function isValidAmount(amount: Cents, unit: Cents): boolean {
  return Number.isInteger(amount) && amount >= 0 && amount % unit === 0;
}

export function assertValidAmount(amount: Cents, unit: Cents, label = "Amount", style?: AmountStyle): void {
  if (isValidAmount(amount, unit)) return;
  if (style?.format === "chips") {
    throw new Error(
      unit === 1
        ? `${label} must be a whole number of chips (got ${amount})`
        : `${label} must be a multiple of ${unit} chips (got ${amount})`,
    );
  }
  throw new Error(
    `${label} must be a non-negative multiple of ${formatCents(unit)} (got ${amount} cents)`,
  );
}

export function formatCents(amount: Cents, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount / 100);
}

/** "$1.25" in money games, "125" in chip games. */
export function formatAmount(amount: Cents, style: AmountStyle): string {
  if (style.format === "chips") return amount.toLocaleString("en-US");
  return formatCents(amount, style.currency);
}
