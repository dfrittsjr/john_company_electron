import type { CrownClimate } from "./crown";

// The Crown Handbook (printnplay/Rulebooks/John Company Solo Handbook.pdf, pp.2-16) and the
// rulebook's solo and two-player pages (pp.43-46), transcribed twice independently and compared
// field by field (2026-10-25): every favour cost, climate span, table cell and AI card value agreed.
// Text is verbatim. Icons are written in braces: {bull} {stag} {lion} {bear} {peacock} are the
// climates, {cube} a Crown promise cube, {die} a die; others name the printed icon.
//
// A favour's `cost` is the printed number of cubes: "+1" the player gains cubes from the Crown,
// "-2" the player pays the Crown, "X" as explained in its text, "—" not available in that climate.
// When it depends on the climate, `cost` gives it per climate.

export type CrownFavor = {
  text: string;
  cost: string | Record<CrownClimate, string>;
  /** Printed in a darker box: the player must perform it when it applies. */
  mandatory?: boolean;
  /** Printed "[SOLO ONLY]" or "[2P ONLY]". */
  mode?: "solo" | "twoPlayer";
};

export type CrownTable = { caption: string; columns: string[]; rows: string[][] };

export type CrownHandbookSection = {
  title: string;
  subtitle?: string;
  text?: string;
  favors?: CrownFavor[];
  tables?: CrownTable[];
  notes?: string[];
};

export type CrownHandbookPage = { page: number; sections: CrownHandbookSection[] };

