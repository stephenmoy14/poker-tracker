// Poker engine: core types (DRAFT for review)
//
// All money is integer cents. Every amount must be a multiple of
// config.unit (5 = $0.05). Nothing in this folder may import React,
// browser APIs, or database code.

export type Cents = number;
export type PlayerId = string;
export type EventId = string;

export interface GameConfig {
  smallBlind: Cents; // e.g. 10 = $0.10
  bigBlind: Cents;   // e.g. 25 = $0.25
  unit: Cents;       // smallest chip: 5 = $0.05
  currency: string;  // "USD"
  format?: "money" | "chips"; // missing = money. Chips: amounts are chip counts, unit is usually 1
  maxSeats: number;  // e.g. 10
}

// ───────────── Events: the only thing persisted ─────────────

interface EventBase {
  id: EventId;
  at: number;               // epoch ms, display only; order = log position
  by?: PlayerId | "host";   // phase 2: who entered it
}

export type GameEvent =
  | (EventBase & { type: "game_created"; config: GameConfig })
  | (EventBase & {
      type: "player_joined";
      playerId: PlayerId;
      name: string;
      seat: number;
      buyIn: Cents;
    })
  | (EventBase & { type: "rebuy"; playerId: PlayerId; amount: Cents })   // between hands only
  | (EventBase & { type: "player_left"; playerId: PlayerId })            // between hands; stack is cashed out
  | (EventBase & { type: "player_sat_out"; playerId: PlayerId })         // between hands; keeps stack and seat
  | (EventBase & { type: "player_returned"; playerId: PlayerId })        // between hands; no missed blinds owed
  | (EventBase & { type: "hand_started"; buttonSeat: number })           // blinds post automatically
  | (EventBase & { type: "action"; playerId: PlayerId; action: PlayerAction })
  | (EventBase & { type: "hand_fast_entry"; entries: FastEntry[] })      // ends betting for this hand
  | (EventBase & { type: "pot_awarded"; potIndex: number; winners: PlayerId[] })
  | (EventBase & { type: "game_ended" });

// All-in is not a separate kind: it's a bet/raise/call that uses the whole
// stack. The engine marks the player allIn. The UI's All-in button maps to
// whichever of these applies.
export type PlayerAction =
  | { kind: "fold" }
  | { kind: "check" }
  | { kind: "call" }               // amount derived (capped at stack = all-in call)
  | { kind: "bet"; to: Cents }     // total committed this street after betting
  | { kind: "raise"; to: Cents };  // "raise to", not "raise by"

export interface FastEntry {
  playerId: PlayerId;
  contributed: Cents; // total for the whole hand, including blinds
  folded: boolean;
}

// ───────────── State: always computed by replay ─────────────

export interface Player {
  id: PlayerId;
  name: string;
  seat: number;
  stack: Cents;       // chips behind, excluding chips committed in the current hand
  totalBuyIn: Cents;  // initial buy-in + rebuys
  status: "seated" | "sitting_out" | "left"; // sitting_out: skipped for blinds, button and dealing
}

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";

export interface HandPlayer {
  playerId: PlayerId;
  committedStreet: Cents;
  committedTotal: Cents;
  folded: boolean;
  allIn: boolean;
  hasActed: boolean; // acted since the last full raise (round completion + reopening)
}

export interface Pot {
  amount: Cents;
  eligible: PlayerId[]; // non-folded players who contributed at this level
}

export interface PotAward {
  potIndex: number;
  payouts: Record<PlayerId, Cents>; // includes odd-chip assignment
}

export interface HandState {
  number: number;
  buttonSeat: number;
  smallBlindSeat: number | null; // always set today (no dead button); kept nullable for future rules
  bigBlindSeat: number;
  street: Street;
  players: HandPlayer[];    // seat order, starting left of the button
  toAct: PlayerId | null;
  currentBet: Cents;        // highest committedStreet this street
  lastRaiseSize: Cents;     // minimum raise increment; starts at big blind
  mode: "actions" | "fast_entry";
  phase: "betting" | "awarding" | "complete";
  uncalledReturn: { playerId: PlayerId; amount: Cents } | null;
  pots: Pot[];              // main pot first; filled when betting ends
  awards: PotAward[];       // awarded last side pot first, main pot last
}

export interface GameState {
  config: GameConfig;
  players: Record<PlayerId, Player>;
  hand: HandState | null;   // null before the first hand; after a hand ends it stays here with phase "complete" until the next hand_started
  handsPlayed: number;
  lastButtonSeat: number | null;
  status: "open" | "ended";
}

// What the UI may offer the player whose turn it is.
export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  callAmount: Cents;                  // 0 if nothing to call
  minBetOrRaiseTo: Cents | null;      // null if betting isn't open (e.g. short all-in didn't reopen)
  maxBetOrRaiseTo: Cents;             // all-in
}

export interface ReplayError {
  eventId: EventId;
  index: number;
  message: string; // e.g. "Raise to $1.00 is below the minimum raise of $1.50"
}

// Replay stops at the first invalid event and returns the state just before it.
export interface ReplayResult {
  state: GameState | null; // null only if the log doesn't start with a valid game_created
  error: ReplayError | null;
}

// ───────────── Settlement ─────────────

export interface NetResult {
  playerId: PlayerId;
  net: Cents; // final stack − totalBuyIn; all nets sum to zero
}

export interface Payment {
  from: PlayerId;
  to: PlayerId;
  amount: Cents;
}
