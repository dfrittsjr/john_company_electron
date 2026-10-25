import { describe, expect, test } from "vitest";
import {
  RULES_ATTRIBUTION,
  highlightParts,
  ruleSectionForPhase,
  rulesSections,
  searchRuleSections,
  type RuleSection,
} from "../../data/rules-text";
import type { PhaseId } from "../../engine/types";

function sectionText(id: string): string {
  const section = rulesSections.find((candidate) => candidate.id === id) as RuleSection;
  return section.blocks.map((block) => (block.kind === "ul" ? (block.items ?? []).join("\n") : block.text)).join("\n");
}

describe("rules text", () => {
  test("section ids are unique and every section has content", () => {
    const ids = rulesSections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of rulesSections) {
      expect(section.blocks.length, section.id).toBeGreaterThan(0);
      expect(section.pages, section.id).not.toBe("");
    }
  });

  test("every phase from London Season to Final Scoring has a section", () => {
    const phases: PhaseId[] = [
      "londonSeason",
      "family",
      "firms",
      "hiring",
      "companyOperation",
      "bonuses",
      "revenue",
      "eventsInIndia",
      "parliament",
      "upkeep",
      "finalScoring",
    ];
    for (const phase of phases) {
      expect(ruleSectionForPhase(phase), phase).toBeDefined();
    }
  });

  test("sub-sections point at real parents and the unsupported rules are marked", () => {
    const ids = new Set(rulesSections.map((section) => section.id));
    for (const section of rulesSections) {
      if (section.parentId) expect(ids.has(section.parentId), section.id).toBe(true);
    }
    expect(rulesSections.filter((section) => section.notInApp).map((section) => section.id)).toEqual([
      "one-or-two",
    ]);
  });

  test("search finds emergency loans in Revenue", () => {
    const found = searchRuleSections("emergency loan").map((section) => section.id);
    expect(found).toContain("revenue");
    expect(searchRuleSections("")).toHaveLength(rulesSections.length);
    expect(searchRuleSections("zzzz no such rule")).toEqual([]);
  });

  test("highlighting marks each matching word", () => {
    const parts = highlightParts("Emergency loans are loans.", "loan emergency");
    expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual(["Emergency", "loan", "loan"]);
    expect(parts.map((part) => part.text).join("")).toBe("Emergency loans are loans.");
  });

  test("carries the attribution", () => {
    expect(RULES_ATTRIBUTION).toContain("Cole Wehrle");
    expect(RULES_ATTRIBUTION).toContain("CC BY-NC-SA 4.0");
  });

  test("keeps sentences exactly as the rulebook words them", () => {
    expect(sectionText("revenue")).toContain(
      "Lower it two spaces if three or more emergency loans were taken this turn.",
    );
    expect(sectionText("london-season")).toContain(
      "Each fatigue on a card adds +1 to the result of that office’s die roll.",
    );
    expect(sectionText("success-checks")).toContain("Use the lowest rolled value to determine one of three results.");
  });
});
