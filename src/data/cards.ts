// Prestige, blackmail, Company failure, and promise cards, transcribed from the print-and-play
// card sheets in printnplay/Cards. Card text is verbatim; numbers in `cardNumber` are the small
// index printed in each card's bottom-right corner.

export type CardSourceRef = string;

/** Enterprise types, named as on the Power track: shipyards, workshops, luxuries. */
export type EnterpriseKind = "shipping" | "manufacturing" | "social";

/** Targets a Parliament policy space can name. */
export type PolicyTargetKind = EnterpriseKind | "companyShare";

export type PrestigeCardType = "spouse" | "enterprise";

export type CardEffect =
  | { type: "forbidFamilyAction"; action: "enlist-writer" | "enlist-officer" }
  | {
      type: "forbidHolding";
      holding: "blackmail" | "workshop" | "shipyard" | "companyShare";
      /** What happens to holdings the player already has when they take the card. */
      existing: "tradeOrDiscard" | "tradeOrRemove";
    }
  | { type: "restrictRetirementPrizes"; allowedPrizeVictoryPoints: number[] }
  | { type: "removeOpportunityMarker" }
  | { type: "enterprisesHaveNoVotes" }
  | { type: "removePromiseFromGame"; promise: PromiseCardId }
  | { type: "conditionalVotes"; votes: number; policyTargets: PolicyTargetKind[] }
  | {
      type: "bankIncome";
      amount: number;
      trigger:
        | "managerOfShippingAcquiresExtraOrCompanyShip"
        | "anyPlayerPurchasesWorkshop"
        | "regimentAddedToArmy";
    }
  | { type: "seekShareCostOverride"; cost: number; othersMayUseWithPermission: boolean }
  | { type: "transferCash"; maxAmount: number; from: "guarantor"; to: "holder" }
  | { type: "grantNepotismConsent" }
  | { type: "scoreSharesAsIfCompanySucceeded" }
  | {
      type: "vpPenaltyPerHolding";
      holding: "shipyard" | "passedLawToken" | "governor" | "governorGeneral";
      vp: number;
    }
  | { type: "vpPenaltyForPrimeMinister"; vp: number }
  | { type: "vpPenaltyPerGovernorLostToRegionLossOnFinalTurn"; vp: number }
  | {
      type: "vpPenaltyHalfOfSum";
      holdings: Array<"officer" | "commander" | "trophy">;
      rounding: "down";
    }
  | {
      type: "skipScoring";
      items: Array<"workshops" | "firmSharesIfDeregulated" | "debtorsPrisonIfDeregulated">;
    };

type CardBase = {
  id: string;
  name: string;
  /** Index printed in the card's bottom-right corner. */
  cardNumber: number;
  source: CardSourceRef;
  /** Verbatim card text (excluding the title). */
  text: string;
  effects: CardEffect[];
  /** Named handler for effects the engine must implement in code. */
  effectHandler?: string;
  /** Fields that could not be read with confidence. Empty when everything was verified. */
  uncertain: string[];
  notes: string[];
};

export type PrestigeCard = CardBase & {
  kind: "prestige";
  prestigeType: PrestigeCardType;
  victoryPoints: number;
  power: number;
  /** Unconditional vote icons. Conditional votes are in `effects`. */
  votes: number;
  windowTaxIcons: number;
  /** Set when the card counts as an enterprise (type icon in the top right). */
  enterpriseType?: EnterpriseKind;
  /** GBP subtracted from retirement costs (spouses only); 0 if none. */
  retirementDiscount: number;
  /** Spouses cannot be transferred; enterprise prestige cards can. */
  transferable: boolean;
};

export type BlackmailTiming =
  | "anytimeBeforeFamilyPhase"
  | "startOfRevenuePhase"
  | "whenRetiring"
  | "whenTakenOrAnytimeAfterRevenuePhase"
  | "duringHiringAsCandidate"
  | "anytimeBeforeEventsInIndiaPhase"
  | "afterTradeCheck"
  | "afterDeployCheck"
  | "whenBlackmailPlayed";

