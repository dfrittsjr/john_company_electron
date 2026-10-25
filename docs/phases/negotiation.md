# Negotiation (NG)

Rulebook p.8 (Negotiation, Promise Cards), p.12 (blackmail), p.13 (out of family pieces), and the
promise-card backs in `src/data/cards.ts`.

## Files

- `src/engine/phases/negotiation.state.ts`: state (promise cards, grants, officeholder bonuses,
  golden-rule records, interrupt stack).
- `src/engine/phases/negotiation.ts`: transfers, deals, consent requests, promise cards, decision
  refreshers, interrupts.
- `src/engine/phases/negotiation-blackmail.ts`: blackmail play framework and the anytime blackmail cards.
- `src/ui/NegotiationPanel.tsx`: the Deals & Cards panel and its "I am X: reveal" step.

## Commands

Anytime (any player, any time before Final Scoring; spread into `phases/anytime.ts`):

| Command | Payload |
|---|---|
| `negotiation.give` | `{ to, items: TransferItem[] }`: one-sided, binding at once |
| `negotiation.proposeTrade` | `{ to, give: TransferItem[], receive: TransferItem[] }`: waits for `to` to consent |
| `negotiation.callInPromises` | `{ calls: [{ promiseId, option }] }`: several calls at once allowed |
| `negotiation.playBlackmail` | `{ cardInstanceId, params }` |

`TransferItem`: `cash`, `enterprise`, `prestige` (transferable prestige enterprises only), `blackmail`
(face-down only), `share` (Court share; `fromPrizeId` when the receiver has no supply), `promise`.
Anything else is rejected with the p.8 reason (`NON_TRANSFERABLE`).

Responses (pending-decision commands): `negotiation.respondToConsent`, `negotiation.fulfilPromise`,
`negotiation.finishPromises`, `negotiation.respondToBlackmail`.

The UI and harness get concrete options from `promiseCallOptions(state, player)` and
`blackmailPlayChoices(state, player)`.

## API for other areas

All exported from `src/engine` unless noted.

- **Consent:** `registerConsentResolver(kind, (state, request, accepted) => state)` once at module
  load, then `requestConsent(state, { kind, requestedBy, from, prompt, context, resumeDecision? })`.
  Players are asked one at a time; the first refusal ends it. When the resolver runs, the interrupted
  decision (or `resumeDecision`) is already restored; set a new pending decision there if your flow
  moves on.
- **Decision refreshers:** `registerDecisionRefresher(step, state => decision)`. Negotiation calls it
  after every transfer or call-in so a decision never offers something the actor can no longer afford.
  Negotiation registers `family.chooseAction` itself for now.
- **Blackmail:** `registerBlackmailHandler(effectHandlerId, { anytimeUnavailableReason, options, resolve })`
  for your cards. For a card offered inside your own flow (after a Trade check, when taken from the
  display, ...), call `startBlackmailPlay(state, { playerId, cardInstanceId, params, resumeKey, timestamp })`
  and `registerBlackmailResume(resumeKey, (state, play, "resolved" | "canceled") => state)`. Man on the
  Inside reactions are handled for you.
- **Golden rule (p.8):** `markActivated(state, assetIds)`, `isActivatedThisPhase(state, assetId)`,
  `wasTransferredThisTurn(state, assetId)`.
- **Promise hooks:** `recordOfficeholderBonus`, `voidOfficeholderBonuses`, `nepotismConsentGuarantors`,
  `enterpriseVoteGuarantors`, `prestigePickTakenBy`, `usePromiseGrant`, `removePromiseFromGame`.
- **Offices:** `vacateOfficeWithoutRetirement(state, officeId)` (Scandal cards).
- **Power markers:** `powerMarkerPositions` / `withPowerMarkerPositions` in `selectors.ts`.

## TODOs for other areas

- **CO:** call `recordOfficeholderBonus` for every officeholder bonus (not loot shares), and
  `voidOfficeholderBonuses` when a Governor is removed by catastrophic failure. Make sure
  `actedThisTurn` is set once an office has acted. Mercantile Connection and Diplomatic Connection
  (after Trade/Deploy checks) need `startBlackmailPlay` hooks and handlers. Consult
  `isActivatedThisPhase` if a payout could repeat after a transfer.
- **FH:** treat `nepotismConsentGuarantors(state, hirer)` as consent in the nepotism check, then
  `usePromiseGrant`. Hiring Preference needs a handler and hook. Consider moving the
  `family.chooseAction` refresher into family.ts (and adding one for `family.chooseRepeatAction`).
- **PA:** add `enterpriseVoteGuarantors(state, voter)` enterprises to a voter's options (allowed against
  the law even if the guarantor is Prime Minister). Check Lady Newcome's `wasTransferredThisTurn` rule
  for votes. Restrict the "Vote with my enterprises" call to after a law is proposed, before votes. Add
  Company Fraud (start of Revenue). Offer the Scandal cards after Revenue only if PA wants a prompt;
  the anytime panel already allows them in Events in India, Parliament and Upkeep. Confirm the
  power-marker encoding.
- **LS:** give the guarantor's pick to `prestigePickTakenBy(state, guarantor)` at the start of the
  guarantor's Prestige Cards turn. Offer Scandal cards when taken (`startBlackmailPlay`). Add Letters
  of Introduction. Lady Newcome calls `removePromiseFromGame`. Deal real blackmail cards (setup still
  creates placeholders, which can be traded but not played). Set a game-over flag if Final Scoring
  isn't always `phase === "finalScoring"`.
- **EV:** replace `legalElephantPositions` (Envoy to the Mughals) with the Events in India placement
  helper.

## Assumptions

- **Called-in promise cards return to their guarantor** after use. The rulebook doesn't say; this
  lets the guarantor promise again.
- **Partial cash promises:** if a guarantor can't cover a "Take £2 or less" or officeholder-bonus
  call, they pay what they can. The guarantor only chooses (p.8) when several cash calls arrive
  together, or join a pending choice, and exceed their cash. Unfulfilled cards stay with their holders.
- **Promise timing windows:** each promise can be called in only during its card-back phase
  (officeholder bonus: Company Operation; votes: Parliament; nepotism: Hiring; display pick: London
  Season). The grant lasts for that phase on that turn. Finer timing (e.g. "before any votes") is left
  to the owning area.
- **Face-up blackmail means played.** It is no longer transferable, but still counts for power at the
  end. Man on the Inside takes the cancelled card face up into its holder's area.
- **Reactions are asked only of the Man on the Inside holder.** This reveals to the table that they
  hold it; the trade-off avoids asking every player after every blackmail play. The decision is marked
  private, and the UI hides its buttons until that player reveals.
- **Scandal timing:** "anytime after the Revenue phase on a turn" means Events in India, Parliament
  and Upkeep. Vacating without retirement sends the piece to supply, and a vacated Chairman's share is
  lost.
- **The Prime Minister's Ear** is playable during the London Season. On turn 1 London Season is
  skipped, so there is no window before Family.
- **Envoy to the Mughals** is playable from London Season through Revenue.
- **Trade proposals:** only one pending at a time, and a deal is re-checked when accepted.
