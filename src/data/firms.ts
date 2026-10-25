import type { PresidencyId } from "./types";

type SeaZoneId = "west-indian" | "south-indian" | "east-indian";

// Firms, used with Deregulation (rulebook pp.36-42).
// Sources:
// - Firm charters: the family board backs, printnplay/Punchboard/John Company Punchboard (Backs).pdf
//   pp.1-6 (text layer, colours checked on the rendered pages). Rulebook p.42 pictures one.
// - Firm strategy cards: printnplay/Cards/John Company Cards (MiniEuro, Fronts).pdf pp.31-32, four
//   per family with the family's firm name.

export type FirmStrategyId = "west-indian" | "south-indian" | "east-indian" | "hobnob";

export type FirmStrategyCard = {
  id: FirmStrategyId;
  name: string;
  /** The sea zone the firm trades in and its storms hit; none for Hobnob. */
  seaZone?: SeaZoneId;
  /** Orders must be filled starting with this Presidency's home port (p.40). Data-layer id. */
  homePort?: PresidencyId;
  text: string;
};

export const firmStrategyCards: FirmStrategyCard[] = [
  {
    id: "west-indian",
    name: "West Indian Ocean",
    seaZone: "west-indian",
    homePort: "bombay",
    text: "Sailing in the West Indian Ocean and filling orders starting in the home port of Bombay.",
  },
  {
    id: "south-indian",
    name: "South Indian Ocean",
    seaZone: "south-indian",
    homePort: "madras",
    text: "Sailing in the South Indian Ocean and filling orders starting in the home port of Madras.",
  },
  {
    id: "east-indian",
    name: "East Indian Ocean",
    seaZone: "east-indian",
    homePort: "bengal",
    text: "Sailing in the East Indian Ocean and filling orders starting in the home port of Bengal.",
  },
  {
    id: "hobnob",
    name: "Hobnob",
    text: "The firm must still pay expenses after any firms that trade but does not alter the location of its dividend cube.",
  },
];

export const firmStrategyById: ReadonlyMap<FirmStrategyId, FirmStrategyCard> = new Map(
  firmStrategyCards.map((card) => [card.id, card]),
);

/** The firm charter's printed rules and costs (charter, rulebook pp.37-42). */
export const firmCharter = {
  /** "Shares (Max 10)". A firm at 10 shares can still be invested in but creates no more (p.38). */
  maxShares: 10,
  minValue: 1,
  maxValue: 10,
  /** Forming a firm and each investment add £5 from the bank to the London treasury (p.38). */
  investmentCash: 5,
  /** Fitting a shipyard ship onto the charter, with the shipyard owner's consent (p.39). */
  fitShipCost: 3,
  /** Buying a player-owned Company ship from its owner, paid to the Shipping office (p.39). */
  buybackFreshShipCost: 3,
  buybackFatiguedShipCost: 2,
  /** "Advance your firm's Value marker one space for each £6 you added to the India treasury" (p.41). */
  valueStepIncome: 6,
  /** When paying dividends the manager counts as one more share (charter, p.42). */
  managerDividendShares: 1,
  /**
   * Victory points per firm share at each Value space, index 0 = Value 1 (charter Value track):
   * 1: -1, 2: 0, 3: ½, 4: ½, 5: 1, 6: 1, 7: 1, 8: 1½, 9: 1½, 10: 2.
   */
  valueVictoryPoints: [-1, 0, 0.5, 0.5, 1, 1, 1, 1.5, 1.5, 2],
  /** Each piece in Debtor's Prison (Deregulation card back) scores -1 VP (p.41). */
  debtorsPrisonVictoryPoints: -1,
  source: "Punchboard (Backs) pp.1-6 firm charter; rulebook pp.37-42",
} as const;

/**
 * Each family board's firm charter name, by the family colour. The engine's colours are names
 * (src/engine/setup.ts) or the UI palette's hex values (src/ui/view-model.ts), so both are listed.
 * Benyon's board is pink; the engine calls that family red.
 */
export const firmNamesByColor: Readonly<Record<string, string>> = {
  blue: "Hastings & Co.",
  "#2563a8": "Hastings & Co.",
  red: "Benyon & Co.",
  pink: "Benyon & Co.",
  "#c2417d": "Benyon & Co.",
  black: "Paxton & Co.",
  "#3b3b3b": "Paxton & Co.",
  yellow: "Larkins & Co.",
  "#c9971a": "Larkins & Co.",
  green: "Walsh & Co.",
  "#2e7d4f": "Walsh & Co.",
  purple: "Sykes & Co.",
  "#7a4fa0": "Sykes & Co.",
};
