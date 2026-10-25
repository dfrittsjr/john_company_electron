import { enterpriseDecks, prestigeCards } from "../data";
import { isHiddenId } from "../online/protocol";
import {
  blackmailCardName,
  allFirms,
  familyPieceLocations,
  firmManagedBy,
  firmName,
  firmShareVictoryPoints,
  playerOffices,
  playerWindowIcons,
  promiseCardsHeldBy,
  type GameState,
  type PlayerId,
} from "../engine";
import { FirmCharter } from "./FirmCharter";
import { formatVictoryPoints } from "./firm-view";
import { officeLabel, playerColors } from "./view-model";

type Props = {
  game: GameState;
  /** The player who confirmed they hold the device; only they see their face-down blackmail. */
  revealedPlayer: PlayerId | null;
  onSelectPlayer?: (playerId: PlayerId) => void;
};

const enterpriseNames = new Map(
  enterpriseDecks.flatMap((deck) => deck.cards.map((card) => [card.id, card.label] as const)),
);
const prestigeById = new Map(prestigeCards.map((card) => [card.id, card]));

const LOCATION_LABELS: Record<string, string> = {
  supply: "Supply",
  pensioners: "Pensioners",
  prizes: "Prizes",
  officersInTraining: "Officers-in-training",
  debtorPrison: "Debtor's Prison",
  offices: "Offices",
  court: "Court shares",
  stockExchange: "Stock Exchange",
  writers: "Writers",
  writersOnOrders: "Writers on orders",
  officers: "Officers",
  commanders: "Commanders",
  firmShares: "Firm shares",
};

export function PlayerDashboards({ game, revealedPlayer, onSelectPlayer }: Props) {
  const colors = playerColors(game);
  const actor = game.pendingDecision.actor;

  return (
    <div className="dashboards">
      {game.seatingOrder.map((playerId) => {
        const player = game.players[playerId];
        const locations = Object.entries(familyPieceLocations(game, playerId)).filter(([, count]) => count > 0);
        const offices = playerOffices(game, playerId);
        const enterprises = player.enterprises.map(
          (enterprise) => `${enterpriseNames.get(enterprise.cardId ?? "") ?? enterprise.type}${enterprise.invested ? " (invested in a firm)" : ""}`,
        );
        const managed = firmManagedBy(game, playerId);
        const heldShares = allFirms(game).filter((firm) => (firm.shares[playerId] ?? 0) > 0);
        const inPrison = player.familyMembers.debtorPrison;
        const prestige = player.prestigeCards.map((card) => prestigeById.get(card.cardId));
        const faceDown = player.blackmailCards.filter((card) => card.facedown);
        const played = player.blackmailCards.filter((card) => !card.facedown);
        const promises = promiseCardsHeldBy(game, playerId);
        const mine = revealedPlayer === playerId;

        return (
          <article
            key={playerId}
            className={`dashboard-card ${actor === playerId ? "dashboard-card-active" : ""}`}
            aria-label={`${player.name} dashboard`}
          >
            <header>
              <span className="swatch" style={{ backgroundColor: colors[playerId] }} aria-hidden="true" />
              <button type="button" className="link-button dashboard-name" onClick={() => onSelectPlayer?.(playerId)}>
                {player.name}
              </button>
              {actor === playerId ? <span className="badge">to act</span> : null}
            </header>
            <dl className="dashboard-stats">
              <div>
                <dt>Cash</dt>
                <dd>£{player.cash}</dd>
              </div>
              <div>
                <dt>VP</dt>
                <dd>{player.victoryPoints}</dd>
              </div>
              <div>
                <dt>Windows</dt>
                <dd>{playerWindowIcons(game, playerId)}</dd>
              </div>
              <div>
                <dt>Trophies</dt>
                <dd>{player.trophies}</dd>
              </div>
              <div>
                <dt>Law tokens</dt>
                <dd>{player.passedLawTokens}</dd>
              </div>
            </dl>
            {managed ? <FirmCharter game={game} firm={managed} revealedPlayer={revealedPlayer} /> : null}
            {heldShares.length > 0 ? (
              <p className="dashboard-line">
                Firm shares:{" "}
                {heldShares
                  .map((firm) => {
                    const count = firm.shares[playerId];
                    const points = firmShareVictoryPoints(firm.value) * count;
                    return `${firmName(game, firm)} ${count} (${formatVictoryPoints(points)} VP now)`;
                  })
                  .join(", ")}
              </p>
            ) : null}
            {inPrison > 0 ? (
              <p className="dashboard-line">
                Debtor&rsquo;s Prison: {inPrison} ({-inPrison} VP at the end)
              </p>
            ) : null}
            {offices.length > 0 ? <p className="dashboard-line">Offices: {offices.map(officeLabel).join(", ")}</p> : null}
            <p className="dashboard-line">
              Pieces: {locations.map(([location, count]) => `${LOCATION_LABELS[location] ?? location} ${count}`).join(" · ")}
            </p>
            {enterprises.length > 0 ? <p className="dashboard-line">Enterprises: {enterprises.join(", ")}</p> : null}
            {prestige.length > 0 ? (
              <p className="dashboard-line">
                Prestige:{" "}
                {prestige
                  .map((card) => (card ? `${card.name}${card.prestigeType === "spouse" ? " (spouse)" : ""}` : "?"))
                  .join(", ")}
              </p>
            ) : null}
            {faceDown.length > 0 || played.length > 0 ? (
              <p className="dashboard-line">
                Blackmail:{" "}
                {[
                  ...faceDown.map((card) => (mine && !isHiddenId(card.cardId) ? `${blackmailCardName(card.cardId)} (face down)` : "face-down blackmail")),
                  ...played.map((card) => `${blackmailCardName(card.cardId)} (played)`),
                ].join(", ")}
              </p>
            ) : null}
            <p className="dashboard-line">Promise cards held: {promises.length}</p>
            {player.opportunityMarker !== "supply" ? (
              <p className="dashboard-line">Opportunity marker: {player.opportunityMarker}</p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
