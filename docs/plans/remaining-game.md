# Plan: finishing the rest of the game

**Where we are.** The 1710 scenario is complete for 3-6 players: every phase, negotiation, the board
UI, undo and the rules reference. **Deregulation and firms (1) and Long 1710 (2) are built** (see
`docs/phases/deregulation.md`); everything else below is not built yet.

| # | Piece | Unlocks | Size | Depends on |
|---|---|---|---|---|
| 1 | Deregulation and firms | Long 1710, 1758, 1813 | XL | — |
| 2 | Long 1710 | the 8-turn game | S | 1 |
| 3 | 1758 "Company Under Siege" (built) | scenario | M | 1 |
| 4 | 1813 "Post Monopoly" (built) | scenario | M | 1 |
| 5 | Setup-card draft variant | rulebook p.5 option | S | — |
| 6 | The Crown (solo and two-player) | 1-2 player games | XL | built on `crown` |
| 7 | Polish backlog | quality | S each | — |

**Recommended order:** 1 → 2 → 3 → 4 → 5, then the polish items as your group runs into them.
Leave 6 until someone actually wants solo or two-player games: it's as big as Deregulation and you
play with three or more.

**How each piece gets built and checked** (the process that worked for 1710):
1. Transcribe data from the print-and-play files. Have a second agent transcribe the same data
   independently and compare the two.
2. Build the rules, with a test for every rulebook worked example.
3. Run the harness with random and greedy bots: no rejected moves, broken invariants or stuck games.
4. Run a focused AI playtest of the new area against the rulebook.
5. At milestones, run a multi-player game through the web UI.

---

## 1. Deregulation and firms (rulebook pp.36-42)

The biggest remaining piece. Deregulation ends the Company's trade monopoly and lets players form
trading firms.

**Data to transcribe**
- **Firm charter**, the back of each family board: the Value track (1-10), the victory points per
  share at each value, and the box text. Source: the punchboard PDFs; the rulebook p.42 picture is a
  cross-check.
- **Firm strategy cards**, four per family: one for each sea zone with its home port, plus Hobnob.
- **The Deregulation card's back** (Debtor's Prison, -1 VP per piece). Already in `src/data/laws.ts`.
- **Half-value refills (resolved).** The small number printed beside each order is half its value,
  rounded down, which is what refilling an order already filled this turn earns (p.40). It is
  already in `src/data/map.ts` as `deregulationValue`; it holds for all 17 orders.

**Rules to build**
1. **Vote to Deregulate** (p.36). This is a special Parliament session at the start of a turn,
   before the London Season.
   - **Trigger:** allowed when Standing or Debt is on a lined space; mandatory when either is on a
     starred space.
   - **Starting support:** +2 when exactly one of the two markers is on a lined space, +6 when both
     are.
   - **Prime Minister:** may vote against this law.
   - **Pass:** halve the Debt (rounding down), move Standing to "S", give the Prime Minister a
     passed-law token, flip the card, and enable firms.
   - **Fail:** set the card aside, advance the Company share VP token (maximum ±3), and the Prime
     Minister stays.
2. **Firms phase** (p.38), between Family and Hiring:
   - **Firm Investments** has no fixed order. Model it as rounds in seat order where each player acts
     or passes, until everyone passes in a row.
   - **Form a firm:** return a Company share, or flip a workshop to its invested side. Weak and
     immature shares can't be used.
   - **Invest:** needs the manager's consent; each investment adds £5 to the London treasury and a
     share; a firm holds at most 10 shares.
   - **Ships:** fit shipyard ships with the owner's consent (£3), or buy back player-owned Company
     ships (£3 fresh, £2 fatigued, paid to the Shipping office).
   - **Hostile takeover:** needs consent from players holding a majority of the firm's shares.
   - **Merger:** needs every shareholder's consent; the merger is one binding transfer.
   - **Firm Strategy:** each firm manager secretly picks a sea zone, its home port and a bid, or
     Hobnob.
