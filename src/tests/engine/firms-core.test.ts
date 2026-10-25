import { describe, expect, it } from "vitest";
import {
  dissolveFirm,
  firmById,
  firmInvestmentSources,
  firmManagedBy,
  firmName,
  firmShareTotal,
  firmShareVictoryPoints,
  formFirm,
  formFirmBlockReason,
  investInFirm,
  mergeFirms,
  takeOverFirm,
  transferFirmShares,
  weakCompanySharesReason,
  type GameState,
} from "../../engine";
import { expectFamilyPiecesConserved } from "../fixtures/game";
import { BLUE, RED, YELLOW, deregulatedGame, withCompanyShares, withWorkshop } from "../fixtures/firms";

function redFirm(state: GameState = deregulatedGame()) {
  const ready = withWorkshop(state, RED);
  return formFirm(ready, RED, { kind: "workshop", enterpriseId: `workshop-${RED}` });
}

describe("forming and investing (p.38)", () => {
  it("forms a firm from a workshop: invested workshop, one share from supply, Value 1, £5 in London", () => {
    const before = withWorkshop(deregulatedGame(), RED);
    const supply = before.players[RED].familyMembers.supply;
    const { state, firmId } = formFirm(before, RED, { kind: "workshop", enterpriseId: `workshop-${RED}` });
    const firm = firmById(state, firmId)!;
    expect(firm).toMatchObject({ manager: RED, londonTreasury: 5, indiaTreasury: 0, value: 1, shares: { [RED]: 1 } });
    expect(firmName(state, firm)).toBe("Benyon & Co.");
    expect(state.players[RED].enterprises[0].invested).toBe(true);
    expect(state.players[RED].familyMembers.supply).toBe(supply - 1);
    expect(firmInvestmentSources(state, RED)).toEqual([]);
    expectFamilyPiecesConserved(state);
  });

  it("forms a firm from a Company share: the share goes back to supply and becomes the first firm share", () => {
    const before = withCompanyShares(deregulatedGame(), [BLUE]);
    const supply = before.players[BLUE].familyMembers.supply;
    const { state, firmId } = formFirm(before, BLUE, { kind: "companyShare", shareId: `court-${BLUE}-1` });
    expect(state.company.court.some((share) => share.owner === BLUE)).toBe(false);
    expect(state.players[BLUE].familyMembers.supply).toBe(supply);
    expect(firmById(state, firmId)!.shares).toEqual({ [BLUE]: 1 });
    expectFamilyPiecesConserved(state);
  });

  it("refuses weak and immature Company shares, a second firm, and firms before Deregulation", () => {
    const weak = withCompanyShares({ ...deregulatedGame(), company: { ...deregulatedGame().company, debt: 5 } }, [RED]);
    expect(weakCompanySharesReason(weak)).toMatch(/Debt/);
    expect(firmInvestmentSources(weak, RED)).toEqual([]);

    const fresh = deregulatedGame();
    const immature = withCompanyShares(fresh, [RED], fresh.turn);
    expect(firmInvestmentSources(immature, RED)).toEqual([]);

    const { state } = redFirm();
    const again = withWorkshop(state, RED, "workshop-2");
    expect(formFirmBlockReason(again, RED, { kind: "workshop", enterpriseId: "workshop-2" })).toMatch(/already manage/);

    const regulated = withWorkshop({ ...deregulatedGame(), parliament: { ...deregulatedGame().parliament, deregulated: false } }, RED);
    expect(formFirmBlockReason(regulated, RED, { kind: "workshop", enterpriseId: `workshop-${RED}` })).toMatch(/Deregulation/);
  });

  it("invests: £5 to London and a share, but no share past 10; an emergency investment lowers Value", () => {
    let { state, firmId } = redFirm();
    state = withWorkshop(state, BLUE);
    state = investInFirm(state, firmId, BLUE, { kind: "workshop", enterpriseId: `workshop-${BLUE}` }).state;
    expect(firmById(state, firmId)).toMatchObject({ londonTreasury: 10, shares: { [RED]: 1, [BLUE]: 1 } });

    // Fill to 10 shares.
    state = { ...state, firms: state.firms!.map((firm) => ({ ...firm, shares: { [RED]: 1, [BLUE]: 9 } })) };
    state = { ...state, players: { ...state.players, [BLUE]: { ...state.players[BLUE], familyMembers: { ...state.players[BLUE].familyMembers, supply: state.players[BLUE].familyMembers.supply - 8 } } } };
    state = withCompanyShares(state, [YELLOW]);
    state = { ...state, firms: state.firms!.map((firm) => ({ ...firm, value: 4 })) };
    const full = investInFirm(state, firmId, YELLOW, { kind: "companyShare", shareId: `court-${YELLOW}-1` }, { emergency: true });
    expect(full.createdShare).toBe(false);
    expect(firmShareTotal(firmById(full.state, firmId)!)).toBe(10);
    expect(firmById(full.state, firmId)).toMatchObject({ londonTreasury: 15, value: 3 });
    expectFamilyPiecesConserved(full.state);
  });
});