export const crownHandbook: CrownHandbookPage[] = [
  {
    "page": 2,
    "sections": [
      {
        "title": "Vote to Deregulate",
        "text": "The Crown will never initiate The Vote to Deregulate when they are Prime Minister unless they must. They will always vote last and against. They may spend up to the amount below (once) if it moves the Votes marker to a failing position:",
        "tables": [
          {
            "caption": "",
            "columns": [
              "{bull}",
              "{stag}",
              "{lion}",
              "{bear}",
              "{peacock}"
            ],
            "rows": [
              [
                "£6",
                "£5",
                "£4",
                "£3",
                "£2"
              ]
            ]
          }
        ]
      },
      {
        "title": "London Season",
        "text": "At the start of this phase (before retirements) you may:",
        "favors": [
          {
            "text": "Take £1 from the Crown family treasury.",
            "cost": "-2"
          }
        ]
      },
      {
        "title": "Retirements",
        "subtitle": "London Season",
        "text": "The Crown will retire pensioners one at a time, each time choosing the highest VP prize spending no more than half (rounded up) of their remaining family treasury. The Crown will only retire to the £2 space if it entitles them to a card from the London Season.\n\n[HARD/EXPERT ONLY] During Final Retirement, the Crown will spend as much as possible on pensioners.\n\nOnce the Crown has completed their retirements, you may:",
        "favors": [
          {
            "text": "Take £1 from the Crown family treasury.",
            "cost": "-1"
          }
        ]
      },
      {
        "title": "Special Retirements",
        "subtitle": "London Season",
        "text": "When Deregulation is in effect, the Crown will take the single highest VP special retirement they can afford."
      },
      {
        "title": "Prestige Cards",
        "subtitle": "London Season",
        "text": "The Crown selects a card from the London Season based on the location of the shaded card at the top of the faceup AI card. If that card not available, they choose the next card to the right, wrapping around to the leftmost card.\n\n{hand-bullet} The Crown ignores any text effects on Spouse cards but receives retirement discounts and victory points.\n\n{hand-bullet} Any Crown blackmail cards are kept facedown.\n\n{hand-bullet} Any enterprise cards are awarded faceup and are effective for the Crown.\n\n{hand-bullet} If any card says the Crown \"may\" do something, they will not.\n\n{hand-bullet} If any card requires permission or consent from the Crown, they will not give it.",
        "favors": [
          {
            "text": "Take an enterprise prestige card from the Crown.",
            "cost": "-5"
          },
          {
            "text": "Take a blackmail card from the Crown. Note: You may not peek at blackmail cards held by the Crown.",
            "cost": "-4"
          }
        ]
      },
      {
        "title": "Free Writer Enlistment",
        "subtitle": "Family",
        "text": "If there are four or more vacant offices, the Crown will first Enlist Writer as a free action. Then, if there is a Presidential vacancy with no Crown writer, they will use a free action to Enlist Writer in that Presidency."
      },
      {
        "title": "Family Actions",
        "subtitle": "Family",
        "text": "The Crown always takes two family actions each turn based on the following chart, proceeding left to right. Skip any action that is not viable or cannot be afforded.\n\n[2P ONLY] The Crown takes one family action each turn."
      },
      {
        "title": "Extra Action",
        "subtitle": "Family",
        "text": "If the most recently passed extra action is an action the Crown chooses to take based on the following chart, the Crown will treat that action as an extra action. E.g. the Crown may end up taking 3 actions from the following chart in a solo game.\n\nAfter the Crown has completed their actions from the following chart, they will attempt to take the most recently passed extra action unless they have already done so.",
        "tables": [
          {
            "caption": "Family action chart (one row per climate/family emblem; actions proceed left to right; icons: eic-shield = Seek Shares symbol (heart-shaped shield with E/I/C letters), anchor, writer-hand = hand holding quill (Enlist Writer), musket-fort = flintlock musket in front of a fort/army, top-hat, cog = workshop-style gear)",
            "columns": [
              "Climate",
              "1",
              "2",
              "3",
              "4",
              "5"
            ],
            "rows": [
              [
                "{bull}",
                "{eic-shield}",
                "{anchor}",
                "{writer-hand}",
                "{writer-hand}",
                "{musket-fort}"
              ],
              [
                "{stag}",
                "{eic-shield}",
                "{writer-hand}",
                "{anchor}",
                "{writer-hand}",
                "{musket-fort}"
              ],
              [
                "{lion}",
                "{anchor}",
                "{musket-fort}",
                "{writer-hand}",
                "{musket-fort}",
                ""
              ],
              [
                "{bear}",
                "{musket-fort}",
                "{top-hat}",
                "{cog}",
                "{musket-fort}",
                "{writer-hand}"
              ],
              [
                "{peacock}",
                "{cog}",
                "{top-hat}",
                "{musket-fort}",
                "{musket-fort}",
                "{writer-hand}"
              ]
            ]
          }
        ],
        "notes": [
          "{eic-shield} When Seeking Shares, the Crown places on the cheapest space (will take rightmost of the £3 spots if £3 is the cheapest).",
          "{writer-hand} When Enlisting Writers, the Crown always gives priority to:\n{hand-bullet} Vacant Presidencies with no Crown writers.\n{hand-bullet} Crown Presidencies with the fewest Crown writers.\n{hand-bullet} Presidencies with the fewest Crown writers.\n{hand-bullet} Presidency priority on AI card."
        ]
      }
    ]
  },
  {
    "page": 3,
    "sections": [
      {
        "title": "Firms Phase",
        "text": "The Crown never creates a private firm. They always give consent for dissolution and merging of firms.",
        "favors": [
          {
            "text": "If you form a private firm, you must perform this favor (using as many {cube} as you have if you have less than 3 {cube}).",
            "cost": "-3",
            "mandatory": true
          }
        ]
      },
      {
        "title": "Acquiring Ships",
        "subtitle": "Firms Phase",
        "favors": [
          {
            "text": "Consent to fit a Crown ship.",
            "cost": "-2"
          },
          {
            "text": "Consent to buyback a Crown-owned ship from the Company.",
            "cost": "-2"
          }
        ]
      },
      {
        "title": "Investing in a Firm",
        "subtitle": "Firms Phase",
        "text": "Only once all players have finished investing, the Crown may seek to invest in a firm if the Crown has the majority of Company shares. They will invest using Company shares (unless they are weak), and then workshops. The Crown will never invest if it gives them the majority of shares in that firm.\n\n[2P ONLY] The Crown will initiate each investment according to the Player Button, switching after each.",
        "favors": [
          {
            "text": "Will invest in your firm for one investment.",
            "cost": {
              "bull": "-2",
              "stag": "-2",
              "lion": "—",
              "bear": "—",
              "peacock": "—"
            }
          },
          {
            "text": "[SOLO ONLY] Deny the Crown's investment. X = value of firm.",
            "cost": {
              "bull": "—",
              "stag": "—",
              "lion": "-X",
              "bear": "-X",
              "peacock": "-X"
            },
            "mode": "solo"
          },
          {
            "text": "[2P ONLY] The Crown will give consent for a hostile takeover from a player holding the Player Button. X = number of firm shares the Crown holds.",
            "cost": "-X",
            "mode": "twoPlayer"
          }
        ],
        "tables": [
          {
            "caption": "Investing climate chart",
            "columns": [
              "{bull}{stag}",
              "{lion}{bear}{peacock}"
            ],
            "rows": [
              [
                "Will not invest.",
                "Will seek one investment in a firm."
              ]
            ]
          }
        ]
      },
      {
        "title": "Hiring",
        "text": "Once the New Company Shares step is complete (and not before), you may:",
        "favors": [
          {
            "text": "Give £1 from your family treasury to the Crown if the Crown has a majority of Company shares.",
            "cost": "+1"
          },
          {
            "text": "Take a share from the Crown.",
            "cost": {
              "bull": "-6",
              "stag": "-4",
              "lion": "-4",
              "bear": "-3",
              "peacock": "-3"
            }
          },
          {
            "text": "Give a share to the Crown.",
            "cost": {
              "bull": "+2",
              "stag": "-3",
              "lion": "-3",
              "bear": "-4",
              "peacock": "-4"
            }
          }
        ]
      },
      {
        "title": "Chairman Election",
        "text": "If the Crown has majority of shares (or an equality and is former Chairman), they will elect themselves as the new Chairman.",
        "favors": [
          {
            "text": "If the Crown has majority (or an equality and is former Chairman), a player may bribe the Crown to elect them as Chairman. Under Deregulation this becomes -12 {cube}.",
            "cost": "-3"
          },
          {
            "text": "[2P ONLY] If the Crown does not have a majority, any player can persuade the Crown to support their election. X = number of supporting Crown shares.",
            "cost": "-X",
            "mode": "twoPlayer"
          },
          {
            "text": "A player with majority (or an equality and is former Chairman) votes to elect the Crown as Chairman. Under Deregulation this becomes +6 {cube}.",
            "cost": "+3"
          }
        ]
      },
      {
        "title": "When You Are Hiring",
        "favors": [
          {
            "text": "Consent for Nepotism.",
            "cost": "-2"
          },
          {
            "text": "Hire a Crown family member over any non-Crown family member.",
            "cost": "+1"
          }
        ]
      },
      {
        "title": "When the Crown is Hiring",
        "text": "The Crown always hires their own family if able.",
        "favors": [
          {
            "text": "[SOLO ONLY] You must give consent for nepotism to the Crown when required if they have 2 or more promises. Otherwise, consent is optional.",
            "cost": "+2",
            "mandatory": true,
            "mode": "solo"
          },
          {
            "text": "[2P ONLY] When both players are candidates, each player may perform this favor if they give consent unanimously.",
            "cost": "+1",
            "mode": "twoPlayer"
          }
        ]
      },
      {
        "title": "Director of Trade/Governor General Selection",
        "subtitle": "When the Crown is Hiring",
        "text": "The Crown hires the first eligible officeholder, clockwise or counterclockwise as indicated by the AI card, along the Company Operation ribbon starting at Chairman."
      },
      {
        "title": "Candidate Priority",
        "subtitle": "When the Crown is Hiring",
        "text": "The Crown will consider candidates with priority to writers, officers, and then Governors. Use AI card to break ties between candidates.",
        "favors": [
          {
            "text": "Make a hiring decision for the Crown.",
            "cost": "-3"
          }
        ]
      }
    ]
  },
  {
    "page": 4,
    "sections": [
      {
        "title": "If You Are Chairman",
        "subtitle": "Chairman",
        "favors": [
          {
            "text": "You must always perform this favor if able.",
            "cost": "-1",
            "mandatory": true
          }
        ],
        "notes": [
          "Page 4 layout: Chairman heading has a gavel icon at left; the lower half of the page is a full-width engraving of East India House (no text)."
        ]
      },
      {
        "title": "Seek Debt",
        "subtitle": "If You Are Chairman",
        "favors": [
          {
            "text": "Consent from Crown shares for the first additional advancement above 3 Debt Marker advances.",
            "cost": {
              "bull": "-1",
              "stag": "-2",
              "lion": "-3",
              "bear": "-4",
              "peacock": "-6"
            }
          },
          {
            "text": "Consent from a Crown share for any additional Debt Marker advances.",
            "cost": "-1"
          }
        ]
      },
      {
        "title": "Allocate Company Balance",
        "subtitle": "If You Are Chairman",
        "favors": [
          {
            "text": "Allocate £3 to a Crown office.",
            "cost": {
              "bull": "+1",
              "stag": "—",
              "lion": "—",
              "bear": "—",
              "peacock": "—"
            }
          },
          {
            "text": "Allocate £4 to a Crown office.",
            "cost": {
              "bull": "—",
              "stag": "+1",
              "lion": "+1",
              "bear": "+1",
              "peacock": "—"
            }
          },
          {
            "text": "Allocate £5 to a Crown office.",
            "cost": {
              "bull": "—",
              "stag": "—",
              "lion": "—",
              "bear": "—",
              "peacock": "+1"
            }
          }
        ]
      },
      {
        "title": "Set Climate",
        "subtitle": "If You Are Chairman",
        "text": "After you have finished acting, flip a new AI card and set the climate on the Crown family board."
      }
    ]
  },
  {
    "page": 5,
    "sections": [
      {
        "title": "Set Climate",
        "subtitle": "If the Crown is Chairman",
        "text": "Before the Crown acts, flip a new AI card and set the climate on the Crown family board."
      },
      {
        "title": "Seek Debt",
        "subtitle": "If the Crown is Chairman",
        "text": "Advance Debt marker for each…",
        "favors": [
          {
            "text": "Request an additional Company Debt advancement.",
            "cost": {
              "bull": "-1",
              "stag": "-1",
              "lion": "-2",
              "bear": "-2",
              "peacock": "-3"
            }
          },
          {
            "text": "Request one less Company Debt advancement.",
            "cost": {
              "bull": "-2",
              "stag": "-2",
              "lion": "-2",
              "bear": "-1",
              "peacock": "—"
            }
          }
        ],
        "tables": [
          {
            "caption": "Advance Debt marker for each…",
            "columns": [
              "{bull}{stag}",
              "{lion}",
              "{bear}",
              "{peacock}"
            ],
            "rows": [
              [
                "…Presidency with an open home port.",
                "…sea zone with less than 2 ships.",
                "…Presidency where the Crown is Commander or has majority of total Army box pieces.",
                "Do not advance Debt marker."
              ]
            ]
          }
        ]
      },
      {
        "title": "Allocate Company Balance",
        "subtitle": "If the Crown is Chairman",
        "text": "Allocate funds in priority order. Give as much as possible to any step that cannot be performed in full.\n\nIf there is a remainder, allocate remaining funds to the Manager of Shipping.",
        "favors": [
          {
            "text": "At any point before each step, request that £3 (or less) be allocated to a specific office.",
            "cost": "-1"
          }
        ],
        "tables": [
          {
            "caption": "Allocation priority by climate",
            "columns": [
              "{bull}",
              "{stag}",
              "{lion}",
              "{bear}",
              "{peacock}"
            ],
            "rows": [
              [
                "1. £4 to each Presidency with an open home port.\n2. £5 to Director of Trade / Governor General.",
                "1. £4 to each Crown Presidency with an open home port.\n2. £1 to each Presidency with a Crown writer.\n3. £3 to Director of Trade / Governor General.",
                "1. £5 to Manager of Shipping for each Presidency with a sea zone with less than 2 ships.\n2. £4 to the Crown Presidency with most ships.\n3. £3 to Director of Trade / Governor General.\n4. £1 to each Presidency with a Crown writer.",
                "1. £ 4 to each Presidency where Crown has a majority of pieces in the Army box.\n2. £2 to each Presidency with a Crown Governor.\n3. £4 to Crown Governor General.\n4. £2 to each Presidency with a Crown writer.",
                "1. £5 to each Presidency where Crown is Commander or has majority of officers.\n2. £2 to each Presidency with a Crown Governor.\n3. £5 to Crown Governor General."
              ]
            ]
          }
        ]
      }
    ]
  },
  {
    "page": 6,
    "sections": [
      {
        "title": "Special Envoy",
        "subtitle": "If you are the Director of Trade",
        "text": "If you open trade with China use the same rules as hiring to hire a new office.",
        "favors": [
          {
            "text": "Open an order in the home region of a Crown Presidency that has at least one Crown writer.",
            "cost": {
              "bull": "+1",
              "stag": "+1",
              "lion": "+1",
              "bear": "—",
              "peacock": "—"
            }
          },
          {
            "text": "After the office has acted, no Presidency has 2 or more ships or writers than any other Presidency.",
            "cost": {
              "bull": "+1",
              "stag": "+1",
              "lion": "+1",
              "bear": "—",
              "peacock": "—"
            }
          }
        ],
        "notes": [
          "Page 6 heading 'Director of Trade / Governor General' has a small portrait icon at left."
        ]
      },
      {
        "title": "Special Envoy",
        "subtitle": "If the Crown is Director of Trade",
        "text": "The Crown will take this action using exactly £3 of available funds with priority going to the northernmost closed order in the first priority region, given by the current AI card, not controlled by the Company. They will skip if £3 is not available, and repeat as long as there is £3+ available.",
        "favors": [
          {
            "text": "Force the Crown to spend more or less money (any amount, including zero, and optionally skip additional Special Envoy actions).",
            "cost": {
              "bull": "-2",
              "stag": "-2",
              "lion": "-1",
              "bear": "-1",
              "peacock": "-1"
            }
          },
          {
            "text": "Target a specific order.",
            "cost": "-1"
          },
          {
            "text": "Open trade with China.",
            "cost": "-3"
          }
        ]
      },
      {
        "title": "Transfers",
        "subtitle": "If the Crown is Director of Trade",
        "text": "The Crown will make 2 transfers from the priority list.\n\nIf there is more than one viable Presidency to transfer from/to, use AI card's arrows to break ties, determining the location in which the transfer occurs from first.\n\nIf there is more than one viable ship to transfer, use Company ships, then non-fatigued ships, then Crown ships, then player ships.\n\nE.g. If all three Presidencies are candidates to be transferred from, and all contain 2 ships, then the Presidency with the fewest ships would be the one pointed at by the black arrow on the AI card. If the two ships eligible for transfer are a player ship and a fatigued Crown ship, the Crown would transfer the player ship.",
        "favors": [
          {
            "text": "Prevent a transfer (counts as one of two available to the Crown).",
            "cost": "-1"
          },
          {
            "text": "Transfer 1 writer/ship to a Presidency/sea zone of player's choice (counts as one of two available to the Crown). Players may not undo a previous transfer.",
            "cost": "-2"
          }
        ]
      }
    ]
  },
  {
    "page": 7,
    "sections": [
      {
        "title": "Transfer Priority List",
        "subtitle": "Director of Trade / Governor General",
        "text": "Skip any that cannot be performed, and stop once 2 transfers have been performed or the bottom of the list has been reached.",
        "tables": [
          {
            "caption": "Transfer priority by climate",
            "columns": [
              "{bull}",
              "{stag}",
              "{lion}",
              "{bear}",
              "{peacock}"
            ],
            "rows": [
              [
                "1. A Crown writer from Presidency with shortest trade route to Presidency with longest.\n2. A ship from Presidency with shortest trade route to Presidency with longest.\n3. A player writer from Presidency with longest trade route to Presidency with shortest.",
                "1. A ship from Presidency with shortest trade route to Presidency with longest.\n2. A Crown writer from Presidency with fewest ships to Presidency with most ships.\n3. A player writer from Presidency with longest trade route to Presidency with shortest.",
                "1. A ship from Presidency with fewest Crown writers to Presidency with most Crown writers.\n2. A Crown writer from Presidency with fewest ships to Presidency with most.\n3. A ship from Presidency with fewest Crown writers to China.\n4. A ship from Presidency with most player writers to Presidency with the fewest player writers.",
                "1. A ship from player Presidency to Crown Presidency.\n2. A Crown writer from Presidency with fewest ships to Presidency with most.\n3. A Crown writer from player Presidency to Crown Presidency.",
                "1. A Crown writer from player Presidency to Crown Presidency.\n2. A ship from Presidency with fewest Crown writers to Presidency with most Crown writers.\n3. A ship from Presidency with fewest Crown writers to Presidency with most Crown writers.\n4. A player writer from player Presidency to Crown Presidency."
              ]
            ]
          }
        ]
      },
      {
        "title": "If you are Governor General",
        "subtitle": "Director of Trade / Governor General",
        "favors": [
          {
            "text": "Add money to a Crown office's treasury.",
            "cost": "+1"
          },
          {
            "text": "Place a regiment into an Army associated with a Crown Presidency.",
            "cost": "+1"
          },
          {
            "text": "Place a Company ship into a sea zone associated with a Crown Presidency.",
            "cost": "+1"
          }
        ]
      },
      {
        "title": "Govern",
        "subtitle": "If the Crown is Governor General",
        "text": "The Crown will perform the Govern action as long as they roll the required number of dice given by this table:",
        "favors": [
          {
            "text": "Increase or decrease the required number of dice by 1 {die}.",
            "cost": "-1"
          },
          {
            "text": "Choose a different result for a successful Govern action.",
            "cost": "-2"
          }
        ],
        "tables": [
          {
            "caption": "Required dice",
            "columns": [
              "{bull}",
              "{stag}{lion}{bear}",
              "{peacock}"
            ],
            "rows": [
              [
                "5 {die}",
                "3 {die}",
                "2 {die}"
              ]
            ]
          },
          {
            "caption": "If the Govern action is successful the Crown will:",
            "columns": [
              "{bull}{stag}",
              "{lion}",
              "{bear}{peacock}"
            ],
            "rows": [
              [
                "Tax (adding funds evenly among Crown Presidencies, then remainder to Company Balance).",
                "Build Company Ship.",
                "Commission Regiment."
              ]
            ]
          }
        ]
      }
    ]
  },
  {
    "page": 8,
    "sections": [
      {
        "title": "If You Are Manager of Shipping",
        "subtitle": "Manager of Shipping",
        "favors": [
          {
            "text": "Fit a Crown ship.",
            "cost": "+1"
          },
          {
            "text": "Place a ship in a Crown Presidency or Crown Superintendent of China.",
            "cost": "+1"
          }
        ]
      },
      {
        "title": "Fitting Ships",
        "subtitle": "If the Crown is Manager of Shipping",
        "text": "The Crown will fit as many of their ships as possible, then player ships (use Player Button to break ties.)",
        "favors": [
          {
            "text": "Fit a specific ship. If the Crown fits one of your ships, you must always perform this favor if able, and prior to picking the sea zone.",
            "cost": "-1"
          }
        ]
      },
      {
        "title": "Buying Company Ships",
        "subtitle": "If the Crown is Manager of Shipping",
        "favors": [
          {
            "text": "Buys a Company ship.",
            "cost": {
              "bull": "-1",
              "stag": "—",
              "lion": "—",
              "bear": "—",
              "peacock": "-2"
            }
          },
          {
            "text": "Does not buy a Company ship.",
            "cost": {
              "bull": "—",
              "stag": "-2",
              "lion": "—",
              "bear": "-1",
              "peacock": "—"
            }
          },
          {
            "text": "Buys as many Company ships as you wish.",
            "cost": {
              "bull": "—",
              "stag": "—",
              "lion": "-3",
              "bear": "—",
              "peacock": "—"
            }
          },
          {
            "text": "The Crown buys another Company ship.",
            "cost": {
              "bull": "-1",
              "stag": "-1",
              "lion": "—",
              "bear": "-2",
              "peacock": "-2"
            }
          }
        ],
        "tables": [
          {
            "caption": "Buying Company Ships: default behaviour then the favor effect (favor cost -1/-2/-3/-1/-2 under respective climates)",
            "columns": [
              "{bull}",
              "{stag}",
              "{lion}",
              "{bear}",
              "{peacock}"
            ],
            "rows": [
              [
                "Will not buy Company ships.",
                "Will buy 1 Company ship, if able.",
                "Will buy as many Company ships as able.",
                "Will buy 1 Company ship, if able.",
                "Will not buy Company ships."
              ],
              [
                "Buys a Company ship.",
                "Does not buy a Company ship.",
                "Buys as many Company ships as you wish.",
                "Does not buy a Company ship.",
                "Buys a Company ship."
              ]
            ]
          }
        ]
      },
      {
        "title": "Leasing Extra Ships",
        "subtitle": "If the Crown is Manager of Shipping",
        "text": "If there are funds remaining in the treasury, The Crown will lease as many extra ships as possible.",
        "favors": [
          {
            "text": "The Crown must leave £2 unspent.",
            "cost": "-1"
          }
        ]
      },
      {
        "title": "Placing Ships",
        "subtitle": "If the Crown is Manager of Shipping",
        "text": "The Crown will place all ships they have fitted, bought, and/or leased this turn…\n\nIn this chart, the highest number may be zero.",
        "favors": [
          {
            "text": "The Crown fits one ship into sea zone (or China) of your choice.",
            "cost": "-1"
          }
        ],
        "tables": [
          {
            "caption": "Placing ships by climate",
            "columns": [
              "{bull}",
              "{stag}",
              "{lion}",
              "{bear}",
              "{peacock}"
            ],
            "rows": [
              [
                "…in the Presidency's sea zone with the longest open trade route, with priority going to a Crown Presidency.",
                "…in the Presidency's sea zone with longest open trade route, with priority going to Presidency with more Crown writers.",
                "…in a Crown Presidency's sea zone. If none, Presidency with the highest number of writers.",
                "…in the Presidency's sea zone with the highest number of Crown writers.",
                "…in China, if possible; otherwise, in the Presidency's sea zone with highest number of Crown writers."
              ]
            ]
          }
        ]
      }
    ]
  },
  {
    "page": 9,
    "sections": [
      {
        "title": "If you are Military Affairs",
        "subtitle": "Military Affairs",
        "favors": [
          {
            "text": "Assign the Crown as Commander of an Army when able. This always applies, even if you have no choice but to assign the Crown as Commander.",
            "cost": "+1",
            "mandatory": true
          }
        ],
        "notes": [
          "Heading 'Military Affairs' has a small cannon icon at left."
        ]
      },
      {
        "title": "Transfers",
        "subtitle": "If the Crown is Military Affairs",
        "text": "The Crown will attempt to perform two army transfers. The Crown will transfer according to the Transfer Priority below, skipping any transfer that cannot be completed and any transfer that undoes a previous transfer from this turn.",
        "favors": [
          {
            "text": "Transfer 1 officer or regiment from a Presidency to another Presidency (counts as one of the Crown's two transfers).",
            "cost": "-1"
          },
          {
            "text": "Prevent any transfer from happening this round (counts as one of the Crown's two transfers).",
            "cost": "-1"
          }
        ]
      },
      {
        "title": "Transfer Priority",
        "subtitle": "If the Crown is Military Affairs",
        "text": "The Crown will transfer regiments, then Crown officers, then player officers using the following priority.\n\nNote: If there is more than one viable Army to transfer from/to, use AI card's arrows to break ties.",
        "tables": [
          {
            "caption": "Transfer priority by climate",
            "columns": [
              "{bull}{stag}",
              "{lion}",
              "{bear}{peacock}"
            ],
            "rows": [
              [
                "Player Presidency's Army to a Crown Presidency's Army.",
                "Army of Presidency with fewest ships to Army of Presidency with most ships.",
                "Army where a player is Commander to an Army where the Crown is Commander."
              ]
            ]
          }
        ]
      },
      {
        "title": "Assign Officers",
        "subtitle": "If the Crown is Military Affairs",
        "text": "The Crown will assign player officers first and then Crown officers, one at a time and independently of each other, according to the following priority (starting at the top for each assignment and breaking ties by applying each step that can be applied to reduce the candidates to a single one). If a tie remains after applying each step in the list, break the tie with the black arrow, then the white arrow.\n\nAfter all Officers-in-Training have been assigned, the Crown will assign Commanders. If there is more than one eligible officer to become a Commander, Crown will choose their own officer.",
        "favors": [
          {
            "text": "Assign 1 officer to a Presidency of your choice.",
            "cost": "-1"
          }
        ],
        "tables": [
          {
            "caption": "Officer assignment priority by climate",
            "columns": [
              "{bull}{stag}{lion}",
              "{bear}{peacock}"
            ],
            "rows": [
              [
                "1. A Crown Presidency, then\n2. The Presidency with the most ships, then\n3. A Presidency where Crown is Governor, then\n4. A Presidency that creates a new Crown majority of pieces, then\n5. A Presidency that creates a Crown equality with a player holding a majority of pieces, then\n6. A Presidency where Crown has a majority of pieces and does not lose a Crown majority, then\n7. A Presidency where the Crown is Commander.",
                "1. A Presidency that creates a new Crown majority, then\n2. A Presidency that creates a Crown equality with a player holding a majority of pieces, then\n3. A Presidency where Crown has a majority of pieces and does not lose a Crown majority, then\n4. A Presidency where Crown is Governor, then\n5. A Presidency where Crown is Commander, then\n6. A Crown Presidency, then\n7. The Presidency with the most ships."
              ]
            ]
          }
        ]
      }
    ]
  },
  {
    "page": 10,
    "sections": [
      {
        "title": "If the Crown is President",
        "subtitle": "Presidency Operations",
        "text": "Crown Presidents make Governors act first in order of formation, then Commander, then attempt Trade.",
        "favors": [
          {
            "text": "Make a single change in the order of Presidency operations.",
            "cost": "-1"
          }
        ],
        "notes": [
          "Page heading 'Presidency Operations' has a small crown icon at left; second heading 'Governors' follows the first favor."
        ]
      },
      {
        "title": "If you are Governor",
        "subtitle": "Governors",
        "favors": [
          {
            "text": "Add money from a Tax Administer action to a Crown Presidency. This can only be taken once per turn per Presidency.",
            "cost": "+1"
          },
          {
            "text": "Move a Company ship into the sea zone associated with a Crown Presidency.",
            "cost": "+1"
          },
          {
            "text": "Commission Regiment into an Army associated with a Crown Presidency. This can only be taken once per turn per Presidency.",
            "cost": "+1"
          }
        ]
      },
      {
        "title": "Administer",
        "subtitle": "Governors / If the Crown is Governor",
        "text": "Crown will repeat the Administer action as many times as possible, decreasing the dice pool after each roll, as long as they can roll at least the required number of dice given by this table:\n\nIf the Administer action is successful the Crown will:",
        "favors": [
          {
            "text": "Increase or decrease the required number of die by 1 {die}.",
            "cost": "-1"
          },
          {
            "text": "Take no Administer actions.",
            "cost": "-3"
          },
          {
            "text": "Choose a different result for a successful Administer action.",
            "cost": "-2"
          }
        ],
        "tables": [
          {
            "caption": "Required dice",
            "columns": [
              "{bull}",
              "{stag}{lion}{bear}",
              "{peacock}"
            ],
            "rows": [
              [
                "3 {die}",
                "2 {die}",
                "1 {die}"
              ]
            ]
          },
          {
            "caption": "If the Administer action is successful the Crown will:",
            "columns": [
              "{bull}{stag}",
              "{lion}",
              "{bear}{peacock}"
            ],
            "rows": [
              [
                "Tax (adding funds to Crown Presidency first, then remainder to Company Balance).",
                "Build Company Ship.",
                "Commission Regiment."
              ]
            ]
          }
        ]
      }
    ]
  },
  {
    "page": 11,
    "sections": [
      {
        "title": "Local Alliances",
        "subtitle": "Commanders / If you are the Commander",
        "favors": [
          {
            "text": "Consent to purchase a Local Alliance from a Crown President.",
            "cost": {
              "bull": "-2",
              "stag": "-2",
              "lion": "-1",
              "bear": "0",
              "peacock": "0"
            }
          }
        ],
        "notes": [
          "Heading 'Commanders' has a small tricorne-hat icon at left."
        ]
      },
      {
        "title": "Deploy",
        "subtitle": "Commanders / If you are the Commander",
        "favors": [
          {
            "text": "Successfully complete a Deploy action in a non-Company region using one or more Crown officers.",
            "cost": {
              "bull": "—",
              "stag": "—",
              "lion": "+1",
              "bear": "+1",
              "peacock": "+1"
            }
          },
          {
            "text": "Successfully complete a Deploy action in a Company-controlled region associated with a Crown Presidency that has at least one Crown writer.",
            "cost": {
              "bull": "+1",
              "stag": "+1",
              "lion": "+1",
              "bear": "—",
              "peacock": "—"
            }
          }
        ]
      },
      {
        "title": "Local Alliances",
        "subtitle": "Commanders / If the Crown is Commander",
        "text": "Crown Presidents will always give consent to purchasing Local Alliances to Crown Commanders.",
        "favors": [
          {
            "text": "Will purchase an additional Local Alliance of your choice, and you must give consent to the Crown if they purchase Local Alliances in your Presidency.",
            "cost": {
              "bull": "-2",
              "stag": "-2",
              "lion": "-2",
              "bear": "-1",
              "peacock": "-1"
            }
          },
          {
            "text": "The Crown must purchase a more expensive Local Alliance.",
            "cost": {
              "bull": "—",
              "stag": "—",
              "lion": "-1",
              "bear": "—",
              "peacock": "—"
            }
          },
          {
            "text": "The Crown must purchase a less expensive Local Alliance.",
            "cost": {
              "bull": "—",
              "stag": "—",
              "lion": "—",
              "bear": "-1",
              "peacock": "-1"
            }
          },
          {
            "text": "If the Crown has the Presidency, the Crown will not purchase a Local Alliance.",
            "cost": {
              "bull": "—",
              "stag": "—",
              "lion": "-1",
              "bear": "-2",
              "peacock": "-2"
            }
          },
          {
            "text": "Give consent to the Crown purchasing Local Alliances in your Presidency if you did not pay promises to make them purchase Local Alliances.",
            "cost": "+1"
          }
        ],
        "tables": [
          {
            "caption": "Crown Commander local alliance behaviour",
            "columns": [
              "{bull}{stag}",
              "{lion}",
              "{bear}{peacock}"
            ],
            "rows": [
              [
                "Will not purchase a Local Alliance.",
                "If the Crown's Army strength is 3+ they will attempt to purchase the cheapest affordable Local Alliance (requires presidential consent).",
                "If the Crown's Army strength is 2+ they will attempt to purchase the most expensive affordable Local Alliance (requires presidential consent)."
              ]
            ]
          }
        ]
      }
    ]
  },
  {
    "page": 12,
    "sections": [
      {
        "title": "Deploy Target Regions",
        "subtitle": "Commanders / If the Crown is Commander",
        "text": "The Crown will attempt to take the Deploy action in a…",
        "favors": [
          {
            "text": "Choose a valid region in which the Crown will attempt to Deploy.",
            "cost": "-2"
          }
        ],
        "tables": [
          {
            "caption": "Deploy target regions by climate",
            "columns": [
              "{bull}{stag}",
              "{lion}{bear}{peacock}"
            ],
            "rows": [
              [
                "…Presidency's home region with closed orders, then Company-controlled regions associated with this Presidency with closed orders, then Presidency's home region if not Company-controlled, then any non-Company-controlled regions adjacent to Company-controlled Regions.",
                "…Presidency's home region if not Company-controlled, then any regions not Company-controlled and adjacent to Company-controlled Regions associated with this Presidency, then Company-controlled regions associated with this Presidency with closed orders."
              ]
            ]
          }
        ]
      },
      {
        "title": "Deploy",
        "subtitle": "Commanders / If the Crown is Commander",
        "text": "A Crown Commander will exhaust all available Local Alliances first, then Crown officers, then player officers, and then regiments, in order to match the exact number of dice listed below. They will only Deploy if they can roll the required number of dice given by this table:",
        "favors": [
          {
            "text": "Increase or decrease the required number of dice by 1 {die}.",
            "cost": "-1"
          },
          {
            "text": "Once pieces have been exhausted and before rolling dice, exchange X value pieces that were exhausted for pieces that were not. Note: Local Alliance of strength X counts as X pieces.",
            "cost": "-X"
          }
        ],
        "tables": [
          {
            "caption": "Required dice",
            "columns": [
              "Region",
              "{bull}",
              "{stag}",
              "{lion}",
              "{bear}",
              "{peacock}"
            ],
            "rows": [
              [
                "Non-Company Controlled Region",
                "6 {die}",
                "5 {die}",
                "4 {die}",
                "3 {die}",
                "2 {die}"
              ],
              [
                "Company Controlled Region",
                "2 {die}",
                "3 {die}",
                "4 {die}",
                "5 {die}",
                "6 {die}"
              ]
            ]
          }
        ]
      },
      {
        "title": "Deploy Again?",
        "subtitle": "Commanders / If the Crown is Commander",
        "favors": [
          {
            "text": "The Crown takes the Deploy action again.",
            "cost": {
              "bull": "-2",
              "stag": "-2",
              "lion": "-1",
              "bear": "—",
              "peacock": "—"
            }
          },
          {
            "text": "The Crown will not take the Deploy action again.",
            "cost": {
              "bull": "—",
              "stag": "—",
              "lion": "—",
              "bear": "-1",
              "peacock": "-1"
            }
          }
        ],
        "tables": [
          {
            "caption": "Deploy again by climate",
            "columns": [
              "{bull}{stag}{lion}",
              "{bear}{peacock}"
            ],
            "rows": [
              [
                "The Crown will not attempt to take the Deploy action again.",
                "The Crown will attempt to take the Deploy action again."
              ]
            ]
          }
        ]
      }
    ]
  },
  {
    "page": 13,
    "sections": [
      {
        "title": "If you are President",
        "subtitle": "Presidents",
        "favors": [
          {
            "text": "Place X Crown writers when filling orders. This always applies, even if you have no choice but to place Crown writers.",
            "cost": "+X",
            "mandatory": true
          }
        ]
      },
      {
        "title": "Trade",
        "subtitle": "Presidents / If the Crown is President",
        "text": "The Crown will spend the necessary funds to roll the required number of dice to trade given by this table:\n\nThe Crown first attempts to trade for the highest value trade route, but will trade in fewer regions if that is the only way to reach the required minimum number of dice to still trade.",
        "favors": [
          {
            "text": "Increase or decrease the required number of dice by 1 {die}.",
            "cost": "-1"
          }
        ],
        "tables": [
          {
            "caption": "Required dice",
            "columns": [
              "{bull}",
              "{stag}",
              "{lion}",
              "{bear}",
              "{peacock}"
            ],
            "rows": [
              [
                "2 {die}",
                "3 {die}",
                "4 {die}",
                "5 {die}",
                "6 {die}"
              ]
            ]
          }
        ]
      },
      {
        "title": "Additional Funds",
        "subtitle": "Presidents / If the Crown is President",
        "text": "If there are funds remaining in the treasury, the Crown will also spend up to an additional £3 on the Trade action."
      },
      {
        "title": "Filling Orders",
        "subtitle": "Presidents / If the Crown is President",
        "text": "When determining which Orders to fill, the Crown will first try to trade for the highest value trade route; if multiple orders/routes have the same value, the Crown will prefer orders in the home region first, then orders closest to home region, and then most southerly equidistant orders.\n\nThe Crown will always place their own writers first, and then start placing player writers.\n\n[2P ONLY] Player priority for each writer placed is determined according to the Player Button.",
        "favors": [
          {
            "text": "The Crown places your writer instead of another.",
            "cost": "-1"
          }
        ]
      },
      {
        "title": "If you are Superintendent",
        "subtitle": "Superintendent of Trade in China",
        "text": "Perform office actions as usual."
      },
      {
        "title": "Trade in China",
        "subtitle": "Superintendent of Trade in China / If the Crown is Superintendent",
        "text": "The Crown will roll as many dice as possible to take a valid Trade in China action, so long as they can roll the required number of dice given by this table:",
        "favors": [
          {
            "text": "Increase or decrease the required number of dice by 1 {die}.",
            "cost": "-1"
          }
        ],
        "tables": [
          {
            "caption": "Required dice",
            "columns": [
              "{bull}",
              "{stag}{lion}",
              "{bear}{peacock}"
            ],
            "rows": [
              [
                "1 {die}",
                "2 {die}",
                "3 {die}"
              ]
            ]
          }
        ]
      }
    ]
  },
  {
    "page": 14,
    "sections": [
      {
        "title": "If the Crown is Chairman",
        "subtitle": "Revenue",
        "text": "The Crown will try to pay 1 dividend minimum, then more if able to leave £X in Company Balance as indicated:",
        "favors": [
          {
            "text": "The Crown pays out 1 less dividend.",
            "cost": {
              "bull": "-2",
              "stag": "-2",
              "lion": "-1",
              "bear": "-1",
              "peacock": "-1"
            }
          },
          {
            "text": "The Crown pays out 1 more dividend.",
            "cost": {
              "bull": "-1",
              "stag": "-1",
              "lion": "-2",
              "bear": "-2",
              "peacock": "-2"
            }
          }
        ],
        "tables": [
          {
            "caption": "Company Balance to leave",
            "columns": [
              "{bull}",
              "{stag}",
              "{lion}",
              "{bear}",
              "{peacock}"
            ],
            "rows": [
              [
                "£0",
                "£2",
                "£4",
                "£6",
                "£8"
              ]
            ]
          }
        ]
      },
      {
        "title": "Royal Protection",
        "subtitle": "Revenue",
        "text": "If there are emergency loans, the Crown always will discard Royal Protection if available."
      },
      {
        "title": "Emergency Investments",
        "subtitle": "Revenue / Firm Expenses and Dividends",
        "text": "During the Revenue phase, if a firm is seeking emergency investment, the Crown will not invest.",
        "favors": [
          {
            "text": "The Crown invests in your firm with Company shares (unless they are weak), and then workshops, regardless of majority of Company shares. Note: players cannot use this bribe if doing so results in the Crown having more firm shares than manager.",
            "cost": "-4"
          }
        ]
      },
      {
        "title": "Firm Dividends",
        "subtitle": "Revenue / Firm Expenses and Dividends",
        "favors": [
          {
            "text": "If you pay the Crown firm share dividends equal to or more than any (all) other player(s) in the firm (i.e. do not include cash paid for the firm manager dividend). X = the number of Crown firm shares (max 3).",
            "cost": "+X"
          }
        ]
      },
      {
        "title": "Events in India",
        "text": "If the Crown is a Commander and must defend a Crisis, you choose which pieces will be exhausted to meet the Crisis. [2P ONLY] The player holding the Player Button chooses."
      },
      {
        "title": "Parliament Meets",
        "text": "The Crown will always vote first. The Crown will vote for or against according to the Crown's Voting Plan (detailed on the last page). The Crown will use all available votes from their Enterprises to influence their vote. Unlike players, the Crown will receive additional votes according to the size of their treasury based on this chart:",
        "tables": [
          {
            "caption": "",
            "columns": [
              "£0 - £3",
              "£4 - £6",
              "£7 - £10",
              "£11 - £14",
              "£15+"
            ],
            "rows": [
              [
                "+0 votes",
                "+1 votes",
                "+2 votes",
                "+3 votes",
                "+4 votes"
              ]
            ]
          }
        ]
      }
    ]
  },
  {
    "page": 15,
    "sections": [
      {
        "title": "Climate Shift",
        "subtitle": "If a you are Prime Minister",
        "text": "After the law is chosen, and before voting begins, roll 6 {die}. If the number of successes is greater or equal to Company Standing (which runs from 0-7 where Company Failure = 0), shift the Crown Climate one position to the right, if able.\n\nThen, if the number of successes is greater than Company Standing, shift it once more to the right, if able.\n\nThen, if number of failures + catastrophic failures is less or equal to Company Standing, shift Crown Climate to the left, if able.\n\nFinally, if the number of failures + catastrophic failures is less than Company Standing, shift it once more to the left, if able."
      },
      {
        "title": "Climate Shift",
        "subtitle": "If the Crown is Prime Minister",
        "text": "First, perform Climate Shift as described above.\n\nThe Crown will draw cards from the Law deck according to the position of the shaded card at the top of the AI card. If a Dilemma is drawn, the Crown must stop drawing and vote on the Dilemma.\n\nUnlike players, the Crown may vote against the current law even if they are the Prime Minister. The Crown can hold both the Prime Minister dial and be Opposition Leader.",
        "favors": [
          {
            "text": "The Crown stops drawing and selects the law just drawn.",
            "cost": "-2"
          },
          {
            "text": "The Crown skips the law drawn and draws again (must select 3rd law drawn).",
            "cost": "-2"
          }
        ]
      },
      {
        "title": "Policy Marker Movement Priority",
        "subtitle": "If the Crown is Prime Minister",
        "text": "Compare the two policy space choices and their net effects.\n\nFor each choice, determine their effect by counting the number of affected Player entities (i.e. workshops, shipyards, shares, luxuries, windows) and compare the total against the number of Crown entities to get the Crown total. Multiply this total by -1 if the choice is tax.\n\nThe Crown will choose the option where the Crown total is highest (e.g. -1 is preferable to -2). Break ties using the AI card clockwise/counterclockwise arrows. If the Crown chooses a Power policy in which the Power marker is already in the highest position, swap the position of the two bottom Power markers.",
        "favors": [
          {
            "text": "The Crown moves the policy marker to the alternative policy.",
            "cost": "-4"
          }
        ]
      },
      {
        "title": "Royal Privilege",
        "subtitle": "If the Crown is Prime Minister",
        "text": "If the Crown cannot afford a tax (or family expenses), the Crown will use additional funds from the Company treasury as needed to pay for the cost. The Crown will take emergency loans if necessary to create the necessary cash. This may cause Company failure. If the Crown is Chairman, Royal Protection will always be discarded if it is available."
      },
      {
        "title": "Upkeep and Refresh",
        "text": "The Crown will pay family expenses. If the Crown cannot afford expenses, they will use Royal Privilege.",
        "favors": [
          {
            "text": "[SOLO] You have one or more writers in a Crown Presidency, but you do not have at least one writer return from filling an order in that Presidency.",
            "cost": "+1",
            "mode": "solo"
          }
        ]
      },
      {
        "title": "Game End",
        "text": "[SOLO ONLY] Only award victory points for first place for the Power Award. If the Company failed, the soloist should adjust their own victory points [only] according to this table.",
        "tables": [
          {
            "caption": "",
            "columns": [
              "Game Turn",
              "1",
              "2",
              "3",
              "4",
              "5",
              "6",
              "7",
              "8"
            ],
            "rows": [
              [
                "1710",
                "-5",
                "-4",
                "-3",
                "-2",
                "-1",
                "0",
                "0",
                "0"
              ],
              [
                "1758",
                "",
                "",
                "-5",
                "-4",
                "-3",
                "-2",
                "-1",
                ""
              ],
              [
                "1813",
                "",
                "",
                "",
                "",
                "-4",
                "-3",
                "-2",
                "-1"
              ]
            ]
          }
        ]
      }
    ]
  },
  {
    "page": 16,
    "sections": [
      {
        "title": "The Crown's Voting Plan",
        "tables": [
          {
            "caption": "The Crown's Voting Plan",
            "columns": [
              "LAW NAME",
              "FOR",
              "AGAINST"
            ],
            "rows": [
              [
                "Army Spending",
                "{bear}{peacock}",
                "{bull}{stag}{lion}"
              ],
              [
                "Board of Control",
                "If the Crown is PM. They will remove a player from office at first opportunity.",
                "Otherwise."
              ],
              [
                "Calico Acts",
                "If the Crown has most workshops.",
                "Otherwise."
              ],
              [
                "Company Aids Government",
                "{bear}{peacock}",
                "{bull}{stag}{lion}"
              ],
              [
                "Debt Restructure",
                "{bull}{stag}",
                "{lion}{bear}{peacock}"
              ],
              [
                "Envoy to China",
                "{lion}{bear}{peacock}",
                "{bull}{stag}"
              ],
              [
                "Governor General",
                "If the Crown is Director of Trade.",
                "Otherwise."
              ],
              [
                "Inclosure Acts",
                "If the Crown has most prizes.",
                "Otherwise."
              ],
              [
                "Industry Subsidy",
                "{lion}{bear}{peacock}",
                "{bull}{stag}"
              ],
              [
                "Masses Demand Franchise!",
                "Otherwise.",
                "If the Crown has most Rotten Boroughs."
              ],
              [
                "Military Oversight",
                "If the Crown is Prime Minister. A Crown MA will always demote a non-Crown Commander if a Crown Officer is available in that Army.",
                "Otherwise."
              ],
              [
                "Old Ideas Made New!",
                "If the Crown is Prime Minister, choose the Law randomly.",
                ""
              ],
              [
                "Public Demands Impeachment!",
                "If the Crown is Prime Minister, they will select first player office from left to right on ribbon. If all Crown offices, then randomly.",
                "Otherwise."
              ],
              [
                "Relief Demanded for Indian Famine!",
                "Otherwise.",
                "The Crown has most of given policy."
              ],
              [
                "Royal Protection",
                "If the Crown has most luxuries.",
                "Otherwise."
              ],
              [
                "Sepoy Recruitment",
                "{lion}{bear}{peacock}",
                "{bull}{stag}"
              ],
              [
                "Ship Subsidy",
                "{bull}{stag}{lion}",
                "{bear}{peacock}"
              ],
              [
                "Tenure Limits",
                "Otherwise.",
                "If the Crown is Chairman."
              ],
              [
                "Trade Regulations",
                "{bear}{peacock}",
                "{bull}{stag}{lion}"
              ],
              [
                "Treasure Reform",
                "{bull}{stag}",
                "{lion}{bear}{peacock}"
              ],
              [
                "War Against France!",
                "If the Crown is Prime Minister. They will select player ships/officers, then Company ships, then Crown ships/officers.",
                "Otherwise."
              ],
              [
                "Window Tax Repeal",
                "{peacock}",
                "{bull}{stag}{lion}{bear}"
              ],
              [
                "Writer Graft Reform",
                "{bull}",
                "{stag}{lion}{bear}{peacock}"
              ],
              [
                "Writer Privileges",
                "If the Crown has most writers currently on Orders.",
                "Otherwise."
              ],
              [
                "Zamindar Taxes",
                "If the Crown has most Governors.",
                "Otherwise."
              ]
            ]
          }
        ],
        "notes": [
          "Reminder: for the Crown, the word most includes ties so long as the Crown has at least one.",
          "Rows whose names are printed in small caps/bold (those ending in '!') are event/crisis-style laws. 'Old Ideas Made New!' has a single cell spanning both FOR and AGAINST columns (transcribed under FOR; AGAINST left blank). 'most' is italic in the print."
        ]
      }
    ]
  }
];