export type BlackmailCard = CardBase & {
  kind: "blackmail";
  power: number;
  timing: BlackmailTiming;
  effectHandler: string;
};

export type FailureCard = CardBase & {
  kind: "failure";
};

export type PromiseCardId =
  | "take-up-to-2-from-me"
  | "take-my-officeholders-bonus"
  | "vote-with-my-enterprises"
  | "my-consent-for-nepotism"
  | "take-my-card-from-london-season-display";

export type PromiseTiming =
  | "anytime"
  | "companyOperationAfterOfficeActs"
  | "afterLawProposedBeforeVotes"
  | "whileOfficeIsBeingHired"
  | "startOfGuarantorTurnInPrestigeCardsStep";

export type PromiseCardType = {
  id: PromiseCardId;
  /** Front text, above "Guaranteed by the <Family> Family". */
  text: string;
  /** "Timing and Clarifications" bullets from the card back, verbatim. */
  timingAndClarifications: string[];
  timing: PromiseTiming;
  effects: CardEffect[];
  effectHandler?: string;
  frontSource: CardSourceRef;
  backSource: CardSourceRef;
  uncertain: string[];
  notes: string[];
};

const BRIDGE_FRONTS = "printnplay/Cards/John Company Cards (Bridge, Fronts).pdf";
const MINI_FRONTS = "printnplay/Cards/John Company Cards (MiniEuro, Fronts).pdf";
const MINI_BACKS = "printnplay/Cards/John Company Cards (MiniEuro, Backs).pdf";

/** Bridge-card sheets hold 9 cards in a 3x3 grid; printed page numbers match PDF pages. */
const bridgeSource = (page: number, row: number, column: number, cardNumber: number): string =>
  `${BRIDGE_FRONTS} p.${page} (printed page ${page}), row ${row}, column ${column}, card #${cardNumber}`;

/** Source for prestige and blackmail cards 1-30, which run in order from page 1. */
const indexedBridgeSource = (cardNumber: number): string => {
  const slot = cardNumber - 1;
  return bridgeSource(
    Math.floor(slot / 9) + 1,
    Math.floor((slot % 9) / 3) + 1,
    (slot % 3) + 1,
    cardNumber,
  );
};

type SpouseInput = {
  id: string;
  name: string;
  cardNumber: number;
  victoryPoints: number;
  power?: number;
  retirementDiscount: number;
  text: string;
  effects: CardEffect[];
  effectHandler?: string;
  notes?: string[];
};

const spouse = (input: SpouseInput): PrestigeCard => ({
  kind: "prestige",
  prestigeType: "spouse",
  id: input.id,
  name: input.name,
  cardNumber: input.cardNumber,
  source: indexedBridgeSource(input.cardNumber),
  victoryPoints: input.victoryPoints,
  power: input.power ?? 0,
  votes: 0,
  windowTaxIcons: 0,
  retirementDiscount: input.retirementDiscount,
  transferable: false,
  text: input.text,
  effects: input.effects,
  effectHandler: input.effectHandler,
  uncertain: [],
  notes: ['Header text: "SPOUSE — You cannot transfer this card."', ...(input.notes ?? [])],
});

type EnterpriseInput = {
  id: string;
  name: string;
  cardNumber: number;
  enterpriseType: EnterpriseKind;
  power?: number;
  votes?: number;
  windowTaxIcons?: number;
  text: string;
  effects: CardEffect[];
  effectHandler?: string;
  notes?: string[];
};

const enterprise = (input: EnterpriseInput): PrestigeCard => ({
  kind: "prestige",
  prestigeType: "enterprise",
  id: input.id,
  name: input.name,
  cardNumber: input.cardNumber,
  source: indexedBridgeSource(input.cardNumber),
  victoryPoints: 0,
  power: input.power ?? 0,
  votes: input.votes ?? 0,
  windowTaxIcons: input.windowTaxIcons ?? 0,
  enterpriseType: input.enterpriseType,
  retirementDiscount: 0,
  transferable: true,
  text: input.text,
  effects: input.effects,
  effectHandler: input.effectHandler,
  uncertain: [],
  notes: input.notes ?? [],
});

