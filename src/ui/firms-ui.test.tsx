import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { firmById, formFirm, projectForViewer, withFirm, type GameState, type ShipState } from "../engine";
import { BLUE, RED, deregulatedGame, withWorkshop } from "../tests/fixtures/firms";
import { createHotseatGame } from "../tests/fixtures/game";
import { App } from "./App";
import { BoardView } from "./BoardView";
import { DecisionPanel } from "./DecisionPanel";
import { deregulationStatus, formatVictoryPoints } from "./firm-view";
import { ParliamentPanel } from "./ParliamentPanel";
import { PlayerDashboards } from "./PlayerDashboards";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Red manages Benyon & Co. (Value 7, 3 shares of Red and 2 of Blue, two ships, one fatigued). */
function firmGame(): GameState {
  const base = withWorkshop(deregulatedGame(), RED);
  const { state, firmId } = formFirm(base, RED, { kind: "workshop", enterpriseId: `workshop-${RED}` });
  const firm = firmById(state, firmId)!;
  const ships: ShipState[] = [
    { id: "firm-ship-1", kind: "player", location: `firm:${firmId}`, fatigued: false },
    { id: "firm-ship-2", kind: "player", location: `firm:${firmId}`, fatigued: true },
  ];
  const withShips: GameState = { ...state, company: { ...state.company, ships: [...state.company.ships, ...ships] } };
  const blue = withShips.players[BLUE];
  const game = withFirm(withShips, { ...firm, value: 7, londonTreasury: 8, indiaTreasury: 3, dividendCube: 4, shares: { [RED]: 3, [BLUE]: 2 } });
  return {
    ...game,
    players: { ...game.players, [BLUE]: { ...blue, familyMembers: { ...blue.familyMembers, debtorPrison: 2 } } },
    hidden: {
      ...game.hidden,
      firmStrategySecrets: { [firmId]: { firmId, committedBy: RED, strategy: "south-indian", bid: 4 } },
    },
  };
}

function dashboard(name: string) {
  return within(screen.getByLabelText(`${name} dashboard`));
}

describe("firm charter on the dashboards", () => {
  test("shows treasuries, Value with VP per share, dividend cube, shares and ships", () => {
    const game = firmGame();
    render(<PlayerDashboards game={game} revealedPlayer={null} />);
    const charter = within(screen.getByLabelText("Benyon & Co. charter"));
    expect(charter.getByText("London").nextElementSibling?.textContent).toBe("£8");
    expect(charter.getByText("India").nextElementSibling?.textContent).toBe("£3");
    expect(charter.getByText("Value").nextElementSibling?.textContent).toBe("7/10 (1 VP a share)");
    expect(charter.getByText("Dividend cube").nextElementSibling?.textContent).toBe("£4");
    expect(charter.getByText("Ships").nextElementSibling?.textContent).toBe("2 (1 fatigued)");
    expect(charter.getByText("Trade bid").nextElementSibling?.textContent).toBe("none yet");
    expect(charter.getByText(/Shares 5\/10: Red 3, Blue 2/)).toBeTruthy();
    expect(dashboard("Red").getAllByText(/Benyon & Co\./).length).toBeGreaterThan(0);
  });

  test("a fresh firm says its dividend cube is not placed", () => {
    const game = firmGame();
    const firm = game.firms![0];
    render(<PlayerDashboards game={withFirm(game, { ...firm, dividendCube: undefined, tradeBid: 2 })} revealedPlayer={null} />);
    const charter = within(screen.getByLabelText("Benyon & Co. charter"));
    expect(charter.getByText("Dividend cube").nextElementSibling?.textContent).toBe("not placed");
    expect(charter.getByText("Trade bid").nextElementSibling?.textContent).toBe("£2");
  });

  test("every dashboard shows firm shares held, Debtor's Prison and invested workshops", () => {
    render(<PlayerDashboards game={firmGame()} revealedPlayer={null} />);
    expect(dashboard("Blue").getByText(/Firm shares: Benyon & Co\. 2 \(2 VP now\)/)).toBeTruthy();
    expect(dashboard("Blue").getByText(/Debtor.s Prison: 2 \(-2 VP at the end\)/)).toBeTruthy();
    expect(dashboard("Red").getByText(/invested in a firm/)).toBeTruthy();
    expect(dashboard("Yellow").queryByText(/Firm shares/)).toBeNull();
  });

  test("shows the revealed strategy, dice, successes, initiative and income", () => {
    const game = firmGame();
    const firm = game.firms![0];
    const revealed = withFirm(game, { ...firm, trade: { strategy: "south-indian", dice: 4, successes: 2, initiative: 0, income: 16 } });
    render(<PlayerDashboards game={revealed} revealedPlayer={null} />);
    const charter = within(screen.getByLabelText("Benyon & Co. charter"));
    expect(charter.getByText(/Strategy: South Indian Ocean \(revealed\)/)).toBeTruthy();
    expect(charter.getByText(/Trade: 4 dice, 2 successes, initiative 0, income £16/)).toBeTruthy();
  });
});

