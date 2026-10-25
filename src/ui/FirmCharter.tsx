import { firmCharter, firmStrategyById, type FirmStrategyId } from "../data";
import {
  firmName,
  firmShareTotal,
  firmShareVictoryPoints,
  firmShips,
  type FirmState,
  type GameState,
  type PlayerId,
} from "../engine";
import { formatVictoryPoints } from "./firm-view";
import { playerName } from "./view-model";

type Props = {
  game: GameState;
  firm: FirmState;
  /** The player who confirmed they hold the device (hotseat) or the viewer's seat (online). */
  revealedPlayer: PlayerId | null;
};

function strategyName(id: string | undefined): string {
  return (id && firmStrategyById.get(id as FirmStrategyId)?.name) || id || "?";
}

/** What the strategy row says. The table sees a strategy only once it is revealed (p.40). */
function strategyRow(game: GameState, firm: FirmState, revealedPlayer: PlayerId | null): string {
  if (firm.trade) return `${strategyName(firm.trade.strategy)} (revealed)`;
  const secret = game.hidden?.firmStrategySecrets?.[firm.id];
  if (secret?.revealed && secret.strategy) return `${strategyName(secret.strategy)} (revealed)`;
  if (!secret) return "not chosen yet";
  if (revealedPlayer === firm.manager && secret.strategy) {
    const bid = secret.bid !== undefined ? `, bid £${secret.bid}` : "";
    return `${strategyName(secret.strategy)}${bid} (secret: only ${playerName(game, firm.manager)} sees this)`;
  }
  return "chosen, secret until its Presidency";
}

/** A firm's charter: treasuries, Value, dividend cube, shares, ships, this turn's trade (pp.37-42). */
export function FirmCharter({ game, firm, revealedPlayer }: Props) {
  const ships = firmShips(game, firm.id);
  const fatigued = ships.filter((ship) => ship.fatigued).length;
  const total = firmShareTotal(firm);
  const holders = Object.entries(firm.shares).filter(([, count]) => count > 0);
  const perShare = formatVictoryPoints(firmShareVictoryPoints(firm.value));
  const trade = firm.trade;

  return (
    <section className="firm-charter" aria-label={`${firmName(game, firm)} charter`}>
      <h4 className="firm-name">{firmName(game, firm)}</h4>
      <dl className="firm-facts">
        <div>
          <dt>London</dt>
          <dd>£{firm.londonTreasury}</dd>
        </div>
        <div>
          <dt>India</dt>
          <dd>£{firm.indiaTreasury}</dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd>
            {firm.value}/{firmCharter.maxValue} ({perShare} VP a share)
          </dd>
        </div>
        <div>
          <dt>Dividend cube</dt>
          <dd>{firm.dividendCube === undefined ? "not placed" : `£${firm.dividendCube}`}</dd>
        </div>
        <div>
          <dt>Ships</dt>
          <dd>
            {ships.length}
            {fatigued > 0 ? ` (${fatigued} fatigued)` : ""}
          </dd>
        </div>
        <div>
          <dt>Trade bid</dt>
          <dd>{firm.tradeBid === undefined ? "none yet" : `£${firm.tradeBid}`}</dd>
        </div>
      </dl>
      <p className="dashboard-line">
        Shares {total}/{firmCharter.maxShares}:{" "}
        {holders.length > 0 ? holders.map(([playerId, count]) => `${playerName(game, playerId)} ${count}`).join(", ") : "none"}
      </p>
      <p className="dashboard-line">Strategy: {strategyRow(game, firm, revealedPlayer)}</p>
      {trade ? (
        <p className="dashboard-line">
          Trade: {trade.dice} {trade.dice === 1 ? "die" : "dice"}, {trade.successes} {trade.successes === 1 ? "success" : "successes"}
          {trade.initiative !== undefined ? `, initiative ${trade.initiative}` : ", no initiative"}, income £{trade.income}
        </p>
      ) : null}
    </section>
  );
}
