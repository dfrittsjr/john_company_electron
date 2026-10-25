# Deregulation and firms (rulebook pp.36-42)

**Status: built.** Each area's rules coverage and assumptions are in `deregulation-vr.md` (Vote and
Revenue), `deregulation-fp.md` (Firms phase), `deregulation-tr.md` (trading and storms),
`deregulation-sc.md` (special retirement, scoring, Refresh) and `deregulation-ui.md`. Integration
notes are at the end of this file.

The shared spec for building Deregulation. Scope: everything in pp.36-42, plus making **Long 1710**
(8 turns, Vote to Deregulate available) playable. 1758 and 1813 setup are out of scope.

Read first: `docs/phase-build-guide.md` (conventions), this file, the rulebook text pp.36-42
(`/tmp/claude-1000/-home-hamferd-projects-john-company-electron/77a9d9ab-c10b-43fc-85c4-4eb346f8f37b/scratchpad/txt/rules_raw.txt`,
lines 3199-3640; the PDF is `printnplay/Rulebooks/John Company Rules.pdf`).

## What exists (the contract)

| Piece | Where | Notes |
| --- | --- | --- |
| Firm data | `src/data/firms.ts` | Strategy cards (West/Bombay, South/Madras, East/Bengal, Hobnob), charter costs, Value-track VP per share, firm names by colour. Transcribed from the charter and the strategy cards. |
| Firm state | `FirmState`, `FirmTradeRecord`, `FirmStrategySecret` in `src/engine/types.ts` | `state.firms` (array, `[]` once deregulated). Firm ships are `company.ships` with `location: "firm:<id>"`. |
| Strategy secrets | `state.hidden.firmStrategySecrets[firmId]` | `{ strategy, bid, revealed }`. Online views hide `strategy`/`bid` from everyone but the manager (`projection.ts`); a revealed strategy is public. |
| Other new fields | `EnterpriseInstance.invested`, `ShareInstance.createdTurn` | Invested workshops (p.38); immature Company shares (p.38). |
| Deregulated flag | `state.parliament.deregulated` | Read it through `isDeregulated(state)`. |
| Helpers | `src/engine/firms.ts` | `formFirm`, `investInFirm` (emergency lowers Value), `dissolveFirm`, `mergeFirms`, `takeOverFirm`, `transferFirmShares`, `firmInvestmentSources` (weak/immature rules), selectors (`firmManagedBy`, `firmShips`, `firmName`, `firmShareVictoryPoints`, `firmStrategy`, `weakCompanySharesReason`). They change pieces and cash only; phases own decisions, consents and log entries. Tests: `src/tests/engine/firms-core.test.ts`. |
| Turn start hook | `beginTurn(state)` in `src/engine/phases/turn-start.ts` | Upkeep calls it for every new turn. Today it returns the London Season start. |
| Firms phase hook | `startFirmsPhase(state)` in `src/engine/phases/firms.ts` | Family calls it instead of Hiring once deregulated. Today it goes straight to Hiring. `firmsCommandHandlers` is already registered. |
| Fixtures | `src/tests/fixtures/firms.ts` | `deregulatedGame()`, `withWorkshop`, `withCompanyShares`. |
| Harness | `npm run harness -- new g.joco --deregulated` | Starts Long 1710 as if the vote had passed. Long games need `--steps 6000`. |

Change the shared pieces only if you must, keep it small, and say so in your report. Don't bump
`GAME_SCHEMA_VERSION`; the integrator does.

## Ownership

