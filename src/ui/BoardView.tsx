import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { localAlliances, mapData } from "../data";
import {
  chairmanHolder,
  powerMarkerPositions,
  shipyardOwner,
  standingLabel,
  type GameState,
  type PlayerId,
  type PresidencyId,
  type ShipState,
} from "../engine";
import { describeFillers, orderFillers } from "./firm-view";
import {
  ARMY_LAYOUT,
  BOARD_HEIGHT,
  BOARD_VIEWS,
  BOARD_WIDTH,
  COURT_BOX,
  DEBT_SPACES,
  GOVERNOR_SPOTS,
  LONDON_DISPLAY_BOX,
  OFFICE_SPOTS,
  OFFICERS_IN_TRAINING_BOX,
  PENSIONERS_BOX,
  PHASE_MARKERS,
  POWER_BOXES,
  PRIZE_BOXES,
  SEA_ZONE_SPOTS,
  STANDING_SPACES,
  STOCK_EXCHANGE_SPOTS,
  TREASURY_SPOTS,
  VACANT_OFFICES_BOX,
  WRITER_BOXES,
  balanceSpace,
  turnSpace,
  victoryPointSpace,
  voteSpace,
  type Box,
  type Point,
} from "./board-layout";
import { cardName, isBlackmailCard, officeLabel, playerColors, playerInitials } from "./view-model";

const BOARD_IMAGE_URL = "/images/board.webp";
const regionPositions = new Map<string, Point>(mapData.regions.map((region) => [region.id, region.boardPosition]));
const allianceNames = new Map(localAlliances.map((alliance) => [alliance.id, alliance.name]));
const PRESIDENCIES: PresidencyId[] = ["Bombay", "Madras", "Bengal"];
const EMPIRE_COLORS: Record<string, string> = {
  "empire-flag-1": "#d9d9d9",
  "empire-flag-2": "#e3b448",
  "empire-flag-3": "#b0673a",
};

// Pieces keep a minimum on-screen size when the board is zoomed out, so family initials stay
// readable on a laptop. The boost is capped so stacks laid out on 130-160px cells don't overlap.
const MIN_PIECE_SCREEN_RADIUS = 10;
const MAX_PIECE_BOOST = 1.6;
const PieceBoost = createContext(1);

function pieceBoost(scale: number): number {
  return Math.min(MAX_PIECE_BOOST, Math.max(1, MIN_PIECE_SCREEN_RADIUS / (36 * scale)));
}

type Props = {
  game: GameState;
  /** Changing this value refits the whole board, e.g. after loading a save. */
  resetKey?: number;
  /** Board elements the current decision's options refer to. */
  highlights: Set<string>;
  /** Elements the hovered option refers to. */
  focus: Set<string>;
  selected: string | null;
  onSelect: (target: string) => void;
};

type View = { scale: number; x: number; y: number };

