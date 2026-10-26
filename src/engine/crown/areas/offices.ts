import type { CrownArea } from "../kit";
import { officesDetectors, officesFavors } from "./offices-favors";
import {
  chairmanPolicy,
  debtConsentPolicy,
  directorPolicy,
  governorGeneralPolicy,
  militaryPolicy,
  shippingPolicy,
} from "./offices-plans";

// The Crown in Chairman, Director of Trade / Governor General, Manager of Shipping and Military
// Affairs (Handbook pp.4-9). The rules are in ./offices-plans.ts, the favours in ./offices-favors.ts.
//
// Set Climate (pp.4-5) is not a policy: the engine flips the AI card in the command that ends a human
// Chairman's turn, or that starts Company Operation when the Crown is Chairman (company-operation.ts).
export const officesCrown: CrownArea = {
  pages: [4, 5, 6, 7, 8, 9],
  policies: {
    "companyOperation.chairman": chairmanPolicy,
    "companyOperation.debtConsent": debtConsentPolicy,
    "companyOperation.directorOfTrade.*": directorPolicy,
    "companyOperation.governorGeneral.*": governorGeneralPolicy,
    "companyOperation.shipping": shippingPolicy,
    "companyOperation.militaryAffairs.*": militaryPolicy,
  },
  favors: officesFavors,
  detectors: officesDetectors,
  notDone: [],
};
