// Command-line harness for playing the engine without the UI.
// Used by people debugging rules and by AI playtesters. Games are stored as real .joco saves.
//
//   npm run harness -- new <file> [--scenario 1710] [--players Red,Blue,Yellow] [--seed s] [--setup random|starter]
//   npm run harness -- show <file>
//   npm run harness -- play <file> <n> [--actor id]          apply legal command n of the pending decision
//   npm run harness -- do <file> <type> [payloadJSON] --actor id   any command, including anytime commands
//   npm run harness -- state <file> [dot.path]                print part of the game state as JSON
//   npm run harness -- log <file> [--last 20]
//   npm run harness -- random <file> [--steps 500] [--seed s] [--anytime 20] [--policy random|greedy]
//       legal moves until the game ends or breaks; --anytime N also mixes in random anytime
//       commands (gifts, deals, promise calls, blackmail) on about N% of moves. --policy greedy
//       prefers productive moves (trade with full dice, little debt, no envoys) so games last longer.
//       --fund N is a test aid, not a rule: it adds £N to the Company Balance at the start of each
//       Revenue phase so the Company survives long enough to exercise the later turns.

import { readFileSync, writeFileSync } from "node:fs";
import {
  applyCommand,
  companyExpectations,
  createNewGame,
  familyPieceTotal,
  isAnytimeCommandType,
  officeHolder,
  playerOffices,
  standingLabel,
  type ActorId,
  type GameCommand,
  type GameState,
} from "../src/engine";
import { createRngState, rollDie } from "../src/engine/rng";
import { blackmailPlayChoices, promiseCallOptions, promiseCardsHeldBy } from "../src/engine";
import type { RngState } from "../src/engine";
import { deserializeSave, serializeSave } from "../src/save";
import type { ScenarioId } from "../src/data/types";

type Flags = Record<string, string>;

const NOW = () => new Date().toISOString();

