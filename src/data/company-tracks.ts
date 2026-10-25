import type { CompanyTracksDefinition } from "./types";

// Company Standing and Company Debt tracks, transcribed from board_image-1.png.
export const companyTracks: CompanyTracksDefinition = {
  source: "board_image-1.png",
  standing: [
    { index: 0, label: "F", expectations: null, companyFails: true, lined: false, star: false, deregulationReset: false },
    { index: 1, label: "£4", expectations: 4, companyFails: false, lined: true, star: true, deregulationReset: false },
    { index: 2, label: "£6", expectations: 6, companyFails: false, lined: true, star: false, deregulationReset: false },
    { index: 3, label: "£8", expectations: 8, companyFails: false, lined: true, star: false, deregulationReset: false },
    { index: 4, label: "£10", expectations: 10, companyFails: false, lined: false, star: false, deregulationReset: true },
    { index: 5, label: "£12", expectations: 12, companyFails: false, lined: false, star: false, deregulationReset: false },
    { index: 6, label: "£14", expectations: 14, companyFails: false, lined: false, star: false, deregulationReset: false },
    { index: 7, label: "£16", expectations: 16, companyFails: false, lined: false, star: false, deregulationReset: false },
  ],
  debt: [
    { value: 0, lined: false, star: false },
    { value: 1, lined: false, star: false },
    { value: 2, lined: false, star: false },
    { value: 3, lined: false, star: false },
    { value: 4, lined: false, star: false },
    { value: 5, lined: true, star: false },
    { value: 6, lined: true, star: false },
    { value: 7, lined: true, star: false },
    { value: 8, lined: true, star: true },
  ],
};

export const MAX_COMPANY_DEBT = companyTracks.debt[companyTracks.debt.length - 1].value;
export const MAX_STANDING_SPACE = companyTracks.standing.length - 1;

export const expectationsForStanding = (standingSpace: number): number | null =>
  companyTracks.standing[standingSpace]?.expectations ?? null;
