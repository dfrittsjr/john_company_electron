// Read-only helpers that turn game state into things the UI draws. No game rules live here.

import { blackmailCards, enterpriseDecks, offices, prestigeCards } from "../data";
import type { ActorId, GameLogEntry, GameState, LegalCommand, PlayerId } from "../engine";
import { HIDDEN_BLACKMAIL_CARD_ID, HIDDEN_EVENT_TILE_ID, HIDDEN_LAW_ID, HIDDEN_PLAYER_ID, isHiddenId } from "../online/protocol";

/** Six family colours that stay distinct on the parchment board; text labels back them up. */
export const FAMILY_PALETTE = ["#2563a8", "#c9971a", "#c2417d", "#2e7d4f", "#7a4fa0", "#3b3b3b"];

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const NAMED_COLORS = new Set([
  "red",
  "blue",
  "yellow",
  "green",
  "purple",
  "black",
  "white",
  "pink",
  "orange",
  "brown",
  "grey",
  "gray",
  "teal",
]);

/** Each player's colour: their chosen colour when it is a usable CSS colour, else a palette slot. */
export function playerColors(state: GameState): Record<PlayerId, string> {
  const colors: Record<PlayerId, string> = {};
  state.seatingOrder.forEach((playerId, index) => {
    const chosen = state.players[playerId]?.color ?? "";
    colors[playerId] =
      HEX_COLOR.test(chosen) || NAMED_COLORS.has(chosen.toLowerCase())
        ? chosen
        : FAMILY_PALETTE[index % FAMILY_PALETTE.length];
  });
  return colors;
}

export function playerName(state: GameState, playerId: string | undefined): string {
  if (!playerId) return "nobody";
  if (playerId === HIDDEN_PLAYER_ID) return "a player";
  return state.players[playerId]?.name ?? playerId;
}

/** One or two letters to print on a family piece so colour is never the only cue. */
export function playerInitials(state: GameState, playerId: PlayerId): string {
  const name = playerName(state, playerId).trim();
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && /\d/.test(words[1])) return `${words[0][0]}${words[1]}`.slice(0, 3).toUpperCase();
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}

const officeLabels = new Map(offices.map((office) => [office.id, office.label]));

export function officeLabel(officeId: string): string {
  return officeLabels.get(officeId) ?? humanize(officeId);
}

const cardNames = new Map<string, string>([
  ...prestigeCards.map((card) => [card.id, card.name] as const),
  ...blackmailCards.map((card) => [card.id, card.name] as const),
]);

/** Online views replace secrets with "hidden:..." placeholders; name them by what they stand for. */
export function hiddenCardName(cardId: string): string {
  if (cardId.startsWith(HIDDEN_BLACKMAIL_CARD_ID)) return "Face-down blackmail";
  if (cardId.startsWith(HIDDEN_LAW_ID)) return "Face-down law";
  if (cardId.startsWith(HIDDEN_EVENT_TILE_ID)) return "Face-down event tile";
  return "Face-down card";
}

export function cardName(cardId: string): string {
  if (isHiddenId(cardId)) return hiddenCardName(cardId);
  return cardNames.get(cardId) ?? humanize(cardId);
}

const enterpriseNames = new Map<string, string>(
  enterpriseDecks.flatMap((deck) =>
    deck.cards.map((card) => [card.id, deck.type === "shipyard" ? `Shipyard: ${card.label}` : card.label] as const),
  ),
);

/** "Shipyard: Atlas", "Workshop 03", "Luxury 12"; falls back to the enterprise type. */
export function enterpriseName(cardId: string | undefined, type: string): string {
  return (cardId && enterpriseNames.get(cardId)) ?? humanize(type);
}

export function isBlackmailCard(cardId: string): boolean {
  if (isHiddenId(cardId)) return cardId.startsWith(HIDDEN_BLACKMAIL_CARD_ID);
  return blackmailCards.some((card) => card.id === cardId);
}

