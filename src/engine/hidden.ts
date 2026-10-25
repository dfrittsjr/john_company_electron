import type { PlayerId, RegionId } from "./types";

// Placeholder ids that stand in for hidden information in a projected view (see projection.ts).
// They never appear in the authoritative state. All of them start with HIDDEN_ID_PREFIX, which no
// real component id uses, so clients can recognise them with isHiddenId().

export const HIDDEN_ID_PREFIX = "hidden:";

/** A law card in the law deck's draw pile. */
export const HIDDEN_LAW_ID = "hidden:law";
/** A card in the London Season deck (prestige or blackmail; you can't tell which). */
export const HIDDEN_LONDON_SEASON_CARD_ID = "hidden:london-season-card";
/** The identity of a face-down blackmail card you may not see. */
export const HIDDEN_BLACKMAIL_CARD_ID = "hidden:blackmail";
/** An event tile in the Events in India draw stack, below the top one. */
export const HIDDEN_EVENT_TILE_ID = "hidden:event-tile";
/** A card in any other face-down draw pile (generic decks, the Crown's AI deck). */
export const HIDDEN_CARD_ID = "hidden:card";
/** Whoever is making a decision offered only because they hold a face-down card. */
export const HIDDEN_PLAYER_ID = "hidden:player";

const EVENT_TILE_REGION_SEPARATOR = "@";

export function isHiddenId(id: unknown): id is string {
  return typeof id === "string" && id.startsWith(HIDDEN_ID_PREFIX);
}

/**
 * The top event tile of the draw stack shows its painted region side (rulebook p.28), so its
 * placeholder keeps the region: "hidden:event-tile@bombay".
 */
export function hiddenTopEventTileId(regionId: RegionId | undefined): string {
  return regionId ? `${HIDDEN_EVENT_TILE_ID}${EVENT_TILE_REGION_SEPARATOR}${regionId}` : HIDDEN_EVENT_TILE_ID;
}

/** The region on a hidden top tile's placeholder, or undefined for any other id. */
export function hiddenEventTileRegion(tileId: string): RegionId | undefined {
  const prefix = `${HIDDEN_EVENT_TILE_ID}${EVENT_TILE_REGION_SEPARATOR}`;
  return tileId.startsWith(prefix) ? tileId.slice(prefix.length) : undefined;
}

/**
 * The instance id that replaces another player's face-down blackmail card, numbered from 1 in the
 * order the cards sit in that player's area: "hidden:blackmail@player-2#1".
 */
export function hiddenBlackmailInstanceId(ownerId: PlayerId, index: number): string {
  return `${HIDDEN_BLACKMAIL_CARD_ID}${EVENT_TILE_REGION_SEPARATOR}${ownerId}#${index + 1}`;
}