export const prestigeCards: PrestigeCard[] = [
  spouse({
    id: "mr-rochester",
    name: "Mr. Rochester",
    cardNumber: 11,
    victoryPoints: 2,
    retirementDiscount: 2,
    text: "You may no longer enlist writers as your family action. Note: the extra writer from the Tenure Limits law is still permitted.",
    effects: [{ type: "forbidFamilyAction", action: "enlist-writer" }],
  }),
  spouse({
    id: "esther-summerson",
    name: "Esther Summerson",
    cardNumber: 12,
    victoryPoints: 2,
    retirementDiscount: 1,
    text: "You may no longer take or own blackmail cards. Any you currently have facedown must be traded or discarded. Faceup blackmail cards must be discarded.",
    effects: [{ type: "forbidHolding", holding: "blackmail", existing: "tradeOrDiscard" }],
    effectHandler: "prestige.esther-summerson.discard-faceup-blackmail",
    notes: ["Faceup (already played) blackmail cards cannot be traded, so they must be discarded."],
  }),
  spouse({
    id: "john-thorpe",
    name: "John Thorpe",
    cardNumber: 13,
    victoryPoints: 2,
    retirementDiscount: 2,
    text: "You may no longer purchase or own workshops. Any you currently have must be traded or discarded.",
    effects: [{ type: "forbidHolding", holding: "workshop", existing: "tradeOrDiscard" }],
  }),
  spouse({
    id: "violet-effingham",
    name: "Violet Effingham",
    cardNumber: 14,
    victoryPoints: 3,
    retirementDiscount: 1,
    text: "You may no longer purchase or own shipyards. Any you currently have must be traded or discarded. (Fitted ships associated with discarded shipyards remain in play.)",
    effects: [{ type: "forbidHolding", holding: "shipyard", existing: "tradeOrDiscard" }],
    notes: [
      "Rulebook p.12: shipyards returned this way may not be purchased in the Family phase while their ship is in play.",
    ],
  }),
  spouse({
    id: "joseph-sedley",
    name: "Joseph Sedley",
    cardNumber: 15,
    victoryPoints: 2,
    retirementDiscount: 1,
    text: "You may no longer seek or own Company shares. If you are Chairman, move your family member back into the Court as a share and vacate the office. Any shares you have must be traded or removed.",
    effects: [{ type: "forbidHolding", holding: "companyShare", existing: "tradeOrRemove" }],
    effectHandler: "prestige.joseph-sedley.vacate-chairman",
  }),
  spouse({
    id: "becky-sharp",
    name: "Becky Sharp",
    cardNumber: 16,
    victoryPoints: 0,
    power: 2,
    retirementDiscount: 0,
    text: "When taking prestige cards, you may take a card from the top of the deck instead as long as there is at least one card in the display.",
    effects: [],
    effectHandler: "prestige.becky-sharp.take-from-deck",
    notes: [
      "The only spouse with a power icon (2) instead of a victory point icon, and the only one with no retirement discount (rulebook p.9: one spouse is worth power).",
    ],
  }),
  spouse({
    id: "william-collins",
    name: "William Collins",
    cardNumber: 17,
    victoryPoints: 2,
    retirementDiscount: 1,
    text: "You may no longer enlist officers as your family action. Note: the extra officer from the Army Spending law is still permitted.",
    effects: [{ type: "forbidFamilyAction", action: "enlist-officer" }],
  }),
  spouse({
    id: "lady-glencora",
    name: "Lady Glencora",
    cardNumber: 18,
    victoryPoints: 2,
    retirementDiscount: 2,
    text: "Remove your opportunity marker from the game. It is never placed when you take an action. Note: you may still gain extra actions from laws and an extra writer when there are 4+ vacancies.",
    effects: [{ type: "removeOpportunityMarker" }],
  }),
  spouse({
    id: "lord-highgate",
    name: "Lord Highgate",
    cardNumber: 19,
    victoryPoints: 3,
    retirementDiscount: 2,
    text: "You may only retire to the 8 or 12 victory point prizes.",
    effects: [{ type: "restrictRetirementPrizes", allowedPrizeVictoryPoints: [8, 12] }],
  }),
  spouse({
    id: "lady-newcome",
    name: "Lady Newcome",
    cardNumber: 20,
    victoryPoints: 3,
    retirementDiscount: 2,
    text: 'Act as if your enterprises no longer have vote icons. Remove your "Vote with my Enterprises" promise from the game, even if it is owned by another player. Any enterprises you transfer to another player cannot be used to vote with that turn.',
    effects: [
      { type: "enterprisesHaveNoVotes" },
      { type: "removePromiseFromGame", promise: "vote-with-my-enterprises" },
    ],
    effectHandler: "prestige.lady-newcome.transferred-enterprises-cannot-vote-this-turn",
  }),
  enterprise({
    id: "shipbuilders",
    name: "Shipbuilders",
    cardNumber: 21,
    enterpriseType: "shipping",
    text: "Whenever the Manager of Shipping buys an extra ship or Company ship, take £1 from the bank for each.",
    effects: [
      { type: "bankIncome", amount: 1, trigger: "managerOfShippingAcquiresExtraOrCompanyShip" },
    ],
    notes: ['The rulebook calls acquiring extra ships "leasing" (p.19); the card says "buys".'],
  }),
  enterprise({
    id: "tax-collectors",
    name: "Tax Collectors",
    cardNumber: 22,
    enterpriseType: "manufacturing",
    text: "With the Prime Minister's consent, you may treat the proposed policy as if it includes an additional window tax. This must be decided before voting begins. If you win a vote as the Opposition Leader, you may add an additional window tax to the policy you decide.",
    effects: [],
    effectHandler: "prestige.tax-collectors.add-window-tax",
  }),
  enterprise({
    id: "labour-newspaper",
    name: "Labour Newspaper",
    cardNumber: 23,
    enterpriseType: "manufacturing",
    text: "If voting on a manufacturing or shipping policy: [4 vote icons]",
    effects: [{ type: "conditionalVotes", votes: 4, policyTargets: ["manufacturing", "shipping"] }],
    notes: ["The condition is shown with manufacturing and shipping icons above the text."],
  }),
  enterprise({
    id: "foundry",
    name: "Foundry",
    cardNumber: 24,
    enterpriseType: "manufacturing",
    text: "Each time any player purchases a workshop or a regiment is added to an Army, you take £1 from the bank.",
    effects: [
      { type: "bankIncome", amount: 1, trigger: "anyPlayerPurchasesWorkshop" },
      { type: "bankIncome", amount: 1, trigger: "regimentAddedToArmy" },
    ],
  }),
  enterprise({
    id: "stock-broker",
    name: "Stock Broker",
    cardNumber: 25,
    enterpriseType: "social",
    text: "When seeking shares, treat every space as if it costs £1. Other players may use this power with your permission.",
    effects: [{ type: "seekShareCostOverride", cost: 1, othersMayUseWithPermission: true }],
  }),
  enterprise({
    id: "social-magazine",
    name: "Social Magazine",
    cardNumber: 26,
    enterpriseType: "social",
    text: "If voting on a Social or Company share policy: [4 vote icons]",
    effects: [{ type: "conditionalVotes", votes: 4, policyTargets: ["social", "companyShare"] }],
    notes: ["The condition is shown with social (top hat) and Company share icons above the text."],
  }),
  enterprise({
    id: "scottish-castle",
    name: "Scottish Castle",
    cardNumber: 27,
    enterpriseType: "social",
    power: 3,
    windowTaxIcons: 2,
    text: "[power icon 3] [2 window tax icons]",
    effects: [],
    notes: ["No rules text; the card shows only a power icon (3) and two window icons."],
  }),
  ...[28, 29, 30].map((cardNumber, index) =>
    enterprise({
      id: `rotten-borough-${index + 1}`,
      name: "Rotten Borough",
      cardNumber,
      enterpriseType: "social",
      votes: 3,
      text: "[3 vote icons]",
      effects: [],
      notes: [
        "Three identical copies. The Masses Demand Franchise! law (rulebook p.34) reduces Rotten Boroughs to one vote each.",
      ],
    }),
  ),
];

