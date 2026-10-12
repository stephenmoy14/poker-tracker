import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { GameState, PlayerId } from "../engine/types";
import { formatAmount, type AmountStyle } from "../engine/money";
import { amountToInput, parseAmount } from "./money";

// ── Money or chips: one setting per game decides how every amount looks ──

const AmountContext = createContext<AmountStyle>({ format: "money", currency: "USD" });
export const AmountProvider = AmountContext.Provider;

export function useAmounts() {
  const style = useContext(AmountContext);
  const fmt = (n: number) => formatAmount(n, style);
  return {
    style,
    isChips: style.format === "chips",
    fmt,
    signed: (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : fmt(0)),
    parse: (text: string) => parseAmount(text, style),
    toInput: (n: number) => amountToInput(n, style),
    example: style.format === "chips" ? "500" : "1.50",
  };
}

export function nameOf(state: GameState, id: PlayerId): string {
  return state.players[id]?.name ?? id;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="error" role="alert">
      {children}
    </p>
  );
}

/** A button that needs a second tap to confirm, for destructive actions. */
export function ConfirmButton({
  label,
  confirmLabel = "Tap again to confirm",
  onConfirm,
  className = "",
  disabled,
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className} ${armed ? "danger" : ""}`}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

/** Amount input: "$" prefix and decimal keypad for money, number keypad for chips. */
export function MoneyInput({
  value,
  onChange,
  label,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  id?: string;
}) {
  const { isChips } = useAmounts();
  return (
    <span className={`money-input ${isChips ? "chips-mode" : ""}`}>
      {!isChips && <span aria-hidden="true">$</span>}
      <input
        id={id}
        aria-label={label}
        inputMode={isChips ? "numeric" : "decimal"}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}
