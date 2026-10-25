// Law deck for John Company: Second Edition (26 cards, printed card numbers 31-56).
//
// Transcribed from the print-and-play files:
// - fronts: "printnplay/Cards/John Company Cards (Bridge, Fronts).pdf" printed pages 4-7
// - backs:  "printnplay/Cards/John Company Cards (Bridge, Bridge).pdf" printed pages 15-18
// Card text is quoted verbatim (italic notes included as plain text) under CC BY-NC-SA 4.0.
// Rulebook pages 13 (Extra Actions), 34-36 (Parliament Meets, The Vote to Deregulate) explain
// how the cards are used.

export type LawScenarioId = "1710" | "1758" | "1813" | "long-1710";

/** Header printed at the top of the card: "Law before Parliament", "Dilemma before
 * Parliament" (red bars; must be selected when drawn) or "Special Session of Parliament". */
export type LawKind = "law" | "dilemma" | "specialSession";

/**
 * The icon in the bottom-left banner. The Prime Minister rotates the policy dial to the first
 * space matching it (rulebook p.34). It is either a policy consequence word or a target icon:
 * gear = manufacturing enterprise, anchor = shipping enterprise, top hat = social enterprise,
 * EIC heart = Company share.
 */
export type LawPolicyIcon =
  | { kind: "consequence"; consequence: "tax" | "bonus" | "power" }
  | { kind: "target"; target: "manufacturing" | "shipping" | "social" | "companyShare" };

/** Family actions an Extra Action can grant; ids match src/data/family-actions.ts. */
export type LawExtraActionId =
  | "purchase-workshop"
  | "purchase-shipyard"
  | "purchase-luxury"
  | "enlist-officer"
  | "enlist-writer"
  | "seek-share";

export type LawExtraAction = {
  familyAction: LawExtraActionId;
  /** Verbatim Extra Action text. Only the most recently passed extra action can be used (p.13). */
  text: string;
  /** Set when the card limits when the extra action may be used. */
  restriction?: "notAfterEnlistWriter";
  /** Set when the action is limited to a single piece even if the base action allows more. */
  singlePiece?: boolean;
};

export type LawEffectTiming = "onPass" | "onFail" | "ongoing";

/** Mechanical effects simple enough to describe as data. Anything else uses `effectHandler`. */
export type LawEffect =
  | { timing: "onPass"; type: "gainCashPerEnterprise"; enterpriseType: "manufacturing"; amount: number }
  | { timing: "onPass"; type: "createOfficeIfMissing"; officeId: "superintendent-of-trade-in-china" }
  | { timing: "onPass"; type: "placeRegimentsInEachArmy"; count: number }
  | { timing: "onPass"; type: "setCompanyDebtToLeftmost" }
  | { timing: "onPass"; type: "discardPassedLaw"; lawId: string }
  | { timing: "onPass"; type: "advanceCompanyShareValue" }
  | { timing: "onPass"; type: "enactPolicyConsequenceAgain" }
  | { timing: "onPass"; type: "rottenBoroughVotes"; votes: number }
  | { timing: "onPass"; type: "voteCost"; amount: number }
  | { timing: "onFail"; type: "lowerStanding"; spaces: number }
  | { timing: "onFail"; type: "nothing" }
  | {
      timing: "ongoing";
      type: "revenueStartBalancePenalty";
      lowerBy: number;
      perBalance: number;
      skipAfterDeregulation: boolean;
    }
  | { timing: "ongoing"; type: "chinaTradeValuePerExportIcon"; amount: number }
  | { timing: "ongoing"; type: "bonusPerFamilyMemberOnPrize"; amount: number }
  | { timing: "ongoing"; type: "chairmanAlwaysRetiresInAttrition" }
  | { timing: "ongoing"; type: "regimentsExemptFromExpenses" }
  | { timing: "ongoing"; type: "playerShipFittingCost"; amount: number }
  | { timing: "ongoing"; type: "presidentBonusToCompanyBalance" }
  | { timing: "ongoing"; type: "governorDicePoolBonus"; dice: number }
  | { timing: "ongoing"; type: "failedAdministerUnrest"; unrest: number }
  | { timing: "ongoing"; type: "governorGeneralGovernBonus"; amount: number }
  | { timing: "ongoing"; type: "failedGovernUnrestPerRegion"; unrest: number }
  | { timing: "ongoing"; type: "lootToCompanyBalance" }
  | {
      timing: "ongoing";
      type: "workshopPurchaseCost";
      amount: number;
      onlyIfOpportunityMarkerNotOnWorkshop: true;
      excludesCalicoActsExtraAction: true;
    }
  | { timing: "ongoing"; type: "discardWhenDeregulationOccurs" }
  | { timing: "ongoing"; type: "extraWriterBonusPerPlacedWriter"; amount: number }
  | { timing: "ongoing"; type: "deregulationVoteInitialSupportBonus"; amount: number }
  | { timing: "ongoing"; type: "noWindowTaxes"; exception: "taxCollectorEnterprise" }
  | { timing: "ongoing"; type: "writerBonusesToCompanyBalance" }
  | { timing: "ongoing"; type: "debtExpenseEach"; amount: number };