type BlackmailInput = {
  id: string;
  name: string;
  cardNumber: number;
  power: number;
  timing: BlackmailTiming;
  text: string;
  effectHandler: string;
  notes?: string[];
};

const blackmail = (input: BlackmailInput): BlackmailCard => ({
  kind: "blackmail",
  id: input.id,
  name: input.name,
  cardNumber: input.cardNumber,
  source: indexedBridgeSource(input.cardNumber),
  power: input.power,
  timing: input.timing,
  text: input.text,
  effects: [],
  effectHandler: input.effectHandler,
  uncertain: [],
  notes: input.notes ?? [],
});

export const blackmailCards: BlackmailCard[] = [
  blackmail({
    id: "the-prime-ministers-ear",
    name: "The Prime Minister's Ear",
    cardNumber: 1,
    power: 2,
    timing: "anytimeBeforeFamilyPhase",
    text: "Play anytime on a turn before the Family phase to swap two adjacent power markers.",
    effectHandler: "blackmail.swap-adjacent-power-markers",
  }),
  blackmail({
    id: "company-fraud",
    name: "Company Fraud",
    cardNumber: 2,
    power: 0,
    timing: "startOfRevenuePhase",
    text: "Play at the start of the Revenue phase. Roll one die for each of your officeholders. Lower the Company Balance equal to twice the highest roll (to a minimum of zero) and take that much from the bank.",
    effectHandler: "blackmail.company-fraud",
    notes: ["No power icon on this card."],
  }),
  blackmail({
    id: "letters-of-introduction",
    name: "Letters of Introduction",
    cardNumber: 3,
    power: 1,
    timing: "whenRetiring",
    text: "Play when retiring one or more pieces (in London Season or Final Scoring). Act as if you also have retirement discounts equal to those on all other players' spouses.",
    effectHandler: "blackmail.borrow-all-spouse-discounts",
  }),
  blackmail({
    id: "scandal-on-leadenhall-street",
    name: "Scandal on Leadenhall Street",
    cardNumber: 4,
    power: 2,
    timing: "whenTakenOrAnytimeAfterRevenuePhase",
    text: "Play when taken from the display or anytime after the Revenue phase on a turn to force any office that is not President or Governor (or Governor General) to vacate their office without retirement.",
    effectHandler: "blackmail.vacate-office-without-retirement.company",
  }),
  blackmail({
    id: "scandal-in-india",
    name: "Scandal in India",
    cardNumber: 5,
    power: 2,
    timing: "whenTakenOrAnytimeAfterRevenuePhase",
    text: "Play when taken from the display or anytime after the Revenue phase on a turn to force a President or Governor (or Governor General) to vacate their office without retirement.",
    effectHandler: "blackmail.vacate-office-without-retirement.india",
  }),
  blackmail({
    id: "hiring-preference",
    name: "Hiring Preference",
    cardNumber: 6,
    power: 1,
    timing: "duringHiringAsCandidate",
    text: "Play during hiring if you are a candidate. The hiring player must choose you. You may use this to ignore the Nepotism rule.",
    effectHandler: "blackmail.force-hire-self",
  }),
  blackmail({
    id: "envoy-to-the-mughals",
    name: "Envoy to the Mughals",
    cardNumber: 7,
    power: 0,
    timing: "anytimeBeforeEventsInIndiaPhase",
    text: "Play anytime on a turn before the Events in India phase. Move the Elephant to any legal position and then take £ equal to the highest open order in the region with the Elephant's tail.",
    effectHandler: "blackmail.move-elephant-and-take-order-value",
    notes: ["No power icon on this card."],
  }),
  blackmail({
    id: "mercantile-connection",
    name: "Mercantile Connection",
    cardNumber: 8,
    power: 1,
    timing: "afterTradeCheck",
    text: "Play after a check to force a President or firm to reroll any Trade roll with half as many dice, rounding down. If reduced to zero dice, treat roll as failure.",
    effectHandler: "blackmail.force-half-dice-reroll.trade",
  }),
  blackmail({
    id: "diplomatic-connection",
    name: "Diplomatic Connection",
    cardNumber: 9,
    power: 2,
    timing: "afterDeployCheck",
    text: "Play after a check to force a Commander to reroll any Deploy roll with half as many dice, rounding down. If reduced to zero dice, treat roll as failure.",
    effectHandler: "blackmail.force-half-dice-reroll.deploy",
  }),
  blackmail({
    id: "man-on-the-inside",
    name: "Man on the Inside",
    cardNumber: 10,
    power: 1,
    timing: "whenBlackmailPlayed",
    text: "Play this card to cancel the effect of a blackmail card when played. The canceled card should be taken into your play area face up. You cannot play this card to cancel Letters of Introduction during Final Scoring.",
    effectHandler: "blackmail.cancel-blackmail",
  }),
];