3. **Firm trading** (p.40), at the start of each Presidency's operations:
   - Firms with that Presidency's strategy reveal and roll. Initiative = ships minus successes.
   - The President's own Trade roll gives the Company an initiative the same way.
   - Fill in initiative order. A firm fills up to ships + 1 orders, starting from its strategy's home
     port.
   - Refilled orders pay half value. Trade income goes to the India treasury. Value rises one step
     per £6.
4. **At the start of Revenue** (p.41):
   - **Firm expenses:** £1 per ship, plus the larger of shares or value. A firm that can't pay
     dissolves, unless it takes emergency investments (each lowers value by 1) or an emergency
     merger.
   - **Dissolution:** shares go to Debtor's Prison and ships return to their shipyards.
   - **Dividends:** optional. The manager counts as an extra share, and shareholders may waive
     payment with the manager's consent. Place the dividend cube; a Hobnob firm keeps its old
     marker. Move what's left of the India treasury to London.
5. **Storms** (p.42) hit firm ships in their strategy's sea zone; Hobnob firms are safe.
6. **Special retirement** (p.37): one per player with a firm share, in the London Season and again
   in Final Scoring.
   - It is capped by the highest dividend paid by any firm they hold shares in.
   - A firm with no dividend cube placed, or with its cube on 0, doesn't count.
7. **Final Scoring** (p.37):
   - **Firm shares:** each scores the VP for its firm's value; sum the fractions, then round down.
   - **Debtor's Prison:** -1 VP per piece.
   - **Industry's Greed Condemned!:** already handles the deregulated case.
8. **Smaller rules:** the Calico Acts penalty stops after Deregulation, and the Company loses its
   monopoly.

**Secret simultaneous choices** (Firm Strategy). With passed save files, each manager picks in turn
behind the pass-the-device step, and choices stay hidden in the state until all are revealed. This is
the trusted-table model; the online server version (see `online-multiplayer.md`) keeps them truly
secret.

**UI**
- A firm charter panel in each dashboard: treasuries, shares, value and the dividend cube.
- Strategy picking behind the reveal step.
- An initiative order display during Presidency operations.
- Firm ships drawn on the board.

**Tests**
- The rulebook worked examples: Trading with Firms (p.40-41), Firm Expenses and Dividends (p.42),
  and the special retirement example.
- Each consent path; dissolution, emergency investment and merger; Vote to Deregulate pass and fail.

**Size.** About as large as Company Operation and Parliament together. Plan on 2-3 build agents
working on separate files (vote and setup, firm actions, trading and Revenue), then one
integration pass and a playtest.

## 2. Long 1710 (p.4)

- **Setup and length:** same setup as 1710, ending after turn 8.
- **Deregulation:** the Vote to Deregulate is available.
- **Data:** the Power Award band for turns 7-8 is already in the data.
- **Work:** enable the vote for this scenario, check final scoring at turn 8, and run a full 8-turn
  harness game and one UI game.

## 3. 1758 "Company Under Siege" (built)

Data, setup, tests and notes: `docs/phases/scenarios.md`. The setup cards, Situation in India and
scenario card were transcribed twice and compared (`src/data/setup-cards.ts`, `src/data/scenarios.ts`).