export type LawCardSource = {
  front: string;
  back: string;
};

export type LawCard = {
  id: string;
  /** Printed card number (bottom-right corner). */
  number: number;
  name: string;
  kind: LawKind;
  /** Printed starting support on the ballot box; null when the card prints none. */
  startingSupport: number | null;
  /** Deregulation only: support depends on how many of Standing/Debt are on lined spaces. */
  variableStartingSupport?: { oneMarkerOnLinedSpace: number; bothMarkersOnLinedSpaces: number };
  /** Null when the card prints no policy banner (Old Ideas Made New!, Deregulation). */
  policyIcon: LawPolicyIcon | null;
  /** Full card text, verbatim, excluding the header, name and any Extra Action box.
   * Dilemmas keep their "If passed:" / "If failed:" lines here as well. */
  text: string;
  /** Dilemmas: verbatim "If passed:" text (without the label). */
  ifPassed?: string;
  /** Dilemmas: verbatim "If failed:" text (without the label). */
  ifFailed?: string;
  extraAction?: LawExtraAction;
  /** Whether the card's effects last while it stays passed, only happen once, or both. */
  persistence: "ongoing" | "immediate" | "both";
  effects: LawEffect[];
  /** Stable id for engine logic that `effects` cannot express. */
  effectHandler?: string;
  /** True for cards shuffled into the law draw deck. Deregulation is a separate special session. */
  inLawDeck: boolean;
  startsPassedIn: LawScenarioId[];
  /** Scenarios that return this card to the box at setup. */
  removedIn: LawScenarioId[];
  /** Scenarios that use the card at all (Deregulation only); omitted means every scenario. */
  usedIn?: LawScenarioId[];
  /** Verbatim back text when the back is not the generic Parliament law back. */
  backText?: string;
  source: LawCardSource;
  notes: string[];
  /** Fields that could not be read with certainty; empty when everything was legible. */
  uncertain: string[];
};

const FRONTS = "printnplay/Cards/John Company Cards (Bridge, Fronts).pdf";
const BACKS = "printnplay/Cards/John Company Cards (Bridge, Bridge).pdf";
// Backs are printed mirrored: the back of front column c is in column 4 - c.
const BACK_PAGE_FOR_FRONT_PAGE: Record<number, number> = { 4: 15, 5: 16, 6: 17, 7: 18 };

const source = (page: number, row: number, column: number): LawCardSource => ({
  front: `${FRONTS} p.${page} r${row}c${column}`,
  back: `${BACKS} p.${BACK_PAGE_FOR_FRONT_PAGE[page]} r${row}c${4 - column}`,
});

const tax: LawPolicyIcon = { kind: "consequence", consequence: "tax" };
const bonus: LawPolicyIcon = { kind: "consequence", consequence: "bonus" };
const power: LawPolicyIcon = { kind: "consequence", consequence: "power" };
const manufacturing: LawPolicyIcon = { kind: "target", target: "manufacturing" };
const shipping: LawPolicyIcon = { kind: "target", target: "shipping" };
const social: LawPolicyIcon = { kind: "target", target: "social" };
const companyShare: LawPolicyIcon = { kind: "target", target: "companyShare" };

const STANDARD_EXTRA_ACTION_TEXT = (action: string): string =>
  `After taking any family action(s), you may ${action}.`;

type LawCardInput = Omit<
  LawCard,
  "inLawDeck" | "startsPassedIn" | "removedIn" | "notes" | "uncertain" | "effects"
> &
  Partial<Pick<LawCard, "inLawDeck" | "startsPassedIn" | "removedIn" | "notes" | "uncertain" | "effects">>;