const failure = (
  id: string,
  name: string,
  cardNumber: number,
  source: string,
  text: string,
  effects: CardEffect[],
  notes: string[] = [],
): FailureCard => ({
  kind: "failure",
  id,
  name,
  cardNumber,
  source,
  text,
  effects,
  uncertain: [],
  notes,
});

export const companyFailureCards: FailureCard[] = [
  failure(
    "court-of-directors-blameless",
    "Court of Directors Blameless!",
    77,
    bridgeSource(9, 2, 2, 77),
    "Treat the value of Company shares as if the Company had been successful.",
    [{ type: "scoreSharesAsIfCompanySucceeded" }],
  ),
  failure(
    "careless-shipbuilders-indicted",
    "Careless Shipbuilders Indicted!",
    78,
    bridgeSource(9, 2, 3, 78),
    "Lower each player's score by 1VP for each of their shipyards.",
    [{ type: "vpPenaltyPerHolding", holding: "shipyard", vp: 1 }],
  ),
  failure(
    "industrys-greed-condemned",
    "Industry's Greed Condemned!",
    79,
    bridgeSource(9, 3, 1, 79),
    "Do not score workshops. If deregulated, do not score firm shares or pieces in Debtor's Prison.",
    [
      {
        type: "skipScoring",
        items: ["workshops", "firmSharesIfDeregulated", "debtorsPrisonIfDeregulated"],
      },
    ],
  ),
  failure(
    "parliament-exposed",
    "Parliament Exposed!",
    80,
    bridgeSource(9, 3, 2, 80),
    "Lower each player's score by 1VP for each of their passed law tokens. Then, the Prime Minister lowers their score by 2VP.",
    [
      { type: "vpPenaltyPerHolding", holding: "passedLawToken", vp: 1 },
      { type: "vpPenaltyForPrimeMinister", vp: 2 },
    ],
    [
      "The card also carries an italic historical note about the cartoon of Prime Minister Disraeli; it has no rules effect.",
    ],
  ),
  failure(
    "military-rebuked",
    "Military Rebuked!",
    81,
    bridgeSource(9, 3, 3, 81),
    "Lower each player's score by half of the sum of their officers, Commanders, and trophies (rounding down).",
    [{ type: "vpPenaltyHalfOfSum", holdings: ["officer", "commander", "trophy"], rounding: "down" }],
    [
      "The card does not say whether officers-in-training count as officers; the rulebook treats them as a separate box (p.13).",
    ],
  ),
  failure(
    "the-british-despots-of-india",
    "The British Despots of India!",
    82,
    bridgeSource(10, 1, 1, 82),
    "Lower each player's score by 2VP for each of their Governors or by 4VP for the Governor General. Anyone who had a Governor that was removed in Region Loss on the final turn should lower their score by 2VP for each.",
    [
      { type: "vpPenaltyPerHolding", holding: "governor", vp: 2 },
      { type: "vpPenaltyPerHolding", holding: "governorGeneral", vp: 4 },
      { type: "vpPenaltyPerGovernorLostToRegionLossOnFinalTurn", vp: 2 },
    ],
  ),
];