**Settled: how Bengal's Governor office is created and filled at setup.** The scenario card puts the
Bengal control token in the Bengal Presidency, so Bengal starts Company-controlled, as after "Form
Governorship" (p.23): the control token on its control side above the President's box, the region
associated with the Bengal Presidency, no dome or tower, and its Governor overlay. The Governor of Bengal
office is therefore *created* at scenario setup (in play, in the Vacant Offices box; `createOffice`), and
a setup card *fills* it: the 1758 deck's base card "GOVERNOR OF BENGAL" (one of the 12 base cards, which
every game deals, whatever the player count) seats its holder like any other office (p.5, "for each office
listed, place a family member on the listed office space and take the matching office card"). So no
special rule is needed, and with the setup cards dealt the office is never left vacant.

**Rules checked:** the London Season is skipped on the scenario's first turn (turn 3), not turn 1: the
engine keys it off `startTurn`.

## 4. 1813 "Post Monopoly" (built)

Setup (scenario card): deregulated with the Deregulation card on its Debtor's Prison side, Military
Oversight and Calico Acts passed, the Governor General in play over the Director of Trade (the law back in
the box), the China office open, two regiments per Army, one Company ship per sea zone, the Company share
VP token on +2/-2, and turns 5-8. The rulebook recommends 5-6 players (p.4); the game allows 3-6 and the
new-game screen says so.

**Correction to the earlier plan:** "all three home regions Company-controlled" does not mean they have
Governors. With the Governor General in play "no new Governors are created (or overlays placed)" (p.26), and
the 1813 setup cards deal no Governor. Bombay, Madras and Bengal start Company-controlled and associated
with their Presidencies (control tokens above the Presidents' boxes), with no towers and no Governors.

## 5. Setup-card draft variant (p.5)

After the setup cards are dealt, each player keeps one and passes the rest to the left, until the
cards run out.
- **Engine:** add a step-by-step private pick decision.
- **Async cost:** with passed save files this means 3-6 hand-offs per round, so the setup screen
  should warn about that.

## 6. The Crown: solo and two-player (rulebook pp.43-46, Crown Handbook)

**Data to transcribe:**
- The Crown Handbook, `printnplay/Rulebooks/John Company Solo Handbook.pdf` (16 pages): each
  phase's Crown behaviour, favors (promise cubes paid or earned), the voting plan, and the
  family-board favors.
- The 10 AI cards: climate, the standing-to-climate chart, the splay position, direction, the
  Presidency arrows and the region priority.

**Rules to build:**
- A Crown actor whose decisions resolve automatically, using the handbook tables and AI-card tie
  breakers.
- The promise-cube economy, with favor windows offered to the human players.
- The Player Button in two-player games.
- Difficulty levels.
- Crown setup: 36 pieces, and the draft or deal distributions.
- The solo scoring adjustment.

**Status (2026-10-25):** the data is transcribed and verified: the Handbook, the 10 AI cards, the
Crown board's favours and the rulebook's pp.43-46 are in `src/data/crown.ts` and
`src/data/crown-handbook.ts` (two independent transcriptions, compared field by field; marker
positions checked on the card images). The Crown is built on branch `crown`: the core in
`src/engine/crown/`, the behaviour of every phase and all the Handbook's favours in its four area
modules, and the UI (Crown board, favours, decisions, the Handbook in the rules). See
docs/phases/crown.md. Crown games run in any scenario (1710, Long 1710, 1758 and 1813), from files
or online (docs/online/server.md, "Crown games").

**Size.** XL, comparable to Deregulation. It's only worth it if you'll play with one or two people.

## 7. Polish backlog

Pick from this as needed.
- **Fork warning on load:** saves already record `parentSaveId`. Warn when loading a save older than
  one already seen for the same game, so two players don't continue from the same file.
- **Phone layout:** the current UI targets laptops (1280 px and wider).
- **Accessibility pass:** keyboard navigation through options and screen-reader labels on board
  elements.
- **Exportable game log:** a "game story" summary at the end.
- **Version mismatch message:** a clearer message when a save comes from a newer or older version,
  with a link to the matching deployment.
- **A first-game walkthrough** for new players.

## Open rules questions to confirm with the group

These are already recorded in `docs/phases/*.md`. Settle them before or during the first human game:
- **Sepoy Recruitment:** each unrest counts double.
- **Opposition Leader:** the marker stays with its holder between votes.
- **Northernmost order:** chosen by its position on the board.
- **Cascade:** the order in which connected orders close.