const card = (input: LawCardInput): LawCard => ({
  inLawDeck: true,
  startsPassedIn: [],
  removedIn: [],
  notes: [],
  uncertain: [],
  effects: [],
  ...input,
});

export const laws: LawCard[] = [
  card({
    id: "calico-acts",
    number: 31,
    name: "Calico Acts",
    kind: "law",
    startingSupport: 1,
    policyIcon: manufacturing,
    extraAction: {
      familyAction: "purchase-workshop",
      text: STANDARD_EXTRA_ACTION_TEXT("buy a workshop"),
    },
    text:
      "When passed, players gain £2 for each manufacturing enterprise they own. " +
      "At the start of the Revenue phase, lower the Company Balance by £1 for every £7. " +
      "Skip this penalty after deregulation.",
    persistence: "both",
    effects: [
      { timing: "onPass", type: "gainCashPerEnterprise", enterpriseType: "manufacturing", amount: 2 },
      {
        timing: "ongoing",
        type: "revenueStartBalancePenalty",
        lowerBy: 1,
        perBalance: 7,
        skipAfterDeregulation: true,
      },
    ],
    startsPassedIn: ["1758", "1813"],
    source: source(4, 2, 1),
    notes: [
      "Starts passed in 1758 and 1813 (scenario card fronts, Bridge Fronts p.9).",
      "Rulebook p.34 shows this card in the Selecting a Law example.",
    ],
  }),
  card({
    id: "envoy-to-china",
    number: 32,
    name: "Envoy to China",
    kind: "law",
    startingSupport: -3,
    policyIcon: shipping,
    text:
      "Trade in China is worth £5 per export icon. " +
      "If the office has not been created, create the Superintendent of Trade in China office.",
    persistence: "both",
    effects: [
      { timing: "ongoing", type: "chinaTradeValuePerExportIcon", amount: 5 },
      { timing: "onPass", type: "createOfficeIfMissing", officeId: "superintendent-of-trade-in-china" },
    ],
    source: source(4, 2, 2),
    notes: [
      "Normally Trade in China adds £4 per export icon to the Company Balance (rulebook p.25).",
      "Rulebook p.25: the office is created by a successful Special Envoy or by passing this law; it is hired immediately by the Chairman.",
    ],
  }),
  card({
    id: "army-spending",
    number: 33,
    name: "Army Spending",
    kind: "law",
    startingSupport: -4,
    policyIcon: tax,
    extraAction: {
      familyAction: "enlist-officer",
      text: STANDARD_EXTRA_ACTION_TEXT("enlist an officer"),
    },
    text: "Place 2 regiments in each Army.",
    persistence: "both",
    effects: [{ timing: "onPass", type: "placeRegimentsInEachArmy", count: 2 }],
    source: source(4, 2, 3),
  }),
  card({
    id: "board-of-control",
    number: 34,
    name: "Board of Control",
    kind: "law",
    startingSupport: 0,
    policyIcon: power,
    text:
      "Once per turn, after any office except the Chairman has finished acting, the Prime Minister " +
      "may remove its officeholder. The piece is returned to its supply and the office card is added " +
      "to the Vacant Offices box.",
    persistence: "ongoing",
    effectHandler: "board-of-control",
    source: source(4, 3, 1),
  }),
  card({
    id: "debt-restructure",
    number: 35,
    name: "Debt Restructure",
    kind: "law",
    startingSupport: -3,
    policyIcon: tax,
    extraAction: {
      familyAction: "seek-share",
      text: STANDARD_EXTRA_ACTION_TEXT("seek a share"),
    },
    text: "Lower the Company Debt marker to the leftmost space.",
    persistence: "both",
    effects: [{ timing: "onPass", type: "setCompanyDebtToLeftmost" }],
    source: source(4, 3, 2),
    notes: ["The Debt reduction happens once on passing; the extra action lasts while this is the most recently passed extra-action law."],
  }),
  card({
    id: "inclosure-acts",
    number: 36,
    name: "Inclosure Acts",
    kind: "law",
    startingSupport: -4,
    policyIcon: bonus,
    text: "Each family member on a prize now earns their family £1 during the Bonuses phase.",
    persistence: "ongoing",
    effects: [{ timing: "ongoing", type: "bonusPerFamilyMemberOnPrize", amount: 1 }],
    source: source(4, 3, 3),
  }),
  card({
    id: "tenure-limits",
    number: 37,
    name: "Tenure Limits",
    kind: "law",
    startingSupport: 0,
    policyIcon: power,
    extraAction: {
      familyAction: "enlist-writer",
      text: "After taking any family action(s) other than enlist writer, you may gain a single writer.",
      restriction: "notAfterEnlistWriter",
      singlePiece: true,
    },
    text: "The Chairman will always retire during the first step of the London Season.",
    persistence: "ongoing",
    effects: [{ timing: "ongoing", type: "chairmanAlwaysRetiresInAttrition" }],
    source: source(5, 1, 1),
    notes: ["The first step of the London Season is Attrition (rulebook p.11)."],
  }),
  card({
    id: "sepoy-recruitment",
    number: 38,
    name: "Sepoy Recruitment",
    kind: "law",
    startingSupport: -3,
    policyIcon: bonus,
    text:
      "Regiments no longer add to Company expenses. " +
      "In attacks against the Company, each unrest is worth +1 strength.",
    persistence: "ongoing",
    effects: [{ timing: "ongoing", type: "regimentsExemptFromExpenses" }],
    effectHandler: "sepoy-recruitment-unrest-strength",
    source: source(5, 1, 2),
    notes: [
      "Interpretation for the engine: without this law each unrest already adds 1 to attack strength (rulebook p.32), so '+1 strength' most likely makes each unrest count 2. The card does not say so explicitly; confirm before implementing.",
    ],
  }),
  card({
    id: "ship-subsidy",
    number: 39,
    name: "Ship Subsidy",
    kind: "law",
    startingSupport: -3,
    policyIcon: tax,
    extraAction: {
      familyAction: "purchase-shipyard",
      text: STANDARD_EXTRA_ACTION_TEXT("buy a shipyard"),
    },
    text: "Fitting player ships now costs £2 for the Manager of Shipping and for private firms.",
    persistence: "ongoing",
    effects: [{ timing: "ongoing", type: "playerShipFittingCost", amount: 2 }],
    source: source(5, 1, 3),
    notes: ["Normal fitting cost is £3 for both the Manager of Shipping (p.19) and firms (p.39)."],
  }),
  card({
    id: "trade-regulations",
    number: 40,
    name: "Trade Regulations",
    kind: "law",
    startingSupport: -1,
    policyIcon: shipping,
    text: "Each President’s bonus is added to the Company Balance.",
    persistence: "ongoing",
    effects: [{ timing: "ongoing", type: "presidentBonusToCompanyBalance" }],
    source: source(5, 2, 1),
    notes: ["The President's bonus is the £1 per order filled on a successful Trade (rulebook p.21)."],
  }),
  card({
    id: "zamindar-taxes",
    number: 41,
    name: "Zamindar Taxes",
    kind: "law",
    startingSupport: -2,
    policyIcon: companyShare,
    text:
      "All Governors add one die to their dice pool. Failed Administer actions place 2 unrest instead of 1. " +
      "If the Governor General is in play, they earn an additional £3 as part of their bonus for a " +
      "successful Govern action. Failed Govern actions place 2 unrest in each region instead of 1.",
    persistence: "ongoing",
    effects: [
      { timing: "ongoing", type: "governorDicePoolBonus", dice: 1 },
      { timing: "ongoing", type: "failedAdministerUnrest", unrest: 2 },
      { timing: "ongoing", type: "governorGeneralGovernBonus", amount: 3 },
      { timing: "ongoing", type: "failedGovernUnrestPerRegion", unrest: 2 },
    ],
    source: source(5, 2, 2),
  }),
  card({
    id: "treasure-reform",
    number: 42,
    name: "Treasure Reform",
    kind: "law",
    startingSupport: -3,
    policyIcon: companyShare,
    text: "All loot is now added to the Company Balance.",
    persistence: "ongoing",
    effects: [{ timing: "ongoing", type: "lootToCompanyBalance" }],
    source: source(5, 2, 3),
  }),
  card({
    id: "governor-general",
    number: 43,
    name: "Governor General",
    kind: "law",
    startingSupport: 1,
    policyIcon: shipping,
    text:
      "The Director of Trade becomes the Governor General. All Governors become pensioners. " +
      "Return the Director of Trade and Governor cards to the box. Any Company ships on regions " +
      "(those unfinished by Governors) are returned to the supply.",
    persistence: "both",
    effectHandler: "governor-general",
    removedIn: ["1813"],
    source: source(5, 3, 1),
    notes: [
      "Full procedure on rulebook p.26 (overlay on the ribbon, fatigue moves to the new card, Governor General hires Presidents and acts in the Director of Trade's slot).",
      "1813 setup: 'Return Governor General law to box and place its overlay over the Director of Trade.'",
    ],
  }),
  card({
    id: "industry-subsidy",
    number: 44,
    name: "Industry Subsidy",
    kind: "law",
    startingSupport: -3,
    policyIcon: tax,
    text:
      "If your opportunity token is not on the workshop space and you take the purchase workshop " +
      "action, pay only £3 (not £5). Note: this does not apply to a workshop purchased with Calico " +
      "Acts. Furthermore, a player (or the Crown) without an opportunity token will always benefit " +
      "from this law. Discard this law if deregulation occurs. Note: If deregulation has already " +
      "occurred, this law may still be passed.",
    persistence: "ongoing",
    effects: [
      {
        timing: "ongoing",
        type: "workshopPurchaseCost",
        amount: 3,
        onlyIfOpportunityMarkerNotOnWorkshop: true,
        excludesCalicoActsExtraAction: true,
      },
      { timing: "ongoing", type: "discardWhenDeregulationOccurs" },
    ],
    source: source(5, 3, 2),
  }),
  card({
    id: "writer-privileges",
    number: 45,
    name: "Writer Privileges",
    kind: "law",
    startingSupport: -3,
    policyIcon: manufacturing,
    text:
      "Players gain an additional £1 for each of their writers placed on an order in India. If the " +
      "Writer Graft Reform law is in effect, discard it. If voting on deregulation, add 5 to its " +
      "initial support. Historical note: relaxed restrictions led to cheaper prices on Indian goods " +
      "in Britain and popular support for broader deregulation.",
    persistence: "both",
    effects: [
      { timing: "ongoing", type: "extraWriterBonusPerPlacedWriter", amount: 1 },
      { timing: "onPass", type: "discardPassedLaw", lawId: "writer-graft-reform" },
      { timing: "ongoing", type: "deregulationVoteInitialSupportBonus", amount: 5 },
    ],
    source: source(5, 3, 3),
  }),
  card({
    id: "window-tax-repeal",
    number: 46,
    name: "Window Tax Repeal",
    kind: "law",
    startingSupport: -5,
    policyIcon: social,
    extraAction: {
      familyAction: "purchase-luxury",
      text: STANDARD_EXTRA_ACTION_TEXT("buy a luxury"),
    },
    text:
      "Players no longer pay window taxes. However, a player with the Tax Collector enterprise may " +
      "still add a single window tax exempt from this law as per the rules on that card.",
    persistence: "ongoing",
    effects: [{ timing: "ongoing", type: "noWindowTaxes", exception: "taxCollectorEnterprise" }],
    source: source(6, 1, 1),
    notes: ["Tax Collector is a prestige-card enterprise; its own text governs the exception."],
  }),
  card({
    id: "military-oversight",
    number: 47,
    name: "Military Oversight",
    kind: "law",
    startingSupport: 5,
    policyIcon: companyShare,
    text:
      "Immediately after Military Affairs acts, the Prime Minister may demote one Commander to an " +
      "officer and then appoint a Commander from officers in that army following the rules for " +
      "hiring and Nepotism.",
    persistence: "ongoing",
    effectHandler: "military-oversight",
    startsPassedIn: ["1813"],
    source: source(6, 1, 2),
    notes: ["Starts passed in 1813 (scenario card front, Bridge Fronts p.9)."],
  }),
  card({
    id: "writer-graft-reform",
    number: 48,
    name: "Writer Graft Reform",
    kind: "law",
    startingSupport: 0,
    policyIcon: power,
    text:
      "Writer bonuses are paid to the Company Balance track instead. Note: writers still make money " +
      "from the Windfall event. If the Writer Privileges law is in effect, discard it.",
    persistence: "both",
    effects: [
      { timing: "ongoing", type: "writerBonusesToCompanyBalance" },
      { timing: "onPass", type: "discardPassedLaw", lawId: "writer-privileges" },
    ],
    source: source(6, 1, 3),
  }),
  card({
    id: "company-aids-government",
    number: 49,
    name: "Company Aids Government",
    kind: "law",
    startingSupport: 1,
    policyIcon: power,
    text:
      "Advance the value of Company Shares if possible e.g. from +1/-1 VP to +2/-2 VP. " +
      "Each Company Debt now costs £2 during Expenses.",
    persistence: "both",
    effects: [
      { timing: "onPass", type: "advanceCompanyShareValue" },
      { timing: "ongoing", type: "debtExpenseEach", amount: 2 },
    ],
    source: source(6, 2, 1),
    notes: ["Company share value is capped at +/-3 VP (rulebook p.36)."],
  }),
  card({
    id: "royal-protection",
    number: 50,
    name: "Royal Protection",
    kind: "law",
    startingSupport: -3,
    policyIcon: social,
    text:
      "If the Company would take any emergency loans the Chairman may discard this card to avoid " +
      "those loans and cancel any remaining expenses. Note: this means that Standing will not be " +
      "reduced from emergency loans, but will still be reduced from the Company not meeting expectations.",
    persistence: "ongoing",
    effectHandler: "royal-protection",
    startsPassedIn: ["1710", "long-1710"],
    source: source(6, 2, 2),
    notes: [
      "Starts passed in 1710 (scenario card front, Bridge Fronts p.9). Long 1710 begins identically to 1710 (rulebook p.4).",
      "Discarding is a Chairman choice during Revenue expenses, so it needs a decision point rather than a static modifier.",
    ],
  }),
  card({
    id: "public-demands-impeachment",
    number: 51,
    name: "Public Demands Impeachment!",
    kind: "dilemma",
    startingSupport: 1,
    policyIcon: power,
    text:
      "First, the Prime Minister picks one officeholder. If passed: Return officeholder to supply, " +
      "and add office card to the Vacant Offices box. If failed: Company Standing falls one space. " +
      "This may cause Company failure.",
    ifPassed: "Return officeholder to supply, and add office card to the Vacant Offices box.",
    ifFailed: "Company Standing falls one space. This may cause Company failure.",
    persistence: "immediate",
    effects: [{ timing: "onFail", type: "lowerStanding", spaces: 1 }],
    effectHandler: "public-demands-impeachment",
    source: source(6, 2, 3),
    notes: ["The handler covers picking the officeholder before the vote and removing them if passed."],
  }),
  card({
    id: "old-ideas-made-new",
    number: 52,
    name: "Old Ideas Made New!",
    kind: "dilemma",
    startingSupport: null,
    policyIcon: null,
    text:
      "Immediately search the discard pile and select one law (you may select a dilemma). Note: cards " +
      "drawn this turn are not yet in the discard pile. After resolving the vote, shuffle all discards, " +
      "cards drawn this turn, and this law into the deck. If there are no cards in the discard pile, " +
      "ignore this card, shuffle it back into the deck, and draw a new law.",
    persistence: "immediate",
    effectHandler: "old-ideas-made-new",
    source: source(6, 3, 1),
    notes: [
      "The card prints no policy banner and no starting support: the law selected from the discard pile supplies both.",
    ],
  }),
  card({
    id: "relief-demanded-for-indian-famine",
    number: 53,
    name: "Relief Demanded for Indian Famine!",
    kind: "dilemma",
    startingSupport: 1,
    policyIcon: tax,
    text:
      "If passed: Enact this policy consequence a second time. If failed: The Turmoil event occurs " +
      "in each home region. Add 1 unrest to every Company-controlled region.",
    ifPassed: "Enact this policy consequence a second time.",
    ifFailed:
      "The Turmoil event occurs in each home region. Add 1 unrest to every Company-controlled region.",
    persistence: "immediate",
    effects: [{ timing: "onPass", type: "enactPolicyConsequenceAgain" }],
    effectHandler: "relief-demanded-for-indian-famine",
    source: source(6, 3, 2),
    notes: ["The handler covers the failure branch (Turmoil in Bombay, Madras and Bengal, then unrest)."],
  }),
  card({
    id: "masses-demand-franchise",
    number: 54,
    name: "Masses Demand Franchise!",
    kind: "dilemma",
    startingSupport: 1,
    policyIcon: social,
    text:
      "If passed: Rotten Boroughs are now only worth one vote each. Votes now cost £2 instead of £1. " +
      "If failed: Nothing happens.",
    ifPassed: "Rotten Boroughs are now only worth one vote each. Votes now cost £2 instead of £1.",
    ifFailed: "Nothing happens.",
    persistence: "ongoing",
    effects: [
      { timing: "onPass", type: "rottenBoroughVotes", votes: 1 },
      { timing: "onPass", type: "voteCost", amount: 2 },
      { timing: "onFail", type: "nothing" },
    ],
    source: source(6, 3, 3),
    notes: [
      "Rulebook p.34-35 shows this card in the Selecting a Law example (the social-enterprise icon).",
      "Rotten Borough is a prestige card worth three votes (Bridge Fronts p.4, cards 28-30). The passed effects persist for the rest of the game.",
    ],
  }),
  card({
    id: "war-against-france",
    number: 55,
    name: "War Against France!",
    kind: "dilemma",
    startingSupport: 1,
    policyIcon: tax,
    text:
      "If passed: The Prime Minister selects 3 non-extra ships and 3 officers/regiments. Return ships " +
      "to shipyards or their supply. Officers/regiments are returned to their supplies. If failed: " +
      "Roll the storm die and resolve a Foreign Invasion event in the home region(s) associated with " +
      "any sea zone shown (if none, no invasion occurs).",
    ifPassed:
      "The Prime Minister selects 3 non-extra ships and 3 officers/regiments. Return ships to " +
      "shipyards or their supply. Officers/regiments are returned to their supplies.",
    ifFailed:
      "Roll the storm die and resolve a Foreign Invasion event in the home region(s) associated with " +
      "any sea zone shown (if none, no invasion occurs).",
    persistence: "immediate",
    effectHandler: "war-against-france",
    source: source(7, 1, 1),
    notes: ["Sea zone to home region: West Indian = Bombay, South Indian = Madras, East Indian = Bengal (rulebook p.33)."],
  }),
  card({
    id: "deregulation",
    number: 56,
    name: "Deregulation",
    kind: "specialSession",
    startingSupport: null,
    variableStartingSupport: { oneMarkerOnLinedSpace: 2, bothMarkersOnLinedSpaces: 6 },
    policyIcon: null,
    text:
      "At the start of a turn, the Prime Minister may call a session of Parliament to vote on this " +
      "law if either Standing or Debt is on a lined space. If either piece is on a space with a star, " +
      "the session must be called. In either case, no policy is proposed. The initial support of the " +
      "law depends on the status of Standing and Debt: [one plain and one lined circle] +2 / [two lined " +
      "circles] +6. The Company loses its trade monopoly. " +
      "Players may now start a firm. Clear half (rounding down) of Company Debt and place the Standing " +
      "marker on the “S” space on the track. Flip this card. If this law fails, set it aside. The " +
      "Prime Minister will remain in power and the value of Company shares is advanced.",
    persistence: "both",
    effectHandler: "deregulation",
    inLawDeck: false,
    startsPassedIn: ["1813"],
    usedIn: ["1758", "1813", "long-1710"],
    backText: "Deregulation. The Deregulation rules are in effect. Debtor’s Prison -1",
    source: {
      front: `${FRONTS} p.7 r1c2`,
      back: `${BACKS} p.18 r1c2`,
    },
    notes: [
      "The +2 / +6 support is printed beside icons: one plain and one lined circle (+2), two lined circles (+6). Interpretation: +2 when exactly one of the Standing and Debt markers is on a lined space, +6 when both are.",
      "Rulebook p.36: if passed the Prime Minister gains a passed law token; if failed the Company share VP token is placed or flipped (max +/-3) and the Prime Minister may vote against this law.",
      "1813 setup places this card Debtor's Prison side up (scenario card front, Bridge Fronts p.9). Debtor's Prison pieces lower their owner's score by 1 VP each (rulebook p.41).",
      "Not shuffled into the law deck: it is only voted on in a special session at the start of a turn in 1758 and Long 1710.",
    ],
  }),
];

export const lawsById: ReadonlyMap<string, LawCard> = new Map(laws.map((law) => [law.id, law]));

/** Law ids shuffled into the draw deck at setup (rulebook p.4 step 13). */
export const lawDeckForScenario = (scenario: LawScenarioId): string[] =>
  laws
    .filter(
      (law) =>
        law.inLawDeck && !law.startsPassedIn.includes(scenario) && !law.removedIn.includes(scenario),
    )
    .map((law) => law.id);

/** Laws placed faceup near the board at setup (scenario card "Passed Laws"). */
export const startingPassedLaws = (scenario: LawScenarioId): string[] =>
  laws.filter((law) => law.startsPassedIn.includes(scenario)).map((law) => law.id);
