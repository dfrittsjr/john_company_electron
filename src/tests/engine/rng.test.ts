import { describe, expect, it } from "vitest";
import { createRngState, rollDice, shuffle } from "../../engine";

describe("deterministic RNG", () => {
  it("produces the same dice results and state for the same seed", () => {
    const first = rollDice(createRngState("test-seed"), 8, 6, "fixture");
    const second = rollDice(createRngState("test-seed"), 8, 6, "fixture");

    expect(first.values).toEqual(second.values);
    expect(first.rng).toEqual(second.rng);
    expect(first.roll).toEqual(second.roll);
    expect(first.rng.counter).toBe(8);
  });

  it("uses RNG state for shuffles without mutating the input list", () => {
    const source = ["a", "b", "c", "d", "e"];
    const first = shuffle(createRngState("shuffle-seed"), source);
    const second = shuffle(createRngState("shuffle-seed"), source);

    expect(first.items).toEqual(second.items);
    expect(first.rng).toEqual(second.rng);
    expect(source).toEqual(["a", "b", "c", "d", "e"]);
    expect(first.rng.counter).toBe(source.length - 1);
  });
});