export function humanize(id: string): string {
  const spaced = id
    .replace(/[-_.]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export const PHASE_LABELS: Record<string, string> = {
  setup: "Setup",
  londonSeason: "London Season",
  family: "Family",
  firms: "Firms",
  hiring: "Hiring",
  companyOperation: "Company Operation",
  bonuses: "Bonuses",
  revenue: "Revenue",
  eventsInIndia: "Events in India",
  parliament: "Parliament Meets",
  upkeep: "Upkeep and Refresh",
  finalScoring: "Final Scoring",
};

export function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? humanize(phase);
}

// ---------------------------------------------------------------------------------------------
// Board targets named by legal commands, for highlighting

const SEA_ZONES = new Set(["west-indian", "south-indian", "east-indian", "china"]);
const PRESIDENCIES = new Set(["Bombay", "Madras", "Bengal"]);

function capitalized(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Board elements a legal command refers to, as keys like "order:bengal-home-6" or "region:delhi".
 * Board elements carry the same keys, so the board can highlight what a decision is about.
 */
export function commandTargets(command: LegalCommand): string[] {
  const targets = new Set<string>();
  const visit = (key: string, value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [innerKey, inner] of Object.entries(value as Record<string, unknown>)) visit(innerKey, inner);
      return;
    }
    if (typeof value === "number" && key === "slot") targets.add(`display:${value}`);
    if (typeof value !== "string") return;

    switch (key) {
      case "orderId":
        targets.add(`order:${value}`);
        break;
      case "regionId":
      case "facing":
        targets.add(`region:${value}`);
        break;
      case "officeId":
        targets.add(`office:${value}`);
        break;
      case "prizeId":
        targets.add(`prize:${value}`);
        break;
      case "slotId":
        targets.add(`stock:${value}`);
        break;
      case "shipId":
        targets.add(`ship:${value}`);
        break;
      case "presidency":
        targets.add(`presidency:${capitalized(value)}`);
        break;
      case "army":
        targets.add(`army:${capitalized(value)}`);
        break;
      case "to":
      case "from":
        if (SEA_ZONES.has(value)) targets.add(`sea:${value}`);
        else if (PRESIDENCIES.has(capitalized(value))) targets.add(`presidency:${capitalized(value)}`);
        break;
      default:
        break;
    }
  };
  visit("", command.payload);
  return [...targets];
}

// ---------------------------------------------------------------------------------------------
// Grouping a decision's legal commands

export type CommandGroup = {
  key: string;
  title: string;
  commands: Array<{ index: number; command: LegalCommand }>;
};

function payloadField(command: LegalCommand, field: string): string | undefined {
  const payload = command.payload as Record<string, unknown> | undefined;
  const value = payload?.[field];
  return typeof value === "string" ? value : undefined;
}

const COMMAND_TITLES: Record<string, string> = {
  "parliament.castVotes": "Vote",
  "parliament.passVote": "Finish voting",
  "parliament.setVoteCredit": "Coalition",
  "retirement.retirePensioner": "Retire to a prize",
  "retirement.stop": "Keep the pensioner",
  "family.chooseAction": "Family action",
  "hiring.hireOffice": "Hire",
  "hiring.skipVacancy": "Leave vacant",
};

function groupTitle(command: LegalCommand): string {
  const base = COMMAND_TITLES[command.type] ?? humanize(command.type.split(".").pop() ?? command.type);
  const direction = payloadField(command, "direction");
  const source = payloadField(command, "source");
  if (direction) return `${base} ${direction}${source ? ` (${source === "cash" ? "cash" : "cards"})` : ""}`;
  const action = payloadField(command, "action");
  if (action && command.type !== "family.chooseAction") return `${base}: ${humanize(action)}`;
  return base;
}

/** Groups commands that do the same kind of thing, keeping their original order and indexes. */
export function groupLegalCommands(commands: LegalCommand[]): CommandGroup[] {
  const groups: CommandGroup[] = [];
  const byKey = new Map<string, CommandGroup>();
  commands.forEach((command, index) => {
    const title = groupTitle(command);
    const key = `${command.type}|${title}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, title, commands: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.commands.push({ index, command });
  });
  return groups;
}

// ---------------------------------------------------------------------------------------------
// Async handoff

/**
 * After a player acts, the player who must decide next if it is someone else; that player should
 * receive the save file. System decisions and the same player continuing need no handoff.
 */
export function handoffTarget(after: GameState, actedBy: ActorId): PlayerId | null {
  const next = after.pendingDecision.actor;
  if (next === "system" || next === "simultaneous") return null;
  if (after.pendingDecision.legalCommands.length === 0) return null;
  return next === actedBy ? null : next;
}

// ---------------------------------------------------------------------------------------------
// Log

export type LogDice = { label: string; values: number[]; dieFaces: boolean };

/** Dice in a log entry. Six-sided rolls are drawn as dice; other random draws as numbers. */
export function logDice(entry: GameLogEntry): LogDice[] {
  return (entry.rngRolls ?? [])
    .filter((roll) => !/shuffle/i.test(roll.label))
    .map((roll) => ({
      label: roll.label,
      values: roll.values,
      dieFaces: roll.values.every((value) => Number.isInteger(value) && value >= 1 && value <= 6),
    }));
}

export const DIE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