function parseArgs(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--")) {
      flags[arg.slice(2)] = argv[index + 1] ?? "true";
      index += 1;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function load(file: string): { state: GameState; saveId: string } {
  const envelope = deserializeSave(readFileSync(file, "utf8"));
  return { state: envelope.state, saveId: envelope.saveId };
}

function save(file: string, state: GameState, parentSaveId: string | null): void {
  const saveId = `harness-${state.log.length}-${Date.now().toString(36)}`;
  writeFileSync(file, serializeSave(state, { saveId, parentSaveId, now: state.updatedAt }));
}

function playerName(state: GameState, actor: string): string {
  return state.players[actor]?.name ?? actor;
}

function show(state: GameState): string {
  const decision = state.pendingDecision;
  const lines: string[] = [];
  lines.push(`Turn ${state.turn}/${state.finalTurn} · ${state.phase} · step ${decision.step}`);
  lines.push(
    `Company: Standing ${standingLabel(state)} (expectations ${companyExpectations(state) ?? "-"}), ` +
      `Debt ${state.company.debt}, Balance £${state.company.balance}${state.company.failed ? ", FAILED" : ""}`,
  );
  for (const playerId of state.seatingOrder) {
    const player = state.players[playerId];
    const offices = playerOffices(state, playerId);
    lines.push(
      `  ${player.name} (${playerId}): £${player.cash}, ${player.victoryPoints} VP, ` +
        `supply ${player.familyMembers.supply}, pieces ${familyPieceTotal(state, playerId)}` +
        (offices.length > 0 ? `, offices: ${offices.join(", ")}` : ""),
    );
  }
  const chairman = officeHolder(state, "chairman");
  lines.push(`Chairman: ${chairman ? playerName(state, chairman) : "vacant"}`);
  lines.push("");
  lines.push(`Pending: ${decision.actor === "system" ? "system" : playerName(state, decision.actor)} — ${decision.prompt}`);
  decision.legalCommands.forEach((legal, index) => {
    const payload = legal.payload === undefined ? "" : ` ${JSON.stringify(legal.payload)}`;
    lines.push(`  [${index}] ${legal.type}: ${legal.label}${payload}`);
  });
  if (decision.legalCommands.length === 0) {
    lines.push("  (no legal commands: the game is over or stuck)");
  }
  return lines.join("\n");
}

function defaultActor(state: GameState): ActorId {
  const actor = state.pendingDecision.actor;
  return actor === "simultaneous" ? state.seatingOrder[0] : actor;
}

function apply(state: GameState, type: string, payload: unknown, actorId: ActorId): GameState {
  const command: GameCommand = {
    id: `harness-command-${state.log.length + 1}`,
    gameId: state.gameId,
    actorId,
    decisionId: isAnytimeCommandType(type) ? "anytime" : state.pendingDecision.id,
    type,
    payload,
    clientTimestamp: NOW(),
  };
  const result = applyCommand(state, command);
  if (!result.ok) {
    throw new Error(result.errors.map((error) => `${error.code}: ${error.message}`).join("\n"));
  }
  return result.state;
}

function newLogLines(before: GameState, after: GameState): string {
  return after.log
    .slice(before.log.length)
    .map((entry) => `  log: ${entry.summary}`)
    .join("\n");
}

type AnytimeMove = { actor: string; type: string; payload: unknown };

/** Candidate anytime commands for random play: small gifts, deals, promise calls and blackmail. */
function anytimeMoves(state: GameState): AnytimeMove[] {
  const moves: AnytimeMove[] = [];
  if (state.phase === "finalScoring") return moves;
  const players = state.seatingOrder.filter((playerId) => !state.players[playerId].isCrown);
  for (const actor of players) {
    const others = players.filter((playerId) => playerId !== actor);
    for (const to of others) {
      if (state.players[actor].cash > 0) {
        moves.push({ actor, type: "negotiation.give", payload: { to, items: [{ kind: "cash", amount: 1 }] } });
        if (state.negotiation.interrupts.length === 0) {
          moves.push({ actor, type: "negotiation.proposeTrade", payload: { to, give: [{ kind: "cash", amount: 1 }], receive: [] } });
        }
      }
      for (const card of promiseCardsHeldBy(state, actor).slice(0, 2)) {
        moves.push({ actor, type: "negotiation.give", payload: { to, items: [{ kind: "promise", promiseId: card.id }] } });
      }
    }
    for (const option of promiseCallOptions(state, actor)) {
      moves.push({ actor, type: "negotiation.callInPromises", payload: { calls: [{ promiseId: option.promiseId, option: option.option }] } });
    }
    for (const choice of blackmailPlayChoices(state, actor)) {
      for (const option of choice.options) {
        moves.push({ actor, type: "negotiation.playBlackmail", payload: { cardInstanceId: choice.cardInstanceId, params: option.params } });
      }
    }
  }
  return moves;
}

function pick<T>(rng: RngState, items: T[], label: string): { item: T; rng: RngState } {
  if (items.length === 1) return { item: items[0], rng };
  const roll = rollDie(rng, items.length, label);
  return { item: items[roll.value - 1], rng: roll.rng };
}

/**
 * A simple greedy player: score each offered option by its label and keep the best ones (ties are
 * broken at random by the caller). It only needs to keep the Company alive long enough to reach the
 * later turns; it is not a strategy.
 */
function greedyScore(state: GameState, label: string): number {
  const amount = Number(label.match(/(\d+)/)?.[1] ?? 0);
  const rules: Array<[RegExp, number]> = [
    [/^Trade$/, 40],
    // About four dice is a good chance of success; treasuries carry over to the next turn.
    [/^Spend .* and roll/, 20 + (amount <= 4 ? amount : 8 - amount)],
    [/^Place a .* writer on|^Fill .* filled-order token/, 15],
    [/^Fit the shipyard/, 15],
    [/^Buy a Company ship/, 12],
    [/^Give all .* to Presidency/, 12],
    [/^Give all .* to Manager of Shipping/, 10],
    [/^Stop sending envoys/, 20],
    [/^Finish as Director of Trade/, 5],
    [/^Administer/, 5],
    [/^Enlist Writer/, 8],
    [/^Seek Share/, 6],
    [/^Purchase Workshop/, 4],
    [/^Extra writer/, 5],
    [/^Pay No Dividends/, 10],
    [/^Keep the card$/, 5],
    [/^Play Company Fraud|^Play Scandal|^Play Mercantile|^Play Diplomatic/, -10],
    [/^Discard Royal Protection/, 10],
    [/^Retire to the .*prize/, 10 - amount / 2],
    [/^Pass$|^Pass this round|^Finish voting|^Stop voting|^Resolve/, 5],
    [/^Return a piece/, 1],
    [/^Check again/, -10],
    [/^Special Envoy/, -50],
    [/^Cancel this Trade/, -50],
    [/^Deploy against|^Go on to Deploy/, -20],

    [/^Ask the Court/, -10],
    [/^Call another round/, -10],
    [/^Lease an extra ship/, 9],
    [/^Rotate .* for|^Spend .* vote/, -5],
    [/^Do not retire/, -5],
  ];
  if (/^Advance Company Debt/.test(label)) return state.company.debt < 3 ? 8 : -5;
  // Declare another region only when the sea zone has ships to spare for its orders.
  if (/^Also declare/.test(label)) {
    const current = state.companyOperation.current;
    const zone = current?.office === "presidency" ? { Bombay: "west-indian", Madras: "south-indian", Bengal: "east-indian" }[current.presidency] : undefined;
    return state.company.ships.filter((ship) => ship.location === zone).length >= 3 ? 3 : -5;
  }
  // Allocate in small steps: Shipping until it can add a ship, then spread across the Presidencies,
  // favouring those with more ships (more orders per Trade) and less cash already.
  if (/^Give all .* to Manager of Shipping/.test(label)) return 3;
  if (/^Give .* to Manager of Shipping/.test(label)) {
    return (state.company.offices["manager-of-shipping"]?.treasury ?? 0) < 10 ? 14 : 2;
  }
  const presidency = label.match(/^Give (all )?.* to Presidency of (\w+)/);
  if (presidency) {
    const zone = { Bombay: "west-indian", Madras: "south-indian", Bengal: "east-indian" }[presidency[2]];
    const ships = state.company.ships.filter((ship) => ship.location === zone).length;
    const treasury = state.company.offices[`president-${presidency[2].toLowerCase()}`]?.treasury ?? 0;
    return (presidency[1] ? 9 : 12) + ships - Math.floor(treasury / 4);
  }
  if (/^Give .* to Director of Trade/.test(label)) return 1;
  for (const [pattern, score] of rules) if (pattern.test(label)) return score;
  return 0;
}

function greedyChoices(state: GameState, legal: GameState["pendingDecision"]["legalCommands"]) {
  const scored = legal.map((command) => ({ command, score: greedyScore(state, command.label) }));
  const best = Math.max(...scored.map((entry) => entry.score));
  return scored.filter((entry) => entry.score === best).map((entry) => entry.command);
}

function checkInvariants(state: GameState): string[] {
  const problems: string[] = [];
  for (const playerId of Object.keys(state.players)) {
    const expected = state.players[playerId].isCrown ? 36 : 18;
    const total = familyPieceTotal(state, playerId);
    if (total !== expected) problems.push(`${playerId} has ${total} family pieces, expected ${expected}`);
    if (state.players[playerId].cash < 0) problems.push(`${playerId} has negative cash`);
  }
  if (state.company.balance < 0) problems.push("Company Balance is negative");
  if (state.pendingDecision.phase !== state.phase) problems.push("pending decision phase differs from game phase");
  return problems;
}

function main(): void {
  const [subcommand, file, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (!subcommand || !file) {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(0, 12).join("\n"));
    process.exit(1);
  }

  if (subcommand === "new") {
    const names = (flags.players ?? "Red,Blue,Yellow").split(",");
    const now = NOW();
    const state = createNewGame({
      mode: "hotseat",
      scenario: (flags.scenario ?? "1710") as ScenarioId,
      seed: flags.seed ?? `harness-${now}`,
      now,
      setupDistribution: (flags.setup ?? "random") as "random" | "starter",
      players: names.map((name, index) => ({ id: `player-${index + 1}`, name, color: name.toLowerCase() })),
    });
    save(file, state, null);
    console.log(show(state));
    return;
  }

  const { state, saveId } = load(file);

  switch (subcommand) {
    case "show":
      console.log(show(state));
      return;
    case "state": {
      const path = positional[0];
      const value = path
        ? path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], state)
        : state;
      console.log(JSON.stringify(value, null, 2));
      return;
    }
    case "log": {
      const last = Number(flags.last ?? 20);
      for (const entry of state.log.slice(-last)) {
        console.log(`#${entry.sequence} t${entry.turn} ${entry.phase} ${entry.actor ?? ""}: ${entry.summary}`);
      }
      return;
    }
    case "play": {
      const index = Number(positional[0]);
      const legal = state.pendingDecision.legalCommands[index];
      if (!legal) throw new Error(`No legal command [${positional[0]}].`);
      const next = apply(state, legal.type, legal.payload ?? {}, (flags.actor as ActorId) ?? defaultActor(state));
      save(file, next, saveId);
      console.log(newLogLines(state, next));
      console.log(show(next));
      return;
    }
    case "do": {
      const [type, payloadJson] = positional;
      const payload = payloadJson ? JSON.parse(payloadJson) : {};
      const next = apply(state, type, payload, (flags.actor as ActorId) ?? defaultActor(state));
      save(file, next, saveId);
      console.log(newLogLines(state, next));
      console.log(show(next));
      return;
    }
    case "random": {
      const steps = Number(flags.steps ?? 500);
      const anytimePercent = Number(flags.anytime ?? 0);
      let rng = createRngState(flags.seed ?? "harness-random");
      let current = state;
      for (let step = 0; step < steps; step += 1) {
        if (anytimePercent > 0) {
          const roll = rollDie(rng, 100, "harness.anytime");
          rng = roll.rng;
          const moves = roll.value <= anytimePercent ? anytimeMoves(current) : [];
          if (moves.length > 0) {
            const picked = pick(rng, moves, "harness.anytime.move");
            rng = picked.rng;
            try {
              current = apply(current, picked.item.type, picked.item.payload, picked.item.actor);
            } catch (error) {
              console.log(`Anytime move ${step} (${picked.item.type}) was rejected although it was offered:`);
              console.log(JSON.stringify(picked.item));
              console.log(String(error));
              break;
            }
            const problems = checkInvariants(current);
            if (problems.length > 0) {
              console.log(`Invariant broken after anytime move ${step} (${picked.item.type}):\n  ${problems.join("\n  ")}`);
              break;
            }
            continue;
          }
        }
        const legal = current.pendingDecision.legalCommands;
        if (legal.length === 0) {
          console.log(`Stopped after ${step} moves: no legal commands (${current.pendingDecision.step}).`);
          break;
        }
        const fund = Number(flags.fund ?? 0);
        if (fund > 0 && current.pendingDecision.step === "revenue.confirm") {
          current = { ...current, company: { ...current.company, balance: current.company.balance + fund } };
        }
        const candidates = flags.policy === "greedy" ? greedyChoices(current, legal) : legal;
        let choice = candidates[0];
        if (candidates.length > 1) {
          const roll = rollDie(rng, candidates.length, "harness.random");
          rng = roll.rng;
          choice = candidates[roll.value - 1];
        }
        try {
          current = apply(current, choice.type, choice.payload ?? {}, defaultActor(current));
        } catch (error) {
          console.log(`Move ${step} (${choice.type}) was rejected although it was listed as legal:`);
          console.log(String(error));
          break;
        }
        const problems = checkInvariants(current);
        if (problems.length > 0) {
          console.log(`Invariant broken after move ${step} (${choice.type}):\n  ${problems.join("\n  ")}`);
          break;
        }
      }
      save(file, current, saveId);
      console.log(show(current));
      return;
    }
    default:
      throw new Error(`Unknown harness command "${subcommand}".`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
