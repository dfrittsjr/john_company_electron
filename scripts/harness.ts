// Command-line harness for playing the engine without the UI.
// Used by people debugging rules and by AI playtesters. Games are stored as real .joco saves.
//
//   npm run harness -- new <file> [--scenario 1710] [--players Red,Blue,Yellow] [--seed s] [--setup random|starter]
//   npm run harness -- show <file>
//   npm run harness -- play <file> <n> [--actor id]          apply legal command n of the pending decision
//   npm run harness -- do <file> <type> [payloadJSON] --actor id   any command, including anytime commands
//   npm run harness -- state <file> [dot.path]                print part of the game state as JSON
//   npm run harness -- log <file> [--last 20]
//   npm run harness -- random <file> [--steps 500] [--seed s]  random legal moves until the game ends or breaks

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
      let rng = createRngState(flags.seed ?? "harness-random");
      let current = state;
      for (let step = 0; step < steps; step += 1) {
        const legal = current.pendingDecision.legalCommands;
        if (legal.length === 0) {
          console.log(`Stopped after ${step} moves: no legal commands (${current.pendingDecision.step}).`);
          break;
        }
        let choice = legal[0];
        if (legal.length > 1) {
          const roll = rollDie(rng, legal.length, "harness.random");
          rng = roll.rng;
          choice = legal[roll.value - 1];
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
