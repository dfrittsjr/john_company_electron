# GUI Design

The UI must make the complete board game playable without manual file editing or physical components.

## Overall Layout

Use a three-panel board layout:

- Center: zoomable board with interactive overlays.
- Left: phase sequence, company tracks, offices, decks/discards, current pending decision.
- Right: active player dashboard, negotiation, log, contextual rules.

The board image `board_image-1.png` should be displayed at its native coordinate aspect ratio. All overlays use image-space coordinates so zoom and pan do not break placement.

## Screens

### Start Menu

Actions:

- New Game.
- Load Save.
- Rules Reference.
- Settings.

Show current app version and rules data version.

### New Game Setup

Fields:

- Scenario: `1710`, `1758`, `1813`, `Long 1710`.
- Player count: `1-6`.
- Crown difficulty for `1-2` players.
- Player names and colors.
- Setup distribution: random or draft.
- Hidden info mode: trusted table first, encrypted later.

The start button should be disabled until required game data for the selected mode is available. If Crown data validation fails, solo/two-player setup must identify which Crown data set is missing: AI cards, Crown family board, favor tables, phase profiles, voting plan, or solo scoring table.

Crown setup UI must support:

- Solo setup-card draft: human keeps 1 of 3 and assigns 2 to Crown for four rounds.
- Two-player setup-card draft: each human keeps 2 of 3 and assigns 1 to Crown for two rounds.
- Random setup variants.
- Difficulty adjustments for easy, normal, hard, and expert.
- Initial Player Button holder in two-player mode.

### Main Board

Required board interactions:

- Pan and zoom.
- Click a region to inspect strength, orders, unrest, loot/control token, governor, empire status, adjacency.
- Click an order to inspect open/closed/filled/writer status and trade path eligibility.
- Click an office to inspect holder, treasury, fatigue, action text, hiring rules.
- Click a player piece to show owner and legal interactions.
- Hover overlays for quick tooltips.
- Toggle layers: regions, orders, offices, ships, armies, pieces, labels.

Board overlays required:

- Company Standing, Balance, Debt, turn, vote marker, power markers.
- Prize boxes and player pieces on prizes.
- Court of Directors and Stock Exchange.
- Office cards/holders/fatigue/treasuries.
- Presidency treasuries, writers, sea zones, ships.
- Army boxes, officers, regiments, commanders, local alliances, exhausted pieces.
- Eight India regions with towers, domes, flags, governors, unrest, loot/control tokens, orders, writers, filled/closed order tokens.
- Elephant position and facing.
- Policy dial, law display, London Season display, decks/discards.
- Crown family board, climate marker, Crown promise cubes, faceup AI-card summary, and Player Button when in Crown mode.

## Action Panel

The action panel is driven by `PendingDecision`.

For each decision show:

- Active actor.
- Phase and step.
- Plain-language prompt.
- Legal actions only.
- Costs and sources of cash/pieces.
- Dice count and penalties before rolling.
- Consequences before confirmation when deterministic.
- Rule reference link.

Examples:

- Family action panel lists only actions the player can afford or legally take, plus disabled reasons.
- Chairman allocation panel shows Balance, Debt limit, office treasuries, and required majority consent for extra debt.
- Deploy panel shows legal target regions, calculated strength penalty, selectable army pieces, loot preview, and loss-check preview.
- Parliament panel shows selected law, policy consequence, vote marker, available votes from cash/cards, opposition status.
- Crown panels show the AI-card/profile row being applied, legal favors, promise-cube cost/reward, and whether a favor is mandatory.

## Hotseat Privacy

Between active players, show a pass-device curtain:

- `Pass to Blue`.
- Hide active player private hand/cards until confirmed.
- Show non-private game summary.
- Require click to reveal.

Private views:

- Facedown blackmail identity for owner.
- Secret firm strategy before reveal.
- Crown deck internals hidden from all human players.
- Crown facedown blackmail identities hidden from human players.

## Negotiation UI

Negotiation is available whenever rules allow player transfers.

The modal must support:

- Select giving player and receiving player.
- Transfer family cash.
- Transfer enterprises.
- Transfer facedown blackmail without revealing to non-owners.
- Transfer Company shares except Chairman share.
- Transfer firm shares.
- Transfer promise cards, including returning to guarantor or passing to a third party.
- Record non-binding table talk as a note.
- Call in a promise and resolve whether the guarantor can fulfill it.
- Consent prompts for nepotism, firm investments, dissolutions, mergers, ship fitting, local alliance purchases, hostile takeovers, and any rules-defined consent.
- Crown promise-cube favor payments and rewards during their legal timing windows.
- Player Button transfer in two-player Crown games.

Immediate transfers are binding and should apply as one atomic command.

## Dice UI

Dice rolls must be engine-generated. The UI should:

- Show dice pool construction.
- Show penalties.
- Roll with a clear result list.
- Identify success, failure, catastrophic failure.
- Keep roll results in log and save state.
- Allow follow-up choices after a roll without rerolling on save/load.

## Rules Reference

Use `John-Company-Rules.txt` as searchable local text. Add a curated index that jumps to major sections:

- Setup.
- Negotiation.
- Sequence of Play.
- London Season.
- Family.
- Hiring.
- Company Operation.
- Revenue.
- Events in India.
- Parliament.
- Upkeep.
- Deregulation.
- Playing with One or Two.
- Crown Handbook.
- Crown setup, promise cubes, favors, AI-card tie breakers, and Crown voting plan.

Each action panel should link to the relevant rules section.

## Accessibility And Usability

- Board actions must also be available from lists/dropdowns for users who cannot click tiny regions.
- Use color plus icons/text, not color alone.
- Provide scalable text.
- Provide undo only before confirmation and only when no hidden/random information has been revealed.
- Always show why an action is disabled.
- Always show where cash will come from and where it will go.

## Visual Direction

Preserve a historical document feel, but prioritize legibility.

- Board background: `board_image-1.png`.
- Overlays: high-contrast colored tokens with readable labels.
- Panels: parchment/off-white surfaces with dark ink text.
- Player colors: six distinct accessible colors.
- Avoid decorative fonts for small text.

## Responsive Behavior

Primary target is desktop, but the app should be usable on narrow windows:

- Board remains pan/zoomable.
- Side panels collapse into tabs.
- Active decision remains visible.
- Save/load remains accessible from the top menu.