export function BoardView({ game, resetKey, highlights, focus, selected, onSelect }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>({ scale: 0.2, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const fitted = useRef(false);
  const drag = useRef<{ startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const showBox = useCallback((target: Box) => {
    const stage = stageRef.current;
    if (!stage) return;
    const width = stage.clientWidth || 800;
    const height = stage.clientHeight || 400;
    const scale = Math.min(width / target.width, height / target.height);
    setView({
      scale,
      x: (width - target.width * scale) / 2 - target.x * scale,
      y: (height - target.height * scale) / 2 - target.y * scale,
    });
  }, []);

  useLayoutEffect(() => {
    if (!fitted.current) {
      fitted.current = true;
      showBox(BOARD_VIEWS.board);
    }
  }, [showBox]);

  useEffect(() => {
    if (resetKey !== undefined) showBox(BOARD_VIEWS.board);
  }, [resetKey, showBox]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    let lastWidth = stage.clientWidth;
    const observer = new ResizeObserver(() => {
      if (Math.abs(stage.clientWidth - lastWidth) > 4) {
        lastWidth = stage.clientWidth;
        showBox(BOARD_VIEWS.board);
      }
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [showBox]);

  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const px = clientX === undefined ? rect.width / 2 : clientX - rect.left;
    const py = clientY === undefined ? rect.height / 2 : clientY - rect.top;
    const current = viewRef.current;
    const minScale = Math.min(rect.width / BOARD_WIDTH, rect.height / BOARD_HEIGHT) * 0.8;
    const scale = Math.min(Math.max(current.scale * factor, minScale), 1.5);
    const ratio = scale / current.scale;
    setView({ scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio });
  }, []);

  // Wheel zoom needs a non-passive listener so the page does not scroll.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = { startX: event.clientX, startY: event.clientY, x: view.x, y: view.y, moved: false };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.moved && Math.hypot(dx, dy) < 5) return;
    current.moved = true;
    setView((old) => ({ ...old, x: current.x + dx, y: current.y + dy }));
  };
  const onPointerUp = () => {
    suppressClick.current = Boolean(drag.current?.moved);
    drag.current = null;
  };

  const select = (target: string) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onSelect(target);
  };

  return (
    <div className="board-view">
      <div className="board-toolbar" role="toolbar" aria-label="Board view">
        <button type="button" className="tool-button" onClick={() => zoomAt(1.25)} aria-label="Zoom in">
          +
        </button>
        <button type="button" className="tool-button" onClick={() => zoomAt(0.8)} aria-label="Zoom out">
          −
        </button>
        <button type="button" className="tool-button" onClick={() => showBox(BOARD_VIEWS.board)}>
          Whole board
        </button>
        <button type="button" className="tool-button" onClick={() => showBox(BOARD_VIEWS.india)}>
          India
        </button>
        <button type="button" className="tool-button" onClick={() => showBox(BOARD_VIEWS.company)}>
          Company
        </button>
      </div>
      <div
        className="board-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div
          className="board-canvas"
          style={{
            width: BOARD_WIDTH,
            height: BOARD_HEIGHT,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          <img src={BOARD_IMAGE_URL} alt="John Company game board" width={BOARD_WIDTH} height={BOARD_HEIGHT} draggable={false} />
          <PieceBoost.Provider value={pieceBoost(view.scale)}>
            <BoardOverlay game={game} highlights={highlights} focus={focus} selected={selected} onSelect={select} />
          </PieceBoost.Provider>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Overlay

type OverlayProps = Omit<Props, "onSelect"> & { onSelect: (target: string) => void };

export function BoardOverlay({ game, highlights, focus, selected, onSelect }: OverlayProps) {
  const colors = playerColors(game);
  const ctx: DrawContext = { game, colors, highlights, focus, selected, onSelect };

  return (
    <svg
      className="board-overlay-svg"
      viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
      width={BOARD_WIDTH}
      height={BOARD_HEIGHT}
      role="img"
      aria-label="Pieces on the board"
    >
      <PhaseMarker ctx={ctx} />
      <CompanyTracks ctx={ctx} />
      <VictoryPoints ctx={ctx} />
      <PrizeBoxes ctx={ctx} />
      <LondonDisplay ctx={ctx} />
      <CourtAndStockExchange ctx={ctx} />
      <PensionersAndVacancies ctx={ctx} />
      <Offices ctx={ctx} />
      <Armies ctx={ctx} />
      <Presidencies ctx={ctx} />
      <Ships ctx={ctx} />
      <India ctx={ctx} />
    </svg>
  );
}

type DrawContext = {
  game: GameState;
  colors: Record<PlayerId, string>;
  highlights: Set<string>;
  focus: Set<string>;
  selected: string | null;
  onSelect: (target: string) => void;
};

/** A clickable group that shows highlight rings for its target key. */
function Target({
  ctx,
  target,
  ring,
  children,
  label,
}: {
  ctx: DrawContext;
  target: string;
  ring: Box | { cx: number; cy: number; r: number };
  children?: ReactNode;
  label: string;
}) {
  const state = ctx.focus.has(target)
    ? "focus"
    : ctx.selected === target
      ? "selected"
      : ctx.highlights.has(target)
        ? "highlight"
        : "none";
  return (
    <g
      className={`board-target board-target-${state}`}
      data-target={target}
      onClick={(event) => {
        event.stopPropagation();
        ctx.onSelect(target);
      }}
    >
      <title>{label}</title>
      {"r" in ring ? (
        <circle className="target-ring" cx={ring.cx} cy={ring.cy} r={ring.r} />
      ) : (
        <rect className="target-ring" x={ring.x} y={ring.y} width={ring.width} height={ring.height} rx={24} />
      )}
      {children}
    </g>
  );
}

function Piece({ x, y, color, text, r: baseRadius = 36 }: { x: number; y: number; color: string; text?: string; r?: number }) {
  const r = baseRadius * useContext(PieceBoost);
  return (
    <g className="piece">
      <circle cx={x} cy={y} r={r} fill={color} stroke="#fffaf0" strokeWidth={7} />
      {text ? (
        <text x={x} y={y + r * 0.36} textAnchor="middle" className="piece-text" fontSize={r * 0.95}>
          {text}
        </text>
      ) : null}
    </g>
  );
}

function Label({
  x,
  y,
  text,
  size = 46,
  anchor = "middle",
  className = "",
}: {
  x: number;
  y: number;
  text: string;
  size?: number;
  anchor?: "start" | "middle" | "end";
  className?: string;
}) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={size} className={`board-label ${className}`}>
      {text}
    </text>
  );
}

/** A stack of one family's pieces: a disc with initials and a count beside it. */
function Stack({ ctx, x, y, playerId, count, r = 36, faded = false }: { ctx: DrawContext; x: number; y: number; playerId: PlayerId; count: number; r?: number; faded?: boolean }) {
  const shown = r * useContext(PieceBoost);
  return (
    <g opacity={faded ? 0.55 : 1}>
      <Piece x={x} y={y} color={ctx.colors[playerId] ?? "#555"} text={playerInitials(ctx.game, playerId)} r={r} />
      {count > 1 ? <Label x={x + shown + 8} y={y + shown * 0.45} text={`×${count}`} size={shown * 1.25} anchor="start" /> : null}
    </g>
  );
}

/** Lay items out in rows inside a box. */
function gridPositions(area: Box, count: number, cell: number): Point[] {
  const perRow = Math.max(1, Math.floor(area.width / cell));
  return Array.from({ length: count }, (_, index) => ({
    x: area.x + cell / 2 + (index % perRow) * cell,
    y: area.y + cell / 2 + Math.floor(index / perRow) * cell,
  }));
}

function playerStacks(ctx: DrawContext, area: Box, counts: Array<[PlayerId, number]>, cell = 150, r = 36, faded = false) {
  const entries = counts.filter(([, count]) => count > 0);
  const spots = gridPositions(area, entries.length, cell);
  return entries.map(([playerId, count], index) => (
    <Stack key={playerId} ctx={ctx} x={spots[index].x} y={spots[index].y} playerId={playerId} count={count} r={r} faded={faded} />
  ));
}

// ---------------------------------------------------------------------------------------------
// Layers

const RIBBON_ORDER = [
  "chairman",
  "director-of-trade",
  "manager-of-shipping",
  "military-affairs",
  "president-bombay",
  "president-madras",
  "president-bengal",
  "superintendent-of-trade-in-china",
];

/** The ribbon spot for the current phase, or during Company Operation the office now acting. */
function activeSpot(game: GameState): Point | undefined {
  if (game.phase !== "companyOperation") return PHASE_MARKERS[game.phase];
  const current = game.companyOperation.current;
  if (current?.office === "presidency") return OFFICE_SPOTS[`president-${current.presidency.toLowerCase()}`];
  if (current) return OFFICE_SPOTS[current.office];
  const step = game.pendingDecision.step;
  const presidency = game.pendingDecision.legalCommands
    .map((command) => (command.payload as { presidency?: unknown } | undefined)?.presidency)
    .find((value): value is string => typeof value === "string");
  if (step.startsWith("companyOperation.presidency") && presidency) return OFFICE_SPOTS[`president-${presidency.toLowerCase()}`];
  if (step.includes("shipping")) return OFFICE_SPOTS["manager-of-shipping"];
  if (step.includes("china")) return OFFICE_SPOTS["superintendent-of-trade-in-china"];
  const acted = game.companyOperation.turn === game.turn ? game.companyOperation.actedOffices ?? [] : [];
  const next = RIBBON_ORDER.find((officeId) => !acted.includes(officeId));
  return next ? OFFICE_SPOTS[next] : undefined;
}

function PhaseMarker({ ctx }: { ctx: DrawContext }) {
  const spot = activeSpot(ctx.game);
  if (!spot) return null;
  return <circle className="phase-marker" cx={spot.x} cy={spot.y} r={110} />;
}

function Pawn({ point, color, text }: { point: Point; color: string; text?: string }) {
  return (
    <g className="pawn">
      <circle cx={point.x} cy={point.y} r={42} fill={color} stroke="#fffaf0" strokeWidth={8} />
      {text ? <Label x={point.x} y={point.y - 58} text={text} size={44} /> : null}
    </g>
  );
}

function CompanyTracks({ ctx }: { ctx: DrawContext }) {
  const { game } = ctx;
  const standing = STANDING_SPACES[game.company.standing] ?? STANDING_SPACES[0];
  const debt = DEBT_SPACES[Math.min(game.company.debt, DEBT_SPACES.length - 1)];
  const balance = balanceSpace(game.company.balance);
  const powers = powerMarkerPositions(game);
  const session = game.parliament.session;
  const voting = Boolean(session && ["voting", "continueVoting", "resolving"].includes(session.stage));
  const support = game.parliament.voteMarker;

  return (
    <g>
      <Target ctx={ctx} target="track:standing" ring={{ cx: standing.x, cy: standing.y, r: 70 }} label={`Company Standing ${standingLabel(game)}`}>
        <Pawn point={standing} color="#b3202a" />
      </Target>
      <Target ctx={ctx} target="track:debt" ring={{ cx: debt.x, cy: debt.y, r: 70 }} label={`Company Debt ${game.company.debt}`}>
        <Pawn point={debt} color="#b3202a" />
      </Target>
      <Target ctx={ctx} target="track:turn" ring={{ cx: turnSpace(game.turn).x, cy: turnSpace(game.turn).y, r: 64 }} label={`Turn ${game.turn}`}>
        <Pawn point={{ x: turnSpace(game.turn).x + 70, y: turnSpace(game.turn).y }} color="#1d1d1d" />
      </Target>
      <Target ctx={ctx} target="track:balance" ring={{ cx: balance.x, cy: balance.y, r: 64 }} label={`Company Balance £${game.company.balance}`}>
        <Pawn point={{ x: balance.x, y: balance.y - 70 }} color="#b3202a" text={game.company.balance > 40 ? `£${game.company.balance}` : undefined} />
      </Target>
      <Target ctx={ctx} target="track:power" ring={{ x: 780, y: 200, width: 360, height: 430 }} label="Power track">
        {(Object.keys(powers) as Array<keyof typeof powers>).map((target) => {
          const spot = POWER_BOXES[powers[target]];
          return (
            <g key={target}>
              <rect x={spot.x - 78} y={spot.y - 34} width={156} height={68} rx={14} className="power-chip" />
              <Label x={spot.x} y={spot.y + 16} text={POWER_NAMES[target]} size={40} className="chip-text" />
            </g>
          );
        })}
      </Target>
      {voting ? (
        <Target ctx={ctx} target="track:votes" ring={{ cx: voteSpace(support).x, cy: voteSpace(support).y, r: 64 }} label={`Votes ${support}`}>
          <Pawn point={voteSpace(support)} color="#1d1d1d" />
          <Label x={voteSpace(support).x - 70} y={voteSpace(support).y + 16} text={support > 0 ? `+${support}` : `${support}`} size={52} anchor="end" />
        </Target>
      ) : null}
    </g>
  );
}

const POWER_NAMES: Record<string, string> = {
  social: "Social",
  companyShare: "Share",
  shipping: "Shipping",
  manufacturing: "Manuf.",
};

function VictoryPoints({ ctx }: { ctx: DrawContext }) {
  const { game } = ctx;
  const bySpace = new Map<number, PlayerId[]>();
  for (const playerId of game.seatingOrder) {
    const vp = game.players[playerId].victoryPoints;
    const key = vp < 0 ? Math.max(vp, -3) : Math.min(vp, 20);
    bySpace.set(key, [...(bySpace.get(key) ?? []), playerId]);
  }
  return (
    <g>
      {[...bySpace.entries()].map(([space, playerIds]) => {
        const point = victoryPointSpace(space);
        return playerIds.map((playerId, index) => {
          const vp = game.players[playerId].victoryPoints;
          const y = point.y + (space < 0 ? 0 : 70 + index * 64);
          const x = space < 0 ? point.x + 70 + index * 64 : point.x;
          return (
            <Target key={playerId} ctx={ctx} target={`player:${playerId}`} ring={{ cx: x, cy: y, r: 34 }} label={`${game.players[playerId].name}: ${vp} VP`}>
              <Piece x={x} y={y} color={ctx.colors[playerId]} text={vp > 20 ? String(vp) : playerInitials(game, playerId)} r={30} />
            </Target>
          );
        });
      })}
    </g>
  );
}

function PrizeBoxes({ ctx }: { ctx: DrawContext }) {
  const { game } = ctx;
  return (
    <g>
      {Object.entries(PRIZE_BOXES).map(([prizeId, area]) => {
        const counts = game.seatingOrder.map((playerId) => [playerId, game.players[playerId].familyMembers.prizes[prizeId] ?? 0] as [PlayerId, number]);
        const inner = { x: area.x + 20, y: area.y + area.height * 0.55, width: area.width - 40, height: area.height * 0.42 };
        return (
          <Target key={prizeId} ctx={ctx} target={`prize:${prizeId}`} ring={area} label={`Prize ${prizeId}`}>
            {playerStacks(ctx, inner, counts, 160, 40)}
          </Target>
        );
      })}
    </g>
  );
}

function LondonDisplay({ ctx }: { ctx: DrawContext }) {
  const display = ctx.game.londonSeason.display;
  const slotWidth = LONDON_DISPLAY_BOX.width / 3;
  return (
    <g>
      {[0, 1, 2].map((slot) => {
        const cardId = display[slot];
        const x = LONDON_DISPLAY_BOX.x + slotWidth * slot + 40;
        const area = { x, y: LONDON_DISPLAY_BOX.y + 70, width: slotWidth - 80, height: LONDON_DISPLAY_BOX.height - 130 };
        const blackmail = cardId ? isBlackmailCard(cardId) : false;
        const title = !cardId ? "Empty" : blackmail ? "Blackmail" : cardName(cardId);
        return (
          <Target key={slot} ctx={ctx} target={`display:${slot}`} ring={area} label={`London Season Display: ${title}`}>
            {cardId ? (
              <g>
                <rect x={area.x} y={area.y} width={area.width} height={area.height} rx={22} className={blackmail ? "card-back" : "card-face"} />
                <WrappedText x={area.x + area.width / 2} y={area.y + area.height / 2 - 20} text={title} size={58} width={area.width - 40} />
                {blackmail ? <Label x={area.x + area.width / 2} y={area.y + area.height - 40} text="face down" size={40} /> : null}
              </g>
            ) : null}
          </Target>
        );
      })}
    </g>
  );
}

function WrappedText({ x, y, text, size, width }: { x: number; y: number; text: string; size: number; width: number }) {
  const maxChars = Math.max(6, Math.floor(width / (size * 0.55)));
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    const last = lines[lines.length - 1];
    if (last && `${last} ${word}`.length <= maxChars) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return (
    <text x={x} y={y - ((lines.length - 1) * size) / 2} textAnchor="middle" fontSize={size} className="board-label">
      {lines.map((line, index) => (
        <tspan key={index} x={x} dy={index === 0 ? 0 : size * 1.1}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function CourtAndStockExchange({ ctx }: { ctx: DrawContext }) {
  const { game } = ctx;
  const counts = new Map<PlayerId, number>();
  for (const share of game.company.court) if (share.owner) counts.set(share.owner, (counts.get(share.owner) ?? 0) + 1);
  return (
    <g>
      <Target ctx={ctx} target="court" ring={COURT_BOX} label="Court of Directors">
        {playerStacks(ctx, { ...COURT_BOX, y: COURT_BOX.y + 40, height: COURT_BOX.height - 40 }, [...counts.entries()], 150, 42)}
      </Target>
      {game.company.stockExchange.map((slot) => {
        const spot = STOCK_EXCHANGE_SPOTS[slot.id];
        if (!spot) return null;
        return (
          <Target key={slot.id} ctx={ctx} target={`stock:${slot.id}`} ring={{ cx: spot.x, cy: spot.y, r: 62 }} label={`Stock Exchange £${slot.cost}`}>
            {slot.share?.owner ? <Piece x={spot.x} y={spot.y} color={ctx.colors[slot.share.owner]} text={playerInitials(game, slot.share.owner)} r={44} /> : null}
          </Target>
        );
      })}
    </g>
  );
}

function PensionersAndVacancies({ ctx }: { ctx: DrawContext }) {
  const { game } = ctx;
  const pensioners = game.seatingOrder.map((playerId) => [playerId, game.players[playerId].familyMembers.pensioners] as [PlayerId, number]);
  const vacant = game.company.vacantOffices.filter((officeId) => game.company.offices[officeId]?.vacant !== false);
  return (
    <g>
      <Target ctx={ctx} target="pensioners" ring={PENSIONERS_BOX} label="Pensioners">
        {playerStacks(ctx, { ...PENSIONERS_BOX, y: PENSIONERS_BOX.y + 80 }, pensioners, 120, 40)}
      </Target>
      <Target ctx={ctx} target="vacant" ring={VACANT_OFFICES_BOX} label="Vacant Offices">
        {vacant.slice(0, 9).map((officeId, index) => (
          <g key={officeId}>
            <rect x={VACANT_OFFICES_BOX.x + 30} y={VACANT_OFFICES_BOX.y + 90 + index * 84} width={VACANT_OFFICES_BOX.width - 60} height={70} rx={12} className="vacant-card" />
            <Label x={VACANT_OFFICES_BOX.x + VACANT_OFFICES_BOX.width / 2} y={VACANT_OFFICES_BOX.y + 140 + index * 84} text={officeLabel(officeId)} size={40} />
          </g>
        ))}
        {vacant.length > 9 ? <Label x={VACANT_OFFICES_BOX.x + VACANT_OFFICES_BOX.width / 2} y={VACANT_OFFICES_BOX.y + VACANT_OFFICES_BOX.height - 20} text={`+${vacant.length - 9} more`} size={40} /> : null}
      </Target>
    </g>
  );
}

function Offices({ ctx }: { ctx: DrawContext }) {
  const { game } = ctx;
  const chairman = chairmanHolder(game);
  return (
    <g>
      {Object.entries(OFFICE_SPOTS).map(([officeId, spot]) => {
        const office = game.company.offices[officeId];
        if (officeId === "director-of-trade" && game.company.governorGeneralInPlay) return null;
        if (officeId === "governor-general" && !game.company.governorGeneralInPlay) return null;
        if (!office) return null;
        const created = office.created !== false && !game.company.unusedOffices.includes(officeId);
        const holder = officeId === "chairman" ? chairman : !office.vacant ? office.holder : undefined;
        const treasurySpot = TREASURY_SPOTS[officeId];
        const overlayTile = OVERLAY_TILES[officeId];
        return (
          <Target key={officeId} ctx={ctx} target={`office:${officeId}`} ring={{ cx: spot.x, cy: spot.y, r: 80 }} label={officeLabel(officeId)}>
            {overlayTile && created ? (
              <g>
                <rect x={spot.x - 150} y={spot.y + 40} width={300} height={78} rx={18} className="overlay-tile" />
                <Label x={spot.x} y={spot.y + 94} text={overlayTile} size={40} className="overlay-tile-text" />
              </g>
            ) : null}
            {holder ? (
              <Piece x={spot.x + 60} y={spot.y - 60} color={ctx.colors[holder]} text={playerInitials(game, holder)} r={44} />
            ) : created ? (
              <Label x={spot.x} y={spot.y - 92} text="vacant" size={40} className="muted-label" />
            ) : (
              <Label x={spot.x} y={spot.y - 92} text="not open" size={40} className="muted-label" />
            )}
            {office.fatigue > 0 ? <FatigueCubes x={spot.x - 110} y={spot.y - 100} count={office.fatigue} /> : null}
            {treasurySpot ? <Coin x={treasurySpot.x} y={treasurySpot.y} amount={office.treasury} /> : null}
          </Target>
        );
      })}
    </g>
  );
}

/** Offices that enter play with their own overlay tile (rulebook p.3): label drawn under the spot. */
const OVERLAY_TILES: Record<string, string> = {
  "governor-general": "Governor General",
  "superintendent-of-trade-in-china": "China",
};

function FatigueCubes({ x, y, count }: { x: number; y: number; count: number }) {
  return (
    <g>
      {Array.from({ length: Math.min(count, 4) }, (_, index) => (
        <rect key={index} x={x + index * 34} y={y} width={28} height={28} className="fatigue-cube" />
      ))}
      {count > 4 ? <Label x={x + 4 * 34 + 6} y={y + 26} text={`${count}`} size={34} anchor="start" /> : null}
    </g>
  );
}

function Coin({ x, y, amount }: { x: number; y: number; amount: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={56} className="coin" />
      <Label x={x} y={y + 18} text={`£${amount}`} size={50} className="coin-text" />
    </g>
  );
}

function Armies({ ctx }: { ctx: DrawContext }) {
  const { game } = ctx;
  return (
    <g>
      {PRESIDENCIES.map((army) => {
        const state = game.company.armies[army];
        const layout = ARMY_LAYOUT[army];
        const ready = Object.entries(state.officers).map(([playerId, stack]) => [playerId, stack.ready] as [PlayerId, number]);
        const exhausted = Object.entries(state.officers).map(([playerId, stack]) => [playerId, stack.exhausted] as [PlayerId, number]);
        const alliances = Object.entries(state.localAlliances ?? {});
        const ring = { x: layout.active.x - 30, y: layout.active.y - 20, width: 540, height: layout.exhausted.y + layout.exhausted.height - layout.active.y + 40 };
        return (
          <Target key={army} ctx={ctx} target={`army:${army}`} ring={ring} label={`Army of ${army}`}>
            {playerStacks(ctx, { ...layout.active, x: layout.active.x + 110 }, ready, 130, 38)}
            <Regiments x={layout.active.x + 40} y={layout.active.y + 40} count={state.regiments.ready} />
            {playerStacks(ctx, { ...layout.exhausted, x: layout.exhausted.x + 110 }, exhausted, 130, 38, true)}
            <Regiments x={layout.exhausted.x + 40} y={layout.exhausted.y + 40} count={state.regiments.exhausted} faded />
            {state.commander ? (
              <Piece x={layout.commander.x} y={layout.commander.y} color={ctx.colors[state.commander]} text={playerInitials(game, state.commander)} r={48} />
            ) : null}
            {alliances
              .filter(([, status]) => status === "ready")
              .map(([allianceId], index) => (
                <Label key={allianceId} x={layout.active.x + layout.active.width} y={layout.active.y + 50 + index * 50} text={allianceNames.get(allianceId) ?? allianceId} size={40} anchor="end" className="alliance-label" />
              ))}
          </Target>
        );
      })}
    </g>
  );
}

function Regiments({ x, y, count, faded = false }: { x: number; y: number; count: number; faded?: boolean }) {
  if (count <= 0) return null;
  return (
    <g opacity={faded ? 0.55 : 1}>
      <rect x={x - 30} y={y - 30} width={60} height={60} rx={8} className="regiment" />
      <Label x={x} y={y + 16} text={`${count}`} size={44} className="regiment-text" />
    </g>
  );
}

function Presidencies({ ctx }: { ctx: DrawContext }) {
  const { game } = ctx;
  const trainees = game.seatingOrder.map((playerId) => [playerId, game.players[playerId].familyMembers.officersInTraining] as [PlayerId, number]);
  return (
    <g>
      {PRESIDENCIES.map((presidency) => {
        const writers = Object.entries(game.india.presidencies[presidency].writers) as Array<[PlayerId, number]>;
        const area = WRITER_BOXES[presidency];
        return (
          <Target key={presidency} ctx={ctx} target={`presidency:${presidency}`} ring={area} label={`${presidency} writers`}>
            {playerStacks(ctx, area, writers, 135, 38)}
          </Target>
        );
      })}
      <Target ctx={ctx} target="officers-in-training" ring={OFFICERS_IN_TRAINING_BOX} label="Officers-in-Training">
        {playerStacks(ctx, OFFICERS_IN_TRAINING_BOX, trainees, 135, 38)}
      </Target>
    </g>
  );
}

function shipOwner(game: GameState, ship: ShipState): PlayerId | undefined {
  return ship.kind === "player" && ship.shipyardCardId ? shipyardOwner(game, ship.shipyardCardId) : undefined;
}

function Ships({ ctx }: { ctx: DrawContext }) {
  const { game } = ctx;
  return (
    <g>
      {(Object.keys(SEA_ZONE_SPOTS) as Array<keyof typeof SEA_ZONE_SPOTS>).map((zone) => {
        const ships = game.company.ships.filter((ship) => ship.location === zone);
        if (zone === "china" && ships.length === 0 && !game.company.offices["superintendent-of-trade-in-china"]?.created) return null;
        const spot = SEA_ZONE_SPOTS[zone];
        const area = { x: spot.x - 150, y: spot.y - 60, width: 300, height: 220 };
        return (
          <Target key={zone} ctx={ctx} target={`sea:${zone}`} ring={area} label={`${zone} ships`}>
            {zone === "china" ? <Label x={spot.x} y={spot.y - 75} text="China" size={46} /> : null}
            {gridPositions(area, ships.length, 100).map((point, index) => {
              const ship = ships[index];
              const owner = shipOwner(game, ship);
              const color = owner ? ctx.colors[owner] : ship.kind === "company" ? "#7a1f1f" : "#8a8a8a";
              return <ShipGlyph key={ship.id} x={point.x} y={point.y} color={color} fatigued={ship.fatigued} text={owner ? playerInitials(game, owner) : ship.kind === "company" ? "C" : "X"} />;
            })}
          </Target>
        );
      })}
    </g>
  );
}

function ShipGlyph({ x, y, color, fatigued, text }: { x: number; y: number; color: string; fatigued: boolean; text: string }) {
  return (
    <g className={fatigued ? "ship ship-fatigued" : "ship"}>
      <path d={`M ${x - 42} ${y - 8} L ${x + 42} ${y - 8} L ${x + 28} ${y + 28} L ${x - 28} ${y + 28} Z`} fill={color} stroke="#fffaf0" strokeWidth={6} />
      <path d={`M ${x} ${y - 8} L ${x} ${y - 52} L ${x + 30} ${y - 22} Z`} fill="#fffaf0" stroke={color} strokeWidth={4} />
      <Label x={x} y={y + 22} text={text} size={30} className="chip-text" />
    </g>
  );
}

function India({ ctx }: { ctx: DrawContext }) {
  const { game } = ctx;
  return (
    <g>
      {Object.values(game.india.regions).map((region) => {
        const position = regionPositions.get(region.id) ?? { x: 0, y: 0 };
        const spot = GOVERNOR_SPOTS[region.id as keyof typeof GOVERNOR_SPOTS];
        const governor = game.company.offices[region.governorOffice];
        const governorHolder = governor && !governor.vacant ? governor.holder : undefined;
        const flagColor = region.empireFlag ? EMPIRE_COLORS[region.empireFlag] ?? "#cccccc" : undefined;
        return (
          <g key={region.id}>
            <Target ctx={ctx} target={`region:${region.id}`} ring={{ cx: position.x, cy: position.y, r: 95 }} label={region.name}>
              {region.hasDome ? (
                <g>
                  <polygon points={octagon(position.x, position.y, 58)} className="tower-badge" />
                  <Label x={position.x} y={position.y + 22} text={`${region.towerLevels}`} size={64} className="tower-text" />
                </g>
              ) : (
                <Label x={position.x} y={position.y + 16} text={region.companyControlled ? "EIC" : "no dome"} size={42} className="tower-text-dark" />
              )}
              {flagColor ? <Flag x={position.x + 52} y={position.y - 92} color={flagColor} capital={region.isCapital} /> : null}
              {region.unrest > 0 ? (
                <g>
                  {Array.from({ length: Math.min(region.unrest, 5) }, (_, index) => (
                    <rect key={index} x={position.x - 70 + index * 34} y={position.y + 70} width={28} height={28} className="unrest-cube" />
                  ))}
                  {region.unrest > 5 ? <Label x={position.x + 110} y={position.y + 96} text={`${region.unrest}`} size={34} anchor="start" /> : null}
                </g>
              ) : null}
            </Target>
            {spot ? (
              region.companyControlled && game.company.governorGeneralInPlay ? null : region.companyControlled ? (
                // With a Governor General there are no Governors or overlays (p.26): the "EIC" label shows control.
                <Target ctx={ctx} target={`office:${region.governorOffice}`} ring={{ cx: spot.x, cy: spot.y, r: 70 }} label={officeLabel(region.governorOffice)}>
                  <circle cx={spot.x} cy={spot.y} r={58} className="governor-overlay" />
                  {governorHolder ? <Piece x={spot.x} y={spot.y} color={ctx.colors[governorHolder]} text={playerInitials(game, governorHolder)} r={36} /> : <Label x={spot.x} y={spot.y + 14} text="Gov" size={36} className="chip-text" />}
                  {region.partialCompanyShip ? <ShipGlyph x={spot.x + 100} y={spot.y} color="#7a1f1f" fatigued={false} text="½" /> : null}
                </Target>
              ) : region.lootToken.available && region.lootToken.face === "loot" ? (
                <g className="loot-token">
                  <rect x={spot.x - 52} y={spot.y - 34} width={104} height={68} rx={14} />
                  <Label x={spot.x} y={spot.y + 16} text={`£${region.lootToken.value ?? "?"}`} size={44} className="chip-text" />
                </g>
              ) : null
            ) : null}
            {region.orders.map((order) => {
              const fillers = orderFillers(game, order);
              const byFirm = fillers.firms.length > 0;
              const label = `Order ${order.id} (£${order.value})${order.filledThisTurnBy.length > 0 ? `, filled this turn by ${describeFillers(fillers)}` : ""}`;
              return (
                <Target key={order.id} ctx={ctx} target={`order:${order.id}`} ring={{ cx: order.boardPosition.x, cy: order.boardPosition.y, r: 62 }} label={label}>
                  {order.closed ? (
                    <g>
                      <ellipse cx={order.boardPosition.x} cy={order.boardPosition.y} rx={50} ry={64} className="closed-order" />
                      <Label x={order.boardPosition.x} y={order.boardPosition.y + 16} text="closed" size={30} className="chip-text" />
                    </g>
                  ) : order.writer ? (
                    <Piece x={order.boardPosition.x} y={order.boardPosition.y} color={ctx.colors[order.writer.playerId]} text={playerInitials(game, order.writer.playerId)} r={44} />
                  ) : order.filledThisTurnBy.length > 0 ? (
                    <g>
                      <ellipse
                        cx={order.boardPosition.x}
                        cy={order.boardPosition.y}
                        rx={46}
                        ry={58}
                        className={byFirm ? (fillers.company ? "filled-order filled-order-both" : "filled-order filled-order-firm") : "filled-order"}
                      />
                      <Label x={order.boardPosition.x} y={order.boardPosition.y + 14} text={byFirm ? (fillers.company ? "both" : "firm") : "filled"} size={30} />
                    </g>
                  ) : null}
                </Target>
              );
            })}
          </g>
        );
      })}
      <Elephant ctx={ctx} />
    </g>
  );
}

function octagon(x: number, y: number, r: number): string {
  return Array.from({ length: 8 }, (_, index) => {
    const angle = Math.PI / 8 + (index * Math.PI) / 4;
    return `${x + r * Math.cos(angle)},${y + r * Math.sin(angle)}`;
  }).join(" ");
}

function Flag({ x, y, color, capital }: { x: number; y: number; color: string; capital: boolean }) {
  const size = capital ? 1.25 : 0.9;
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`}>
      <line x1={0} y1={0} x2={0} y2={90} stroke="#3a2a1a" strokeWidth={8} />
      <path d="M 0 0 L 70 14 L 0 46 Z" fill={color} stroke="#3a2a1a" strokeWidth={5} />
      {capital ? <Label x={26} y={32} text="★" size={30} className="star" /> : null}
    </g>
  );
}

function Elephant({ ctx }: { ctx: DrawContext }) {
  const { regionId, facing } = ctx.game.india.elephant;
  if (!regionId) return null;
  const from = regionPositions.get(regionId);
  if (!from) return null;
  const to = facing ? regionPositions.get(facing) : undefined;
  const at = to ? { x: from.x + (to.x - from.x) * 0.5, y: from.y + (to.y - from.y) * 0.5 } : { x: from.x + 120, y: from.y - 40 };
  const angle = to ? Math.atan2(to.y - from.y, to.x - from.x) : 0;
  const tip = { x: at.x + Math.cos(angle) * 140, y: at.y + Math.sin(angle) * 140 };
  const label = facing ? `Elephant in ${regionId}, facing ${facing}` : `Elephant in the centre of ${regionId}`;
  return (
    <Target ctx={ctx} target={`region:${regionId}`} ring={{ cx: at.x, cy: at.y, r: 76 }} label={label}>
      {to ? <line x1={at.x} y1={at.y} x2={tip.x} y2={tip.y} className="elephant-arrow" markerEnd="url(#elephant-head)" /> : null}
      <defs>
        <marker id="elephant-head" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#2b2b2b" />
        </marker>
      </defs>
      <circle cx={at.x} cy={at.y} r={62} className="elephant-disc" />
      <text x={at.x} y={at.y + 26} textAnchor="middle" fontSize={72}>
        🐘
      </text>
    </Target>
  );
}
