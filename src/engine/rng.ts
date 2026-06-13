import type { RngRollRecord, RngState } from "./types";

const UINT32_MAX_PLUS_ONE = 0x100000000;

export function createRngState(seed: string): RngState {
  const internalState = seedToXoshiroState(seed);

  return {
    algorithm: "xoshiro128ss",
    seed,
    counter: 0,
    internalState,
  };
}

export function nextUint32(rng: RngState): { rng: RngState; value: number } {
  assertSupportedRng(rng);

  const [s0, s1, s2, s3] = rng.internalState;
  const value = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
  const t = (s1 << 9) >>> 0;

  const nextState: [number, number, number, number] = [
    (s0 ^ s2) >>> 0,
    (s1 ^ s3) >>> 0,
    (s2 ^ t) >>> 0,
    rotl(s3, 11),
  ];

  nextState[2] = (nextState[2] ^ nextState[0]) >>> 0;
  nextState[3] = (nextState[3] ^ nextState[1]) >>> 0;
  nextState[1] = (nextState[1] ^ nextState[2]) >>> 0;
  nextState[0] = (nextState[0] ^ nextState[3]) >>> 0;

  return {
    value,
    rng: {
      ...rng,
      counter: rng.counter + 1,
      internalState: nextState,
    },
  };
}

export function nextFloat(rng: RngState): { rng: RngState; value: number } {
  const next = nextUint32(rng);

  return {
    rng: next.rng,
    value: next.value / UINT32_MAX_PLUS_ONE,
  };
}

export function rollDie(
  rng: RngState,
  sides: number,
  label = `d${sides}`,
): { rng: RngState; value: number; roll: RngRollRecord } {
  if (!Number.isInteger(sides) || sides < 2) {
    throw new Error(`Die sides must be an integer greater than 1. Received ${sides}.`);
  }

  const startCounter = rng.counter;
  const next = nextUint32(rng);
  const value = (next.value % sides) + 1;

  return {
    rng: next.rng,
    value,
    roll: {
      algorithm: rng.algorithm,
      seed: rng.seed,
      startCounter,
      endCounter: next.rng.counter,
      label,
      values: [value],
    },
  };
}

export function rollDice(
  rng: RngState,
  count: number,
  sides: number,
  label = `${count}d${sides}`,
): { rng: RngState; values: number[]; roll: RngRollRecord } {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`Dice count must be a positive integer. Received ${count}.`);
  }

  const values: number[] = [];
  const startCounter = rng.counter;
  let nextRng = rng;

  for (let index = 0; index < count; index += 1) {
    const result = rollDie(nextRng, sides, label);
    nextRng = result.rng;
    values.push(result.value);
  }

  return {
    rng: nextRng,
    values,
    roll: {
      algorithm: rng.algorithm,
      seed: rng.seed,
      startCounter,
      endCounter: nextRng.counter,
      label,
      values,
    },
  };
}

export function shuffle<T>(
  rng: RngState,
  items: readonly T[],
): { rng: RngState; items: T[]; rolls: RngRollRecord[] } {
  const shuffled = [...items];
  const rolls: RngRollRecord[] = [];
  let nextRng = rng;

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const startCounter = nextRng.counter;
    const next = nextUint32(nextRng);
    nextRng = next.rng;

    const swapIndex = next.value % (index + 1);
    const current = shuffled[index] as T;
    shuffled[index] = shuffled[swapIndex] as T;
    shuffled[swapIndex] = current;
    rolls.push({
      algorithm: rng.algorithm,
      seed: rng.seed,
      startCounter,
      endCounter: nextRng.counter,
      label: `shuffle[${index}]`,
      values: [swapIndex],
    });
  }

  return { rng: nextRng, items: shuffled, rolls };
}

function assertSupportedRng(rng: RngState): void {
  if (rng.algorithm !== "xoshiro128ss") {
    throw new Error(`Unsupported RNG algorithm: ${rng.algorithm}`);
  }

  if (rng.internalState.length !== 4) {
    throw new Error("xoshiro128ss requires four internal state words.");
  }
}

function seedToXoshiroState(seed: string): [number, number, number, number] {
  const state = cyrb128(seed);

  if (state.every((word) => word === 0)) {
    return [0x9e3779b9, 0x243f6a88, 0xb7e15162, 0x8aed2a6b];
  }

  return state;
}

function cyrb128(input: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }

  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);

  h1 = (h1 ^ h2 ^ h3 ^ h4) >>> 0;
  h2 = (h2 ^ h1) >>> 0;
  h3 = (h3 ^ h1) >>> 0;
  h4 = (h4 ^ h1) >>> 0;

  return [h1, h2, h3, h4];
}

function rotl(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}