/** The six families whose names appear on promise cards ("Guaranteed by the ... Family"). */
export const promiseCardFamilies = [
  "Sykes",
  "Paxton",
  "Larkins",
  "Hastings",
  "Walsh",
  "Benyon",
] as const;

const promiseFront = `${MINI_FRONTS} p.4 (printed page 26); one copy per family on printed pages 26-28`;
const promiseBack = `${MINI_BACKS} p.4 (printed page 37); backs are mirrored left-to-right against the fronts`;

export const promiseCardTypes: PromiseCardType[] = [
  {
    id: "take-up-to-2-from-me",
    text: "Take £2 or less from me.",
    timingAndClarifications: [
      "Play at any time e.g. you may cash this in to prevent a player from paying for upkeep on a prize!",
      "If you prevent a player from purchasing something during their turn in the Family phase, they may undo their action and take another.",
    ],
    timing: "anytime",
    effects: [{ type: "transferCash", maxAmount: 2, from: "guarantor", to: "holder" }],
    frontSource: `${promiseFront}; Larkins copy at row 4, column 1`,
    backSource: `${promiseBack}; row 4, column 4`,
    uncertain: [],
    notes: [],
  },
  {
    id: "take-my-officeholders-bonus",
    text: "Take my officeholder's bonus.",
    timingAndClarifications: [
      "Use during the Company phase after an office has acted. You cannot take a share of loot with this card.",
      "If a governor was removed because of a catastrophic failure, you cannot take any bonus that office might have made this turn.",
    ],
    timing: "companyOperationAfterOfficeActs",
    effects: [],
    effectHandler: "promise.take-officeholder-bonus",
    frontSource: `${promiseFront}; Larkins copy at row 4, column 2`,
    backSource: `${promiseBack}; row 4, column 3`,
    uncertain: [],
    notes: [],
  },
  {
    id: "vote-with-my-enterprises",
    text: "Vote with my enterprises as if you owned them.",
    timingAndClarifications: [
      "Play after a law and policy are proposed but before any votes are cast.",
      "You may use the Prime Minister's enterprises to vote against the proposed law.",
      "You may choose to not let these votes be used by anyone.",
    ],
    timing: "afterLawProposedBeforeVotes",
    effects: [],
    effectHandler: "promise.vote-with-guarantor-enterprises",
    frontSource: `${promiseFront}; Larkins copy at row 4, column 3`,
    backSource: `${promiseBack}; row 4, column 2`,
    uncertain: [],
    notes: ["Lady Newcome removes her holder's copy of this promise from the game."],
  },
  {
    id: "my-consent-for-nepotism",
    text: "My consent for nepotism.",
    timingAndClarifications: [
      "Play at any time an office is being hired.",
      "You may not use this appointing a Commander as it is not an office.",
      "You may not use this when electing a Chairman as it is an election, not hiring.",
    ],
    timing: "whileOfficeIsBeingHired",
    effects: [{ type: "grantNepotismConsent" }],
    frontSource: `${promiseFront}; Hastings copy at row 4, column 4`,
    backSource: `${promiseBack}; row 4, column 1`,
    uncertain: [],
    notes: [],
  },
  {
    id: "take-my-card-from-london-season-display",
    text: "Take my card from the London Season Display.",
    timingAndClarifications: [
      "Use at the start of my turn during the final step of the London Season.",
      "You may peek at blackmails in the display.",
      "This card does not stop you from gaining a card through your own retirements or from other copies of this card.",
      "Becky Sharp's power only applies to the family that holds her.",
    ],
    timing: "startOfGuarantorTurnInPrestigeCardsStep",
    effects: [],
    effectHandler: "promise.take-guarantor-prestige-pick",
    frontSource: `${promiseFront}; Larkins copy at row 3, column 4`,
    backSource: `${promiseBack}; row 3, column 1`,
    uncertain: [],
    notes: [
      '"My turn" on the back refers to the guarantor\'s turn in the Prestige Cards step (rulebook p.12).',
    ],
  },
];

export const PRESTIGE_CARD_COUNT = 20;
export const BLACKMAIL_CARD_COUNT = 10;
export const COMPANY_FAILURE_CARD_COUNT = 6;
export const PROMISE_CARD_TYPE_COUNT = 5;
