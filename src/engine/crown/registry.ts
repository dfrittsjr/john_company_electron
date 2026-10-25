import { earlyPhasesCrown } from "./areas/early-phases";
import { officesCrown } from "./areas/offices";
import { parliamentCrown } from "./areas/parliament";
import { presidenciesCrown } from "./areas/presidencies";
import type { CrownArea, CrownCubeDetector, CrownFavorDefinition, CrownPolicy } from "./kit";

// Every Crown area, composed. Areas only import ./kit.ts and ./state.ts (plus engine helpers), so
// nothing they load comes back here.
const AREAS: CrownArea[] = [earlyPhasesCrown, officesCrown, presidenciesCrown, parliamentCrown];

let policies: Map<string, CrownPolicy> | undefined;
let prefixes: Array<[string, CrownPolicy]> | undefined;

function build(): void {
  policies = new Map();
  prefixes = [];
  for (const area of AREAS) {
    for (const [step, policy] of Object.entries(area.policies)) {
      if (step.endsWith("*")) prefixes.push([step.slice(0, -1), policy]);
      else if (policies.has(step)) throw new Error(`Two Crown policies for step "${step}".`);
      else policies.set(step, policy);
    }
  }
  // Longest prefix first.
  prefixes.sort(([a], [b]) => b.length - a.length);
}

/** The policy for a decision step: an exact key, else the longest matching "prefix*" key. */
export function crownPolicyFor(step: string): CrownPolicy | undefined {
  if (!policies) build();
  return policies!.get(step) ?? prefixes!.find(([prefix]) => step.startsWith(prefix))?.[1];
}

export function crownFavorDefinitions(): CrownFavorDefinition[] {
  return AREAS.flatMap((area) => area.favors);
}

export function crownCubeDetectors(): CrownCubeDetector[] {
  return AREAS.flatMap((area) => area.detectors);
}

/** For the coverage test: every area as registered. */
export function crownAreas(): readonly CrownArea[] {
  return AREAS;
}
