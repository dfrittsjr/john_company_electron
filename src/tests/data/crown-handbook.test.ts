import { describe, expect, test } from "vitest";
import { CROWN_CLIMATES, crownBoardFavors, crownHandbook, crownRulebookPages, type CrownFavor } from "../../data";

// The Crown Handbook, transcribed twice and compared (src/data/crown-handbook.ts). These spot
// checks pin values both transcriptions agreed on.

const favors = (): CrownFavor[] => crownHandbook.flatMap((page) => page.sections.flatMap((section) => section.favors ?? []));
const favor = (start: string) => favors().find((candidate) => candidate.text.startsWith(start));

describe("Crown Handbook data", () => {
  test("covers pages 2-16 and the rulebook's pp.43-46", () => {
    expect(crownHandbook.map((page) => page.page)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(crownRulebookPages.map((page) => page.page)).toEqual([43, 44, 45, 46]);
  });

  test("a climate-dependent favour gives a cost for every climate", () => {
    const byClimate = favors().filter((candidate) => typeof candidate.cost === "object");
    expect(byClimate.length).toBeGreaterThan(20);
    for (const candidate of byClimate) {
      expect(Object.keys(candidate.cost)).toEqual([...CROWN_CLIMATES]);
    }
  });

  test("spot checks (Handbook pp.3, 4, 14)", () => {
    expect(favor("Take a share from the Crown")?.cost).toEqual({ bull: "-6", stag: "-4", lion: "-4", bear: "-3", peacock: "-3" });
    expect(favor("Give a share to the Crown")?.cost).toEqual({ bull: "+2", stag: "-3", lion: "-3", bear: "-4", peacock: "-4" });
    expect(favor("Consent from Crown shares for the first additional advancement")?.cost).toEqual({
      bull: "-1",
      stag: "-2",
      lion: "-3",
      bear: "-4",
      peacock: "-6",
    });
    expect(favor("If you form a private firm")).toMatchObject({ cost: "-3", mandatory: true });
    const revenue = crownHandbook.find((page) => page.page === 14)!.sections.flatMap((section) => section.tables ?? []);
    expect(revenue.some((table) => JSON.stringify(table.rows) === JSON.stringify([["£0", "£2", "£4", "£6", "£8"]]))).toBe(true);
  });

  test("the voting plan names its laws", () => {
    const plan = crownHandbook.find((page) => page.page === 16)!.sections.flatMap((section) => section.tables ?? [])[0];
    const laws = plan.rows.map((row) => row[0]);
    expect(laws).toEqual(expect.arrayContaining(["Army Spending", "Board of Control", "Debt Restructure", "Governor General"]));
  });

  test("the Crown board's favours (Punchboard p.7)", () => {
    expect(crownBoardFavors).toHaveLength(8);
    expect(crownBoardFavors[4]).toEqual({ text: "Give (or take) a luxury.", gain: "+5", take: "-7" });
  });
});
