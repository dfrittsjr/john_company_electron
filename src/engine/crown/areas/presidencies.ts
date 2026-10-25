import type { CrownArea } from "../kit";
import { presidencyDetectors, presidencyFavors } from "./presidencies-favors";
import { presidencyPolicies } from "./presidencies-policies";

// The Crown in Presidency operations, Governors, Commanders, Presidents, Trade in China (pp.10-13),
// Events in India and Revenue (p.14). Policies: ./presidencies-policies.ts; favours and cube
// detectors: ./presidencies-favors.ts; what they share: ./presidencies-shared.ts.
export const presidenciesCrown: CrownArea = {
  pages: [10, 11, 12, 13, 14],
  policies: presidencyPolicies,
  favors: presidencyFavors,
  detectors: presidencyDetectors,
  notDone: [],
};
