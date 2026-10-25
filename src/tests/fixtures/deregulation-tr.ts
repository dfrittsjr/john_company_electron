import type { FirmId, FirmState, GameState, PlayerId, PresidencyId, ShipState } from "../../engine";
import type { FirmStrategyId } from "../../data";
import { withOffice, withWriters } from "./builders";
import { BLUE, RED, YELLOW, enterOperation, operationGame, withSeating } from "./company-operation";

// Builders for firm trading tests (Deregulation, rulebook pp.40-42). The Firms phase is another
// area's, so these write the firm state and the strategy secrets directly.

export { BLUE, RED, YELLOW };

export const OFFICES_BEFORE = {
  Bombay: ["chairman", "director-of-trade", "manager-of-shipping", "military-affairs"],
  Madras: ["chairman", "director-of-trade", "manager-of-shipping", "military-affairs", "president-bombay"],
  Bengal: ["chairman", "director-of-trade", "manager-of-shipping", "military-affairs", "president-bombay", "president-madras"],
} as const;

export type FirmSetup = {
  id: FirmId;
  manager: PlayerId;
  strategy: FirmStrategyId;
  bid: number;
  ships: number;
  value?: number;
  indiaTreasury?: number;
};

export function withFirms(state: GameState, setups: FirmSetup[]): GameState {
  const firms: FirmState[] = setups.map((setup) => ({
    id: setup.id,
    manager: setup.manager,
    londonTreasury: 0,
    indiaTreasury: setup.indiaTreasury ?? 0,
    value: setup.value ?? 1,
    shares: {},
    formedTurn: 1,
    tradeBid: setup.bid,
  }));
  const ships: ShipState[] = setups.flatMap((setup) =>
    Array.from({ length: setup.ships }, (_, index) => ({
      id: `firm-ship-${setup.id}-${index + 1}`,
      kind: "player" as const,
      location: `firm:${setup.id}` as const,
      fatigued: false,
    })),
  );
  return {
    ...state,
    parliament: { ...state.parliament, deregulated: true },
    firms,
    company: { ...state.company, ships: [...state.company.ships, ...ships] },
    hidden: {
      ...state.hidden,
      firmStrategySecrets: Object.fromEntries(
        setups.map((setup) => [
          setup.id,
          { firmId: setup.id, committedBy: setup.manager, strategy: setup.strategy, bid: setup.bid, revealed: false },
        ]),
      ),
    },
  };
}

/** A deregulated game about to enter `presidency`'s operations with these firms and a President. */
export function firmTradeGame(
  seed: string,
  presidency: PresidencyId,
  setups: FirmSetup[],
  options: { president?: PlayerId | null; treasury?: number; ships?: number; fromStart?: boolean } = {},
): GameState {
  let state = operationGame(seed);
  state = withSeating(state, [RED, YELLOW, BLUE]);
  const officeId = `president-${presidency.toLowerCase()}`;
  const president = options.president === undefined ? RED : options.president ?? undefined;
  state = withOffice(state, officeId, president, { treasury: options.treasury ?? 10 });
  if (president) {
    state = withWriters(state, president, presidency, 1);
    state = withWriters(state, YELLOW, presidency, 3);
  }
  const zone = { Bombay: "west-indian", Madras: "south-indian", Bengal: "east-indian" }[presidency] as ShipState["location"];
  const companyShips: ShipState[] = Array.from({ length: options.ships ?? 0 }, (_, index) => ({
    id: `test-company-${zone}-${index + 1}`,
    kind: "company",
    location: zone,
    fatigued: false,
  }));
  state = { ...state, company: { ...state.company, ships: [...state.company.ships, ...companyShips] } };
  state = withFirms(state, setups);
  // Every order starts open here; tests close the ones they need closed.
  state = {
    ...state,
    india: {
      ...state.india,
      regions: Object.fromEntries(
        Object.entries(state.india.regions).map(([id, region]) => [id, { ...region, orders: region.orders.map((order) => ({ ...order, closed: false })) }]),
      ),
    },
  };
  return enterOperation(state, options.fromStart ? [] : [...OFFICES_BEFORE[presidency]]);
}
