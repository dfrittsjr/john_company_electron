import type { ApplyCommandResult, GameCommand, GameState } from "./types";

export type CommandHandler = (state: GameState, command: GameCommand) => ApplyCommandResult;
