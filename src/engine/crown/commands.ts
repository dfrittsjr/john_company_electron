import type { CommandHandler } from "../command-handler";
import { refreshPendingDecision } from "../phases/negotiation";
import type { ApplyCommandResult, GameState, PlayerId } from "../types";
import { buyCrownFavor } from "./favors";
import { appendCrownLog, giveCubes, humanPlayerIds, isCrownPlayer } from "./state";

function rejected(code: string, message: string): ApplyCommandResult {
  return { ok: false, errors: [{ code, message }] };
}

function accepted(state: GameState): ApplyCommandResult {
  return { ok: true, state, logEntry: state.log[state.log.length - 1] };
}

/** `crown.favor` { favorId, option? }: a player buys a favour from the Crown (rulebook p.46). */
const favorCommand: CommandHandler = (state, command) => {
  if (!state.crown) return rejected("NOT_A_CROWN_GAME", "There is no Crown in this game.");
  if (state.finalScoring.complete) return rejected("GAME_OVER", "The game is over.");
  if (isCrownPlayer(state, command.actorId)) return rejected("ACTOR_NOT_ALLOWED", "The Crown doesn't buy favours.");
  const payload = (command.payload ?? {}) as { favorId?: unknown; option?: unknown };
  if (typeof payload.favorId !== "string") return rejected("INVALID_PAYLOAD", "Say which favour.");
  try {
    const next = buyCrownFavor(
      { ...state, updatedAt: command.clientTimestamp },
      command.actorId as PlayerId,
      payload.favorId,
      payload.option,
      command.clientTimestamp,
    );
    return accepted(refreshPendingDecision(next));
  } catch (error) {
    return rejected("FAVOR_NOT_AVAILABLE", (error as Error).message);
  }
};

/** `crown.giveCubes` { to, count }: in a two-player game, cubes may change hands at any time (p.44). */
const giveCubesCommand: CommandHandler = (state, command) => {
  if (!state.crown) return rejected("NOT_A_CROWN_GAME", "There is no Crown in this game.");
  const payload = (command.payload ?? {}) as { to?: unknown; count?: unknown };
  const from = command.actorId as PlayerId;
  const to = typeof payload.to === "string" ? payload.to : "";
  const count = typeof payload.count === "number" && Number.isInteger(payload.count) ? payload.count : 0;
  const humans = humanPlayerIds(state);
  if (!humans.includes(from) || !humans.includes(to) || from === to) {
    return rejected("ILLEGAL_TRANSFER", "Promise cubes can only pass between the two players.");
  }
  try {
    const next = appendCrownLog(giveCubes({ ...state, updatedAt: command.clientTimestamp }, from, to, count), {
      now: command.clientTimestamp,
      actor: from,
      type: "crown.giveCubes",
      summary: `${state.players[from].name} gave ${count} promise cube${count === 1 ? "" : "s"} to ${state.players[to].name}.`,
      details: { from, to, count },
    });
    return accepted(refreshPendingDecision(next));
  } catch (error) {
    return rejected("ILLEGAL_TRANSFER", (error as Error).message);
  }
};

export const crownAnytimeCommandHandlers: Record<string, CommandHandler> = {
  "crown.favor": favorCommand,
  "crown.giveCubes": giveCubesCommand,
};
