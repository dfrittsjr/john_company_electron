import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { lawInstance } from "../engine/phases/parliament.state";
import { createHotseatGame } from "../tests/fixtures/game";
import { ParliamentPanel } from "./ParliamentPanel";
import { installFlexGapFallback } from "./platform/flex-gap-fallback";
import { enterpriseName } from "./view-model";

afterEach(cleanup);

describe("Laws panel", () => {
  test("shows the Prime Minister, the dial arm, and passed laws with their text", () => {
    const base = createHotseatGame();
    const game = {
      ...base,
      parliament: { ...base.parliament, primeMinister: "player-blue", passedLaws: [lawInstance("royal-protection")] },
    };
    render(<ParliamentPanel game={game} />);

    expect(screen.getByText("Blue")).toBeTruthy();
    expect(screen.getByText("Royal Protection")).toBeTruthy();
    expect(screen.getByText(/emergency loans/)).toBeTruthy();
    expect(screen.getByText(/← arm/)).toBeTruthy();
  });
});

describe("trade panel names", () => {
  test("names shipyards, workshops, and luxuries instead of card ids", () => {
    expect(enterpriseName("shipyard-01", "shipyard")).toBe("Shipyard: Atlas");
    expect(enterpriseName("workshop-03", "workshop")).toBe("Workshop 03");
    expect(enterpriseName(undefined, "luxury")).toBe("Luxury");
  });
});

describe("flex gap fallback", () => {
  test("copies a flex row's gap onto its children when the browser lacks flex gap", () => {
    // jsdom does no layout, so the feature test reports no flex-gap support.
    const root = document.createElement("div");
    root.innerHTML = '<div id="row" style="display:flex;column-gap:12px"><span>a</span><span>b</span></div>';
    document.body.append(root);
    const stop = installFlexGapFallback(root);

    const [first, second] = Array.from(root.querySelectorAll("span")) as HTMLElement[];
    expect(first.style.marginLeft).toBe("");
    expect(second.style.marginLeft).toBe("12px");

    stop();
    root.remove();
    vi.restoreAllMocks();
  });
});
