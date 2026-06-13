# Save Files And Asynchronous Play

The save system is a required feature, not an afterthought. A save file is the transport mechanism for async play.

## User Flows

### Hotseat Save

1. Any player clicks `Save Game`.
2. The app opens a native save dialog.
3. The game writes a `.joco` file containing the full state and log.
4. Loading the file restores the exact pending decision.

### Async Handoff

1. Active player loads the latest `.joco` file.
2. App shows whose decision is pending.
3. Player completes one or more legal decisions.
4. Player saves a new `.joco` file.
5. Player sends that file to the next player by any external channel.
6. Next player loads the file and continues.

The app does not need networking. Do not build accounts, cloud sync, matchmaking, or a server for the first implementation.

## Save File Extension

Use `.joco` by default. The file is UTF-8 JSON. Gzip compression can be added later, but plain JSON makes debugging easier.

## Save Envelope

```json
{
  "fileType": "john-company-2e-save",
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "rulesetVersion": "john-company-2e-data-1",
  "createdAt": "2026-06-13T00:00:00.000Z",
  "savedAt": "2026-06-13T00:00:00.000Z",
  "gameId": "uuid",
  "saveId": "uuid",
  "parentSaveId": "uuid-or-null",
  "turn": 3,
  "phase": "companyOperation",
  "activeActor": "player-yellow",
  "pendingDecisionId": "decision-uuid",
  "hiddenInfoMode": "trustedTable",
  "state": {},
  "log": [],
  "checksums": {
    "stateSha256": "...",
    "dataSha256": "..."
  }
}
```

## Async Branching

Async games can accidentally fork if two players act from the same parent save. Track this explicitly.

- Every save has a `saveId`.
- Every save stores `parentSaveId`.
- On load, show the previous save ID and timestamp.
- If a loaded save has an older turn/phase/log length than another known local save for the same `gameId`, warn the user.
- Do not block loading; async groups may intentionally branch for testing.

## Hidden Information

John Company is mostly public information, but these items matter:

- Facedown blackmail cards are known only to their owner unless peeked at.
- Firm strategies and trade bids are simultaneous and secret until reveal.
- Crown AI deck order should not be inspectable in normal play.

Implement `trustedTable` first:

- The save contains full hidden data in plain JSON.
- The UI hides private data unless the correct player is active.
- This matches a trust-based physical table and is enough for groups who do not inspect save files.

Design the schema so `encryptedSecrets` can be added later:

```ts
type HiddenInfoState = {
  mode: "trustedTable" | "encryptedSecrets";
  privateCards: Record<PlayerId, CardInstance[]>;
  firmStrategySecrets: Record<FirmId, FirmStrategySecret>;
  crownDeck?: DeckState;
  crownBlackmail?: CardInstance[];
};
```

If encrypted secrets are implemented later:

- Each player has a local passphrase.
- Private card identities are encrypted per owner.
- Firm strategy uses commit-reveal: save a hash commitment first, then reveal strategy and salt after all managers commit.
- The game must still render public card backs and public pending decisions without decrypting secrets.

## Save Timing

The app must allow saving:

- At the start and end of every phase.
- During any player decision.
- After dice are rolled but before the player allocates or confirms follow-up choices.
- During negotiation prompts.
- During consent prompts.
- During Parliament voting rounds.
- During simultaneous firm strategy selection.

The engine should never rely on transient UI state. If a modal is open, its essential state must be represented in `pendingDecision` or a phase-specific state object.

## Event Log

The log is both user-facing history and debugging aid.

Each entry:

```ts
type GameLogEntry = {
  id: string;
  sequence: number;
  timestamp: string;
  turn: number;
  phase: PhaseId;
  actor?: ActorId;
  type: string;
  summary: string;
  details?: unknown;
  commandId?: string;
  rngRolls?: RngRollRecord[];
};
```

Log examples:

- `Yellow purchased a workshop for GBP 5.`
- `Chairman increased Company Debt by 2 and added GBP 10 to Company Balance.`
- `Madras trade succeeded on 4 dice: [1, 2, 5, 6].`
- `Bengal was lost. Company Standing decreased by 1.`
- `Parliament passed Calico Acts with support +3.`

## Validation On Load

On load:

- Validate envelope fields.
- Validate schema version.
- Validate `rulesetVersion` compatibility.
- Recompute and compare checksums when present.
- Ensure all referenced cards/components exist in current data files.
- Rebuild derived values or verify them.
- Refuse clearly corrupt files with a readable error.
- Offer migration only for known old schema versions.

## Deterministic RNG

Use a seedable RNG such as `xoshiro` or `mulberry32` for all game randomness. Store:

```ts
type RngState = {
  algorithm: "xoshiro128ss";
  seed: string;
  counter: number;
  internalState: number[];
};
```

All dice rolls, shuffles, setup deals, law draws, event draws, Crown AI deck shuffles/reveals, Crown climate-shift rolls, random Crown law choices, and failure card draws must go through the engine RNG. Never use `Math.random()` for gameplay.

## Import/Export UI

Required buttons:

- `Save Game`: write current save.
- `Save As`: write a new branch.
- `Load Game`: load `.joco`.
- `Export Log`: save a human-readable markdown or text log.
- `Copy Save Summary`: copy turn/phase/active-player/save-id summary for async messages.

Save summary format:

```text
John Company 2E
Game: 1710, Turn 4, Parliament Meets
Pending: Blue must cast votes or pass
Save ID: 7f2c...
Parent: 51aa...
```

For Crown games, include Crown summary fields in the copied save summary:

```text
Crown: Normal, Climate Peacock, Promise cubes Crown 5 / Blue 7
Player Button: Blue
```

Do not include facedown AI deck order or Crown blackmail identities in the user-facing summary.
