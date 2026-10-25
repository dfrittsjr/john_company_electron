import type { RuleFigure } from "./rules-text";

/**
 * Pictures cropped from the printed rulebook (illustrations, component
 * pages, diagrams and the boxed worked examples), keyed by rules section id.
 * Files live in public/images/rules/. Same CC BY-NC-SA 4.0 credit as the text.
 */
export const rulesFigures: Record<string, RuleFigure[]> = {
  "components": [
    {
      src: "/images/rules/p02-components-page.webp",
      alt: "The rulebook's components page: the board, family and player pieces, India pieces, pawns, cubes and coins, each shown beside its description.",
      caption: "Components, part one",
      page: 2,
      width: 922,
      height: 1331,
    },
    {
      src: "/images/rules/p03-components-page.webp",
      alt: "The rulebook's second components page showing enterprise, office, prestige, blackmail, law and failure cards, setup cards, ships, the Prime Minister dial and regiments.",
      caption: "Components, part two",
      page: 3,
      width: 922,
      height: 1331,
    },
  ],
  "setup": [
    {
      src: "/images/rules/p05-table-setup-1710.webp",
      alt: "Top-down diagram of a table laid out for the 1710 scenario: board in the middle, ship supplies and coins on the left, event tiles and spare pieces on the right, decks of cards below.",
      caption: "Table setup for 1710 before setup cards",
      page: 5,
      width: 1554,
      height: 966,
    },
    {
      src: "/images/rules/p05-placing-family-members.webp",
      alt: "Icons for writer, officer, officer-in-training and commander pieces, then four setup cards (workshop, shipyard, luxury, chairman) with arrows showing where each family member goes.",
      caption: "Placing family members from setup cards",
      page: 5,
      width: 766,
      height: 1333,
    },
  ],
  "concepts": [
    {
      src: "/images/rules/p07-reading-india-example.webp",
      alt: "A close-up of part of the India map with call-outs explaining towers, order values, a closed order token, an empire, a governor overlay, unrest cubes and loot tokens.",
      caption: "Reading India example",
      page: 7,
      width: 1550,
      height: 1083,
    },
  ],
  "sequence": [
    {
      src: "/images/rules/p10-political-banditti.webp",
      alt: "A hand-coloured caricature of three men in highway-robber poses attacking a figure on a camel loaded with coins.",
      caption: "The Political-Banditti Assailing the Savior of India, James Gillray, 1786",
      page: 10,
      width: 746,
      height: 1000,
    },
  ],
  "london-season": [
    {
      src: "/images/rules/p11-attrition-retiring-example.webp",
      alt: "Worked example: dice are rolled for office cards, fatigue cubes are added, a retiring office moves its holder to the Pensioners box, and two pensioners buy estates with prizes.",
      caption: "Attrition and Retiring Pensioners",
      page: 11,
      width: 1408,
      height: 762,
    },
    {
      src: "/images/rules/p12-london-display-example.webp",
      alt: "Worked example of the Prestige Cards step: Blue peeks at a blackmail card and takes Lord Highgate, Yellow takes another card, and the last card is discarded.",
      caption: "London Display in Action",
      page: 12,
      width: 1516,
      height: 525,
    },
  ],
  "hiring": [
    {
      src: "/images/rules/p15-company-structure.webp",
      alt: "Flow chart of the Company's offices: the Chairman, Director of Trade, Manager of Shipping, Presidents, Governors, Military Affairs, Commanders, Officers and Writers, with arrows for how each is hired.",
      caption: "The Company's Structure",
      page: 15,
      width: 1591,
      height: 883,
    },
    {
      src: "/images/rules/p15-chairman-election-example.webp",
      alt: "Worked example: five Court of Directors shares, Blue cannot get a majority, so Yellow and Pink strike a deal and Yellow is elected Chairman.",
      caption: "Chairman Election",
      page: 15,
      width: 1316,
      height: 516,
    },
    {
      src: "/images/rules/p16-general-hiring-example.webp",
      alt: "Worked example: the Chairman is hiring the Director of Trade, with candidate cards in each family's colour and an arrow showing offices being filled along the board ribbon.",
      caption: "General Hiring",
      page: 16,
      width: 1308,
      height: 1066,
    },
  ],
  "success-checks": [
    {
      src: "/images/rules/p17-chance-of-success.webp",
      alt: "Table of success, failure and catastrophic failure percentages when rolling one to seven dice.",
      caption: "Chance of Success",
      page: 17,
      width: 1375,
      height: 679,
    },
  ],
  "chairman": [
    {
      src: "/images/rules/p18-seeking-debt-example.webp",
      alt: "Worked example: the Company has 2 Debt and a Balance of 3 pounds, the Chairman raises debt by three spaces and adds 15 pounds to the Balance, shown on the Debt and Balance tracks.",
      caption: "Seeking Debt",
      page: 18,
      width: 1516,
      height: 475,
    },
  ],
  "director-of-trade": [
    {
      src: "/images/rules/p18-special-envoy-example.webp",
      alt: "Worked example: the Director of Trade spends 3 pounds, rolls three dice and opens an order in Maratha because Bengal is Company-controlled.",
      caption: "Special Envoy",
      page: 18,
      width: 1500,
      height: 450,
    },
  ],
  "military-affairs": [
    {
      src: "/images/rules/p19-assigning-commanders-example.webp",
      alt: "Worked example showing the Armies of Bombay, Madras and Bengal with their pieces, and who becomes Commander in each.",
      caption: "Assigning Commanders",
      page: 19,
      width: 683,
      height: 1141,
    },
  ],
  "presidency-operations": [
    {
      src: "/images/rules/p21-trading-example.webp",
      alt: "Worked example: the President of Madras rolls four dice, places three writers and a filled order token, with red arrows over the India map and the resulting payouts.",
      caption: "Trading",
      page: 21,
      width: 1383,
      height: 1029,
    },
    {
      src: "/images/rules/p21-blood-on-thunder.webp",
      alt: "A caricature of Warren Hastings carried to safety across the sea on the shoulders of Lord Chancellor Thurlow, with bags of money.",
      caption: "Blood on Thunder Fording the Red Sea, James Gillray, 1788",
      page: 21,
      width: 1213,
      height: 873,
    },
  ],
  "commanders-deploy": [
    {
      src: "/images/rules/p22-deploying-example.webp",
      alt: "Worked example: the Commander of Madras attacks Hyderabad with three officers and two regiments, rolling five dice of which two are removed for the region's strength.",
      caption: "Deploying",
      page: 22,
      width: 1408,
      height: 750,
    },
    {
      src: "/images/rules/p23-dividing-loot-example.webp",
      alt: "Worked example of splitting 15 pounds of loot between three officers and two regiments, with final payouts of 6, 3, 2 and 4 pounds.",
      caption: "Dividing Loot",
      page: 23,
      width: 1408,
      height: 550,
    },
  ],
  "governors": [
    {
      src: "/images/rules/p24-administering-example.webp",
      alt: "Worked example: a Governor with a four-dice pool takes the Administer action several times, adding tax, unrest and finally a Company ship.",
      caption: "Administering",
      page: 24,
      width: 1508,
      height: 800,
    },
  ],
  "superintendent-china": [
    {
      src: "/images/rules/p25-trading-in-china-example.webp",
      alt: "Worked example: the Superintendent of Trade in China rolls three dice for three ships, succeeds, and increases the Balance by 16 pounds.",
      caption: "Trading in China",
      page: 25,
      width: 1458,
      height: 616,
    },
    {
      src: "/images/rules/p25-china-trade-illustration.webp",
      alt: "A monochrome engraving of a long warehouse hall, with tall columns, ladders and workers moving goods.",
      caption: "Interior of an East India Company warehouse",
      page: 25,
      width: 1306,
      height: 740,
    },
  ],
  "events-in-india": [
    {
      src: "/images/rules/p28-flipping-an-event-example.webp",
      alt: "Worked example: the newly drawn event tile is Turmoil, occurring in Maratha, shown beside the event tile and its matching region card.",
      caption: "Flipping an Event",
      page: 28,
      width: 1000,
      height: 491,
    },
  ],
  "region-loss": [
    {
      src: "/images/rules/p29-region-loss-example.webp",
      alt: "Worked example of a Crisis against Bengal: the Commander's trophies, officer rout, restoring local authority, and the Standing loss, with map snapshots.",
      caption: "Region Loss Example",
      page: 29,
      width: 1408,
      height: 1108,
    },
  ],
  "elephants-march": [
    {
      src: "/images/rules/p30-elephants-march-example.webp",
      alt: "Worked example: after resolving a Crisis the Elephant moves to Mysore and turns to face Bombay, shown on a small map.",
      caption: "Elephant's March",
      page: 30,
      width: 625,
      height: 1116,
    },
    {
      src: "/images/rules/p30-elephant-procession.webp",
      alt: "A painting of three noblemen riding a decorated elephant in procession past a crowd.",
      caption: "Three Noblemen in Procession on an Elephant, c. 1790",
      page: 30,
      width: 1252,
      height: 753,
    },
  ],
  "events-described": [
    {
      src: "/images/rules/p31-peace-example.webp",
      alt: "Worked example: Peace is drawn at the Elephant's border, a tower is added in Mysore, closed orders are opened, and the Elephant marches towards Hyderabad.",
      caption: "Peace Example",
      page: 31,
      width: 1441,
      height: 833,
    },
    {
      src: "/images/rules/p32-mysore-invades-example.webp",
      alt: "Worked example: Mysore, strength 3, invades Hyderabad, strength 2; the invasion succeeds, a new empire forms and the Elephant moves on.",
      caption: "Mysore Invades",
      page: 32,
      width: 1408,
      height: 733,
    },
  ],
  "parliament": [
    {
      src: "/images/rules/p34-selecting-a-law-example.webp",
      alt: "Worked example: the Prime Minister reveals two laws, picks the Calico Acts and turns the policy wheel to a tax space.",
      caption: "Selecting a Law and Policy",
      page: 34,
      width: 1441,
      height: 666,
    },
  ],
  "parliament-voting": [
    {
      src: "/images/rules/p35-reform-meeting-illustration.webp",
      alt: "A period illustration of a large crowd with banners gathered around a platform in front of a building.",
      caption: "A crowd at a public meeting",
      page: 35,
      width: 1226,
      height: 453,
    },
  ],
  "deregulation": [
    {
      src: "/images/rules/p41-trading-with-firms-example.webp",
      alt: "Worked example: Green's firm and the President of Madras fill orders across the map in initiative order, with dice and red and green arrows.",
      caption: "Trading with Firms",
      page: 41,
      width: 1400,
      height: 1183,
    },
    {
      src: "/images/rules/p42-firm-expenses-example.webp",
      alt: "Worked example: Green pays 2 pounds for ships and 5 for shares, then pays out dividends, with the firm charter and tracks shown.",
      caption: "Firm Expenses and Dividends",
      page: 42,
      width: 1475,
      height: 916,
    },
  ],
  "one-or-two": [
    {
      src: "/images/rules/p45-crown-ai-card.webp",
      alt: "Annotated AI card and family board with numbered markers for the Presidency order, direction, card position, climate chart and region priorities.",
      caption: "Crown AI card",
      page: 45,
      width: 1250,
      height: 941,
    },
    {
      src: "/images/rules/p46-crown-favors.webp",
      alt: "Two examples of favors: plus one for fitting a Crown ship and minus one for fitting a specific ship, each with a red cube.",
      caption: "Crown favors",
      page: 46,
      width: 1116,
      height: 320,
    },
  ],
};