describe("hotseat strategy secrecy", () => {
  test("the table sees only that a strategy was chosen", () => {
    render(<PlayerDashboards game={firmGame()} revealedPlayer={null} />);
    expect(screen.getByText(/Strategy: chosen, secret until its Presidency/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/South Indian/);
  });

  test("another player holding the device does not see it either", () => {
    render(<PlayerDashboards game={firmGame()} revealedPlayer={BLUE} />);
    expect(document.body.textContent).not.toMatch(/South Indian/);
  });

  test("its manager sees strategy and bid once they hold the device", () => {
    render(<PlayerDashboards game={firmGame()} revealedPlayer={RED} />);
    expect(screen.getByText(/Strategy: South Indian Ocean, bid £4 \(secret/)).toBeTruthy();
  });

  test("a revealed strategy is public", () => {
    const game = firmGame();
    const id = game.firms![0].id;
    const revealed: GameState = {
      ...game,
      hidden: { ...game.hidden, firmStrategySecrets: { [id]: { ...game.hidden.firmStrategySecrets[id], revealed: true } } },
    };
    render(<PlayerDashboards game={revealed} revealedPlayer={null} />);
    expect(screen.getByText(/Strategy: South Indian Ocean \(revealed\)/)).toBeTruthy();
  });

  test("an online view with the strategy stripped, or the secret missing, still renders", () => {
    const game = firmGame();
    const view = projectForViewer(game, { kind: "seat", playerId: BLUE });
    render(<PlayerDashboards game={view} revealedPlayer={BLUE} />);
    expect(screen.getByText(/Strategy: chosen, secret until its Presidency/)).toBeTruthy();
    cleanup();
    render(<PlayerDashboards game={{ ...game, hidden: { ...game.hidden, firmStrategySecrets: {} } }} revealedPlayer={null} />);
    expect(screen.getByText(/Strategy: not chosen yet/)).toBeTruthy();
    cleanup();
    const noFirms = { ...createHotseatGame(), firms: undefined };
    render(<PlayerDashboards game={noFirms} revealedPlayer={null} />);
    expect(screen.queryByLabelText(/charter/)).toBeNull();
  });

  test("the manager's own online view shows their strategy", () => {
    const view = projectForViewer(firmGame(), { kind: "seat", playerId: RED });
    render(<PlayerDashboards game={view} revealedPlayer={RED} />);
    expect(screen.getByText(/South Indian Ocean, bid £4/)).toBeTruthy();
  });
});

describe("Deregulation status", () => {
  test("is absent in plain 1710 and tracks the vote rules in Long 1710", () => {
    const plain = createHotseatGame();
    expect(deregulationStatus(plain).kind).toBe("unavailable");
    render(<ParliamentPanel game={plain} />);
    expect(screen.queryByLabelText("Deregulation")).toBeNull();
    cleanup();

    const long: GameState = { ...plain, scenario: "long-1710", finalTurn: 8 };
    expect(deregulationStatus({ ...long, company: { ...long.company, standing: 4, debt: 0 } }).kind).toBe("not-yet");
    expect(deregulationStatus({ ...long, company: { ...long.company, standing: 3, debt: 0 } }).kind).toBe("may");
    expect(deregulationStatus({ ...long, company: { ...long.company, standing: 4, debt: 5 } }).kind).toBe("may");
    expect(deregulationStatus({ ...long, company: { ...long.company, standing: 4, debt: 8 } }).kind).toBe("must");
    expect(deregulationStatus({ ...long, company: { ...long.company, standing: 1, debt: 0 } }).kind).toBe("must");

    render(<ParliamentPanel game={{ ...long, company: { ...long.company, standing: 4, debt: 8 } }} />);
    expect(within(screen.getByLabelText("Deregulation")).getByText(/must call a Vote to Deregulate/)).toBeTruthy();
  });

  test("says so once the Company is deregulated", () => {
    render(<ParliamentPanel game={deregulatedGame()} />);
    expect(within(screen.getByLabelText("Deregulation")).getByText("Deregulated.")).toBeTruthy();
  });

  test("formats half points", () => {
    expect([-1, 0, 0.5, 1, 1.5, 2].map(formatVictoryPoints)).toEqual(["-1", "0", "½", "1", "1½", "2"]);
  });
});

describe("firm-filled orders on the board", () => {
  test("read differently from Company-filled ones, with the firm named", () => {
    const game = firmGame();
    const firmId = game.firms![0].id;
    const orders = Object.values(game.india.regions).flatMap((region) => region.orders).filter((order) => !order.closed && !order.writer);
    const [byCompany, byFirm, byBoth] = orders;
    const state = fillOrders(game, { [byCompany.id]: ["company"], [byFirm.id]: [firmId], [byBoth.id]: [firmId, "company"] });
    const { container } = render(
      <BoardView game={state} highlights={new Set()} focus={new Set()} selected={null} onSelect={() => {}} />,
    );
    const mark = (id: string) => container.querySelector(`[data-target="order:${id}"]`)!;
    expect(mark(byCompany.id).querySelector(".filled-order")?.getAttribute("class")).toBe("filled-order");
    expect(mark(byFirm.id).querySelector(".filled-order-firm")).toBeTruthy();
    expect(mark(byBoth.id).querySelector(".filled-order-both")).toBeTruthy();
    expect(mark(byCompany.id).querySelector("title")?.textContent).toMatch(/filled this turn by the Company/);
    expect(mark(byFirm.id).querySelector("title")?.textContent).toMatch(/filled this turn by Benyon & Co\./);
    expect(mark(byFirm.id).textContent).toContain("firm");
  });
});

function fillOrders(game: GameState, fills: Record<string, string[]>): GameState {
  return {
    ...game,
    india: {
      ...game.india,
      regions: Object.fromEntries(
        Object.entries(game.india.regions).map(([key, region]) => [
          key,
          { ...region, orders: region.orders.map((order) => (fills[order.id] ? { ...order, filledThisTurnBy: fills[order.id] } : order)) },
        ]),
      ),
    },
  };
}

describe("Firms phase decisions", () => {
  test("a long option list stays usable and the rules link opens the Deregulation pages", () => {
    const game = firmGame();
    const commands = Array.from({ length: 40 }, (_, index) => ({
      type: "firms.invest",
      label: `Invest in firm ${index}`,
      description: `Pay with source ${index}`,
      payload: { firmId: "firm-1", source: `share-${index}` },
    }));
    const state: GameState = {
      ...game,
      phase: "firms",
      pendingDecision: { ...game.pendingDecision, actor: RED, visibility: "public", prompt: "Firm investments.", legalCommands: commands },
    };
    const onOpenRules = vi.fn();
    render(
      <DecisionPanel
        game={state}
        hidden={false}
        onReveal={() => {}}
        onRun={() => {}}
        onHover={() => {}}
        filter={null}
        onClearFilter={() => {}}
        error={null}
        onOpenRules={onOpenRules}
      />,
    );
    expect(screen.getByText(/Turn 1 of 8 · Firms/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Invest in firm/ })).toHaveLength(40);
    fireEvent.click(screen.getByRole("button", { name: "Rules for this phase" }));
    expect(onOpenRules).toHaveBeenCalledWith("deregulation");
  });
});

describe("scenario choice (hotseat)", () => {
  test("Long 1710, 1758 and 1813 can be picked and started", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New Game" }));
    const radio = (name: string) => screen.getByRole("radio", { name: new RegExp(`^${name}`) }) as HTMLInputElement;
    expect(radio("1758").disabled).toBe(false);
    expect(radio("1813").disabled).toBe(false);
    expect(radio("1710").disabled).toBe(false);
    fireEvent.click(radio("Long 1710"));
    expect(radio("Long 1710").checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByText("John Company · long-1710")).toBeTruthy();
    expect(screen.getByText(/Turn 1 · /)).toBeTruthy();
    expect(screen.getByText("Deregulation")).toBeTruthy();
  });

  test("1813 says it is best with 5 or 6 players and starts with 4", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New Game" }));
    const radio = screen.getByRole("radio", { name: /^1813/ }) as HTMLInputElement;
    expect(screen.getByText(/Best with 5 or 6 players/)).toBeTruthy();
    fireEvent.click(radio);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByText("John Company · 1813")).toBeTruthy();
    expect(screen.getByText(/Turn 5 · /)).toBeTruthy();
  });
});
