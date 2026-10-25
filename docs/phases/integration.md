# Integration notes

How the phases fit together after the parallel build, and the decisions made while joining them.
Each phase's own rules and assumptions are in the other files in this folder.

## Commands and decisions

- **Only offered options are accepted.** The dispatcher (`src/engine/commands.ts`) rejects a
  pending-decision command unless its payload deep-equals one of the offered options. An empty
  payload picks the option when exactly one of that type is offered.
- **Nothing goes negative.** After every command the dispatcher rejects any state where a player's
  cash, a piece count, the Company Balance, an office treasury, or Debt is out of bounds, or a
  family's pieces do not total 18 (36 for the Crown). Stale or buggy options are refused rather than
  corrupting the save.
- **Anytime commands rebuild the pending decision.** After a transfer, promise call or blackmail
  play, Negotiation runs the step's registered refresher (Family actions, Parliament votes and tax
  surrenders, retirement prizes), then tries every remaining option and drops the ones that would now
  be rejected. Steps without a refresher still lose stale options; they just cannot gain new ones.
- **Decision:** a voter who gives away everything they could vote with is moved past by Parliament's
  own logic, the same as a voter who had nothing to begin with.

## Shared helpers

- `src/engine/offices.ts`: vacating an office (to supply or the Pensioners box), creating one,
  returning one to the box, and installing the Governor General. Every phase uses these.
- **One former Chairman.** `company.chairmanMarker` / `chairmanTitleHolder()` is the only record;
  London Season's separate copy is gone.
- **Immediate hires** (China from the Special Envoy or the Envoy to China law) use Hiring's
  `beginImmediateHire`, with per-player Nepotism. Company Operation keeps the hiring decision while a
  hire is in progress; Parliament pauses its resolution queue and resumes when the hire is done.
- **Law effects in India.** Relief Demanded for Indian Famine! and War Against France! run through
  `startNestedIndiaResolution` (Events in India), so attacks on the Company use the real defence flow.
  The phase switches to Events in India while a Commander decides, then returns to Parliament.

## Blackmail

Every blackmail card is played through Negotiation's `startBlackmailPlay`, so Man on the Inside can
cancel it. Cards played inside another phase register a no-effect handler (`registerInFlowBlackmail`)
and apply their effect in a resume when the play resolves: Company Fraud, Letters of Introduction,
Hiring Preference, Mercantile and Diplomatic Connection. Scandal and Envoy to the Mughals have one
handler each that both the anytime panel and the in-phase offers use.

## Promise cards

- **Take my officeholder's bonus:** Company Operation records each paid bonus; a bonus is claimable
  once recorded. A Governor's bonuses are voided on catastrophic failure.
- **Vote with my enterprises:** once called in during Parliament, the guarantor's enterprises appear
  among the holder's vote cards for that Parliament. Decision: it may be called in at any point in
  Parliament, not only before the first vote.
- **My consent for nepotism:** counts as that guarantor's consent in Hiring.
- **Take my card from the London Season Display:** the holder makes the guarantor's pick and keeps the card.
- Lady Newcome removes her family's enterprise-vote promise when taken.

## Golden rule (p.8)

- A card rotated to vote is marked activated; it cannot vote again that Parliament after changing hands.
- Lady Newcome: enterprises her family transferred away cannot vote that turn. Transfers record the giver.
- Bonuses and dividends pay out in a single step, so a transfer cannot happen mid-payout.

## Refresh and state

- Local alliances bought this turn count at their printed strength when defending against attacks on
  the Company (p.21), and are exhausted at Refresh.
- **No divider state.** Presidency dividers are a physical aid: each writer on an order already records
  its Presidency, so Refresh returns writers correctly without them.
- **Region Loss** returns the eliminated Governor's card to the unused stack, not Vacant Offices
  (rulebook p.29, step 3). Catastrophic failure sends the office to Vacant Offices (p.17).
- **`player.windows`** is a convenience counter of enterprise window icons. Rules (tie-breaks, window
  tax) count icons from holdings with `playerWindowIcons`.
- A prestige enterprise returned for unpaid tax goes to the London Season discards.
- Stock Broker permission stays Family's own yes/no decision rather than Negotiation's consent queue.