describe("dissolving, merging and takeovers (pp.39, 41)", () => {
  it("dissolves: shares to Debtor's Prison, ships back to their shipyards", () => {
    let { state, firmId } = redFirm();
    state = withWorkshop(state, BLUE);
    state = investInFirm(state, firmId, BLUE, { kind: "workshop", enterpriseId: `workshop-${BLUE}` }).state;
    state = { ...state, company: { ...state.company, ships: [...state.company.ships, { id: "ship-x", kind: "player", shipyardCardId: "yard", location: `firm:${firmId}`, fatigued: true }] } };
    const after = dissolveFirm(state, firmId);
    expect(firmManagedBy(after, RED)).toBeUndefined();
    expect(after.players[RED].familyMembers.debtorPrison).toBe(1);
    expect(after.players[BLUE].familyMembers.debtorPrison).toBe(1);
    expect(after.company.ships.find((ship) => ship.id === "ship-x")).toMatchObject({ location: "shipyard", fatigued: false });
    expect(after.players[RED].enterprises[0].invested).toBe(true);
    expectFamilyPiecesConserved(after);
  });

  it("merges into the primary firm, returning excess shares to supply", () => {
    let state = withWorkshop(withWorkshop(deregulatedGame(), RED), BLUE);
    const red = formFirm(state, RED, { kind: "workshop", enterpriseId: `workshop-${RED}` });
    const blue = formFirm(red.state, BLUE, { kind: "workshop", enterpriseId: `workshop-${BLUE}` });
    state = { ...blue.state, firms: blue.state.firms!.map((firm) => (firm.id === red.firmId ? { ...firm, value: 5, indiaTreasury: 4 } : { ...firm, londonTreasury: 7 })) };
    const merged = mergeFirms(state, red.firmId, [blue.firmId]);
    expect(merged.firms).toHaveLength(1);
    expect(firmById(merged, red.firmId)).toMatchObject({ manager: RED, value: 5, londonTreasury: 12, indiaTreasury: 4, shares: { [RED]: 1, [BLUE]: 1 } });
    expect(firmManagedBy(merged, BLUE)).toBeUndefined();

    const returned = mergeFirms(state, red.firmId, [blue.firmId], { [BLUE]: 1 });
    expect(firmById(returned, red.firmId)!.shares).toEqual({ [RED]: 1 });
    expect(returned.players[BLUE].familyMembers.supply).toBe(state.players[BLUE].familyMembers.supply + 1);
    expectFamilyPiecesConserved(returned);
  });

  it("takes over a firm and trades shares", () => {
    let { state, firmId } = redFirm();
    state = takeOverFirm(state, firmId, YELLOW);
    expect(firmManagedBy(state, YELLOW)?.id).toBe(firmId);
    expect(firmName(state, firmById(state, firmId)!)).toBe("Larkins & Co.");
    state = transferFirmShares(state, firmId, RED, BLUE, 1);
    expect(firmById(state, firmId)!.shares).toEqual({ [BLUE]: 1 });
    expect(() => takeOverFirm(redFirm(withWorkshop(deregulatedGame(), YELLOW)).state, firmId, RED)).toThrow();
  });
});

describe("firm share scoring (charter)", () => {
  it("reads the Value track", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(firmShareVictoryPoints)).toEqual([-1, 0, 0.5, 0.5, 1, 1, 1, 1.5, 1.5, 2]);
  });
});