| Area | Owner | Files | Rules |
| --- | --- | --- | --- |
| **VR** Vote and Revenue | agent VR | `phases/turn-start.ts`, `phases/parliament*.ts`, `phases/parliament/*`, `phases/revenue.ts` | Vote to Deregulate (p.36) and its effects; laws that react to Deregulation; Calico Acts; firm expenses, dissolution, emergency investments and mergers, dividends (pp.41-42). |
| **FP** Firms phase | agent FP | `phases/firms.ts`, new `phases/firms/*`; small hooks in `phases/family.ts` (set `createdTurn` on new Company shares) and the negotiation transfer code (firm shares as a transferable asset) | Firm Investments: form, invest, fit ships, buy back player ships, hostile takeover, merger, voluntary dissolution, with consents (pp.37-39). Firm Strategy (p.40). |
| **TR** Trading and storms | agent TR | `phases/company-operation*.ts`, `phases/company-operation/*`, `phases/bonuses.ts`, storm code in `phases/events-in-india*` | Firm trading at each Presidency (p.40), half-value refills, Value advance (p.41); Connections against firm rolls; storms on firm ships (p.42); invested workshops give no bonus (p.38). |
| **SC** Scoring and seasons | agent SC | `phases/london-season*.ts`, `phases/retirements.ts`, `phases/final-scoring*.ts`, `phases/upkeep.ts` | Special retirement in the London Season and in Final Scoring (p.37); firm shares and Debtor's Prison in Final Scoring (p.37, p.41); invested workshops on Company failure (p.38); Refresh clears this turn's firm records. Long 1710 runs to turn 8. |
| **UI** | agent UI | `src/ui/**`, `src/pages/**`, online scenario choice (`src/ui/online/*`, `src/worker/*` only if needed) | Long 1710 selectable (hotseat and online); firm charters on the dashboards; Debtor's Prison; firm ships; strategies and initiative; anything new the other areas expose. |

Each area writes its notes (rules covered, assumptions, open questions) in
`docs/phases/deregulation-<area>.md` (`vr`, `fp`, `tr`, `sc`, `ui`), not in this file.

## Rulings made up front

So the areas agree. Record any further assumption in your own notes, with a test that names it.

1. **Who may call the vote.** At the start of each turn of a scenario with `deregulationAvailable`
   (Long 1710, 1758), before the London Season, while not yet deregulated: if Standing or Debt is on
   a lined space, the Prime Minister may call the session; if either is on a starred space, they
   must. No Prime Minister: skip it. Turn 1 is checked like any other.
2. **Firm Investments order** (p.38: "no set order"): rounds in Prime Minister order. Each player in
   turn takes one action or passes. The step ends when every player has passed since the last
   action. Passing doesn't stop a player acting in a later round.
3. **Immature shares** apply to forming a firm as well as investing (the two caveats restrict "two of
   the actions", p.38). Implemented in `firmInvestmentSources`.
4. **Firm Strategy** (p.40) is a private decision for each manager in Prime Minister order. A sea zone
   needs at least one firm ship; the bid is 1 to the London treasury for a sea zone, 0 for Hobnob.
   Choices go to `hidden.firmStrategySecrets`. When the last manager has chosen, every bid becomes
   public: `firm.tradeBid` is set and taken out of the London treasury. Strategies stay secret until
   their Presidency's reveal (`revealed: true`, `firm.trade` set).
5. **Bids and dice.** The firm rolls one die per £ bid at its Presidency's start; the bid goes to the
   bank whatever the result (p.40).
6. **Value** stays within 1-10. Emergency investments and anything else that lowers it stop at 1.
7. **Firm ships don't fatigue** from trading; the rules give firms no ship fatigue.
8. **Expenses order** (p.41): firms with an initiative this turn, lowest first; then every other firm
   (Hobnob, failed rolls, no strategy). Ties: the manager with more window icons
   (`playerWindowIcons`), then clockwise from the Prime Minister.

## Worked examples to test

- Trading with Firms (p.40-41): Green's firm, initiative -1, then the President at half value.
- Firm Expenses and Dividends (p.42): £2 ships, £5 value, 3 dividends of £4, cube on 12.
- Optional Dividends (p.42): Blue 2 shares + manager, Yellow 2, £8 paid as £4 each.
- Vote to Deregulate pass and fail (p.36); Debt halved, Standing to "S" (£10, the `deregulationReset`
  space).

## Integration notes

- **Save format** stays at schema 3: every Deregulation field is optional, and 1710 saves from
  before it load and play on (checked with a six-player playtest save).
- **Firm shares in Deals & Cards:** one checkbox per share; shares of one firm combine into one
  `firmShare` transfer item.
- **Harness:** `--deregulated` starts a deregulated Long 1710 game; `--until <step prefix>` stops
  random play at a decision; the greedy policy forms firms, fits ships, bids a few dice, pays
  dividends and agrees to firm requests. Greedy, funded four-player games run all 8 turns with
  firms trading, paying dividends and dissolving; random games exercise takeovers, mergers and
  rescues.
