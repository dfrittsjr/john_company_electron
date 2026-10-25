import { describe, expect, test } from "vitest";
import { lawDeckForScenario, laws, lawsById, startingPassedLaws } from "../../data/laws";

// Expected values read from "John Company Cards (Bridge, Fronts).pdf" printed pages 4-7.
describe("law deck", () => {
  test("has 26 cards numbered 31-56 with unique ids and names", () => {
    expect(laws).toHaveLength(26);
    expect(laws.map((law) => law.number)).toEqual(Array.from({ length: 26 }, (_, i) => 31 + i));
    expect(new Set(laws.map((law) => law.id)).size).toBe(26);
    expect(new Set(laws.map((law) => law.name)).size).toBe(26);
  });

  test("has 20 laws, 5 dilemmas and the Deregulation special session", () => {
    const countOf = (kind: string) => laws.filter((law) => law.kind === kind).length;

    expect(countOf("law")).toBe(20);
    expect(countOf("dilemma")).toBe(5);
    expect(laws.filter((law) => law.kind === "specialSession").map((law) => law.id)).toEqual([
      "deregulation",
    ]);
  });

  test("every card has text, sources, and either structured effects or a handler", () => {
    for (const law of laws) {
      expect(law.text.length, law.id).toBeGreaterThan(0);
      expect(law.source.front, law.id).toMatch(/Bridge, Fronts\)\.pdf p\.\d+ r\dc\d$/);
      expect(law.source.back, law.id).toMatch(/Bridge, Bridge\)\.pdf p\.\d+ r\dc\d$/);
      expect(law.effects.length > 0 || law.effectHandler !== undefined, law.id).toBe(true);
      expect(law.uncertain, law.id).toEqual([]);
    }
  });

  test("every card except Old Ideas Made New! and Deregulation prints a policy icon and support", () => {
    const withoutBanner = laws.filter((law) => law.policyIcon === null).map((law) => law.id);

    expect(withoutBanner.sort()).toEqual(["deregulation", "old-ideas-made-new"]);
    for (const law of laws.filter((candidate) => candidate.policyIcon !== null)) {
      expect(Number.isInteger(law.startingSupport), law.id).toBe(true);
    }
  });

  test("dilemmas with outcomes list both If passed and If failed text", () => {
    for (const law of laws.filter((candidate) => candidate.kind === "dilemma")) {
      if (law.id === "old-ideas-made-new") {
        expect(law.ifPassed).toBeUndefined();
        continue;
      }
      expect(law.ifPassed, law.id).toBeTruthy();
      expect(law.ifFailed, law.id).toBeTruthy();
      expect(law.text).toContain(`If passed: ${law.ifPassed}`);
      expect(law.text).toContain(`If failed: ${law.ifFailed}`);
    }
  });

  test("six laws grant extra family actions", () => {
    expect(
      Object.fromEntries(
        laws.filter((law) => law.extraAction).map((law) => [law.id, law.extraAction!.familyAction]),
      ),
    ).toEqual({
      "calico-acts": "purchase-workshop",
      "army-spending": "enlist-officer",
      "debt-restructure": "seek-share",
      "tenure-limits": "enlist-writer",
      "ship-subsidy": "purchase-shipyard",
      "window-tax-repeal": "purchase-luxury",
    });
    expect(lawsById.get("tenure-limits")!.extraAction).toEqual(
      expect.objectContaining({ restriction: "notAfterEnlistWriter", singlePiece: true }),
    );
  });

  test("discard-each-other laws reference real law ids", () => {
    for (const law of laws) {
      for (const effect of law.effects) {
        if (effect.type === "discardPassedLaw") {
          expect(lawsById.has(effect.lawId), `${law.id} -> ${effect.lawId}`).toBe(true);
        }
      }
    }
  });
});

describe("spot checks against the printed cards", () => {
  test("Calico Acts (rulebook p.34 example)", () => {
    const law = lawsById.get("calico-acts")!;

    expect(law).toEqual(
      expect.objectContaining({
        number: 31,
        kind: "law",
        startingSupport: 1,
        policyIcon: { kind: "target", target: "manufacturing" },
      }),
    );
    expect(law.extraAction?.text).toBe("After taking any family action(s), you may buy a workshop.");
    expect(law.effects).toContainEqual({
      timing: "onPass",
      type: "gainCashPerEnterprise",
      enterpriseType: "manufacturing",
      amount: 2,
    });
    expect(law.text).toContain("lower the Company Balance by £1 for every £7");
  });

  test("Masses Demand Franchise! (rulebook p.34 example)", () => {
    const law = lawsById.get("masses-demand-franchise")!;

    expect(law).toEqual(
      expect.objectContaining({
        number: 54,
        kind: "dilemma",
        startingSupport: 1,
        policyIcon: { kind: "target", target: "social" },
        ifPassed: "Rotten Boroughs are now only worth one vote each. Votes now cost £2 instead of £1.",
        ifFailed: "Nothing happens.",
      }),
    );
  });

  test("support and icons of a range of cards", () => {
    const summary = (id: string) => {
      const law = lawsById.get(id)!;
      return [law.number, law.startingSupport, law.policyIcon];
    };

    expect(summary("envoy-to-china")).toEqual([32, -3, { kind: "target", target: "shipping" }]);
    expect(summary("inclosure-acts")).toEqual([36, -4, { kind: "consequence", consequence: "bonus" }]);
    expect(summary("trade-regulations")).toEqual([40, -1, { kind: "target", target: "shipping" }]);
    expect(summary("zamindar-taxes")).toEqual([41, -2, { kind: "target", target: "companyShare" }]);
    expect(summary("window-tax-repeal")).toEqual([46, -5, { kind: "target", target: "social" }]);
    expect(summary("military-oversight")).toEqual([47, 5, { kind: "target", target: "companyShare" }]);
    expect(summary("royal-protection")).toEqual([50, -3, { kind: "target", target: "social" }]);
    expect(summary("war-against-france")).toEqual([55, 1, { kind: "consequence", consequence: "tax" }]);
  });

  test("Deregulation is a special session with +2/+6 support and a Debtor's Prison back", () => {
    const law = lawsById.get("deregulation")!;

    expect(law.inLawDeck).toBe(false);
    expect(law.variableStartingSupport).toEqual({ oneMarkerOnLinedSpace: 2, bothMarkersOnLinedSpaces: 6 });
    expect(law.usedIn).toEqual(["1758", "1813", "long-1710"]);
    expect(law.backText).toContain("Debtor’s Prison -1");
  });
});

describe("scenario law setup", () => {
  test("starting passed laws follow the scenario cards", () => {
    expect(startingPassedLaws("1710")).toEqual(["royal-protection"]);
    expect(startingPassedLaws("long-1710")).toEqual(["royal-protection"]);
    expect(startingPassedLaws("1758")).toEqual(["calico-acts"]);
    expect(startingPassedLaws("1813").sort()).toEqual(["calico-acts", "deregulation", "military-oversight"]);
  });

  test("the draw deck excludes Deregulation, starting laws, and laws returned to the box", () => {
    expect(lawDeckForScenario("1710")).toHaveLength(24);
    expect(lawDeckForScenario("1710")).not.toContain("royal-protection");
    expect(lawDeckForScenario("1758")).toHaveLength(24);
    expect(lawDeckForScenario("1813")).toHaveLength(22);
    expect(lawDeckForScenario("1813")).not.toContain("governor-general");
    for (const scenario of ["1710", "1758", "1813", "long-1710"] as const) {
      expect(lawDeckForScenario(scenario)).not.toContain("deregulation");
    }
  });
});