/** Rulebook pp.43-46, "Playing with One or Two" (verbatim). */
export const crownRulebookPages: Array<{ page: number; sections: Array<{ title: string; text?: string }> }> = [
  {
    "page": 43,
    "sections": [
      {
        "title": "Playing with One or Two",
        "text": "In the solo and two player game, you will be playing against the Crown. The Crown is sometimes keen to see the Company succeed, with them becoming the dominant power within the Company. At other times, the Crown seeks for the Company to fail. You must negotiate with the Crown and influence their decision-making to seize victory for yourself. Sometimes the Crown will make bad decisions for the Company and paying for costly favors may be the only way to keep those decisions in check. You do so via a set of 12 Crown promise cubes. There is a limited number of promise cubes, so you must do favors for the Crown in return to get promise cubes back.\n\nThe game follows all of the standard multiplayer rules, with the following adjustments:"
      },
      {
        "title": "Setup",
        "text": "Set up a game in any scenario. It is recommended to set up the 1710 scenario for your first game with the Crown. Before dealing setup cards, follow these steps:\n\n1. The Crown uses the family board titled \"The Crown.\"\n\n2. Give the Crown the family members of two players, so they have 36 pieces instead of 18. They will first use all of one color when placing family members.\n\n3. Divide the 12 Crown promise cubes equally between the Crown and the human players (i.e. 6 each in a solo game, 4 each in a 2-player game).\n\n4. The Crown sits last in order in respect to whoever was Chairman during setup, or before whichever player is next in the order of offices if the Crown is themselves the Chairman."
      },
      {
        "title": "Finishing Setup as a Solo Player",
        "text": "The Crown acts like two players for solo setup. Shuffle the 12 setup cards, draw 3 cards, select 1 to keep, and give 2 to the Crown. Repeat this 3 more times, so that you finish with 4 setup cards and the Crown finishes with 8.\n\nAs a variant, players can deal the setup cards randomly. Deal 4 to the soloist and 8 to the Crown."
      }
    ]
  },
  {
    "page": 44,
    "sections": [
      {
        "title": "Finishing Setup with Two Players",
        "text": "Set up as a 3-player game with the Crown set up as one family. Shuffle the 12 setup cards, each player draws 3 cards, selects 2 to keep, and gives the remaining card to the Crown. Repeat this 2 times. Each player and the Crown will have 4 setup cards."
      },
      {
        "title": "The Player Button",
        "text": "Designate one component or object as the Player Button (this could be an unused Crown firm cube or any unused game component). Give the Player Button to the player sitting to the right (counter-clockwise) or left (clockwise) of the Crown, according to the direction pointed at by the finger on the current AI card.\n\nEach time the Crown must decide between the two players, they will select the player holding the Player Button. Likewise, if there is disagreement over which of the two players gets to act in a certain situation (e.g. if both wish to perform the same favor with the Crown at the same time), the decision goes to the player holding the Player Button. In both cases, that player must then immediately pass the Player Button to the other player.\n\nA player holding the Player Button may transfer it to the other player as part of a negotiation."
      },
      {
        "title": "Difficulty",
        "text": "You can adjust the difficulty of the Crown as follows:\n\n{pointing-hand} Easy. 5 promise cards are available to each player, which can be traded for promise cubes (see Crown family board).\n\n{pointing-hand} Normal. Promise cards are not available for trading for promise cubes.\n\n{pointing-hand} Hard. As Normal, but also give 4 more promise cubes to the Crown (2 from each player in 2P).\n\n{pointing-hand} Expert. As Hard, but also give the Crown 3 extra setup cards."
      },
      {
        "title": "Before you Begin Play",
        "text": "Shuffle the AI cards and place the deck facedown; draw and reveal the topmost card, placing it faceup to the right of the facedown deck. Set the climate marker (use an unused opportunity marker) on the Crown family board, according to the icon on the revealed AI card."
      },
      {
        "title": "Gameplay",
        "text": "The Crown Handbook will be used to determine the behavior and interactions of the Crown during each game. The Crown's behavior for any current phase is dictated by the Crown Handbook and often affected by the current climate. However, players are encouraged to not look beyond the phase they are currently in within the Handbook. The Crown's climate is determined by the current AI card and tie breaks are often determined by using the current AI card and AI card deck.\n\nThroughout the game, players can modify the actions of the Crown by spending promise cubes. Players can gain promise cubes by acting in ways that are beneficial to the Crown. When playing with two players, promise cubes may be used in negotiations and traded between players at anytime."
      }
    ]
  },
  {
    "page": 45,
    "sections": [
      {
        "title": "(annotated AI card diagram)",
        "text": "Diagram at top of page: back of an AI card (BENGAL, clockwise black arrow, BOMBAY, red counterclockwise arrow, MADRAS) beside front of AI card 1 (Company Expectations: £4 peacock, £6 lion, £8+ bull; region strip Madras, Mysore, Bombay, Punjab, Delhi, Maratha, Hyderabad, Bengal) with blue numbered callouts: 1 = black '1st' arrow next to the back's top region (BENGAL); 2 = pointing hand next to the black clockwise arrow; 3 = first (left) shaded splay slot; 4 = the climate table; 5 = the region strip; 6 = white '2nd' arrow next to the back's bottom region (MADRAS)."
      },
      {
        "title": "AI Deck",
        "text": "You will often need to refer to the current faceup AI card and the AI deck when breaking ties.\n\nWhen the Crown must choose between the Presidencies, select the Presidency indicated on the back of the topmost card of the facedown AI deck pointed to by the black arrow (1). If this Presidency is not suitable, or the Crown must select a second Presidency, select the one indicated by the white arrow (6). If the second Presidency is not suitable, then the Crown will select the remaining third Presidency. For example, first select the Bengal Presidency, then Madras, then Bombay.\n\nWhen the Crown must select a direction, use the direction pointed at by the finger (2). For example, the selected direction is clockwise.\n\nWhen the Crown must select one of three cards in a splay, select the card in the position of the shaded card at the top of the AI card (3). If that card is not available, select the next card to the right, wrapping around to the left if needed. For example, the Crown would choose the leftmost card in the London Season Display.\n\nWhen the Crown changes climate during the Chairman's actions, use the chart to determine their new climate (4). For example, if Company Standing is in the first or second place, the Crown's climate will change to the peacock. A player cannot affect the game state in any way prior to determining the Crown's new climate after a new AI card is flipped.\n\nWhen the Crown must decide between regions, use the region priority given at the bottom of the AI card (5). The Crown selects the leftmost region in the list and proceeds to the right. For example, the Crown would first choose Madras, then Mysore, then Bombay, then Punjab, then Delhi, then Maratha, then Hyderabad, and lastly Bengal."
      }
    ]
  },
  {
    "page": 46,
    "sections": [
      {
        "title": "Favors and Promise Cubes",
        "text": "In most phases, promise cubes can be exchanged to/from the Crown in a closed economy via a favor. There are two kinds of favors: favors that require you to pay promise cubes to the Crown (indicated with a red box) and favors that force the Crown to give you promise cubes (indicated with a blue box). Most favors are listed in the Crown Handbook. Favors have two critical restrictions:\n\n{pointing-hand} Favors are only available during the resolution of the indicated phase or step.\n\n{pointing-hand} You may perform favors as many times as you wish, but you may never perform a favor you cannot fully pay, though you can perform a favor that will gain you less promise cubes than are available from the Crown.\n\nSome additional favors are listed on the Crown's family board. Unlike favors in the Crown Handbook, these favors can be taken at any time during the timing window described on the Crown's family board.\n\nHere are some examples of favors:"
      },
      {
        "title": "Clarifications for the Crown",
        "text": "The word \"most\" refers to having comparatively more or equal of something, with a minimum of 1. The word \"fewest\" refers to having comparatively less or equal of something, and includes zero.\n\nIf the Crown faces more than one option, the soloist (or the player holding the Button) may make a free choice between them when the rules do not otherwise make a distinction.\n\nThe \"longest\" and \"shortest\" trade route refers to the maximum number of orders a President could fill in one go, irrespective of number of ships."
      }
    ]
  }
];
