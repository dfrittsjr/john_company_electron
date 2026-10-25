import type { ReactNode } from "react";
import { localAlliances, policyDial, prestigeCards, prizes } from "../data";
import {
  chairmanHolder,
  companyExpectations,
  officeHolder,
  powerMarkerPositions,
  powerTrackValue,
  presidentOf,
  shipyardOwner,
  standingLabel,
  type GameState,
  type PresidencyId,
} from "../engine";
import { describeFillers, orderFillers } from "./firm-view";
import { cardName, humanize, isBlackmailCard, officeLabel, playerName } from "./view-model";

type Props = {
  game: GameState;
  target: string;
  /** How many of the current decision's options refer to this element. */
  optionCount: number;
  onClose: () => void;
};

const prizeById = new Map(prizes.map((prize) => [prize.id, prize]));
const allianceById = new Map(localAlliances.map((alliance) => [alliance.id, alliance]));
const prestigeById = new Map(prestigeCards.map((card) => [card.id, card]));

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="facts">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function perPlayer(game: GameState, counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([playerId, count]) => `${playerName(game, playerId)} ${count}`);
  return parts.length > 0 ? parts.join(", ") : "none";
}

function details(game: GameState, target: string): { title: string; body: ReactNode } {
  const [kind, id = ""] = target.split(/:(.*)/s);

  switch (kind) {
    case "order": {
      const region = Object.values(game.india.regions).find((candidate) => candidate.orders.some((order) => order.id === id));
      const order = region?.orders.find((candidate) => candidate.id === id);
      if (!region || !order) break;
      const status = order.closed
        ? "Closed"
        : order.writer
          ? `Filled by a ${playerName(game, order.writer.playerId)} writer (${order.writer.presidency})`
          : order.filledThisTurnBy.length > 0
            ? `Filled this turn by ${describeFillers(orderFillers(game, order))} (filled-order token)`
            : "Open";
      return {
        title: `£${order.value} order in ${region.name}`,
        body: (
          <Facts
            rows={[
              ["Status", status],
              ["Value", `£${order.value} (Deregulation £${order.deregulationValue})`],
              ["Home port", order.isHomePortFor ? `Yes, ${order.isHomePortFor}` : "No"],
              ["Connects to", order.connectedOrderIds.join(", ")],
            ]}
          />
        ),
      };
    }
    case "region": {
      const region = game.india.regions[id];
      if (!region) break;
      const capital = region.empireFlag
        ? Object.values(game.india.regions).find((candidate) => candidate.isCapital && candidate.empireFlag === region.empireFlag)
        : undefined;
      const governor = game.company.offices[region.governorOffice];
      const elephant = game.india.elephant;
      return {
        title: region.name,
        body: (
          <Facts
            rows={[
              ["Strength", region.hasDome ? `${region.towerLevels} tower level${region.towerLevels === 1 ? "" : "s"}` : "No dome"],
              [
                "Empire",
                !region.empireFlag
                  ? region.companyControlled
                    ? "Company-controlled"
                    : "Sovereign"
                  : region.isCapital
                    ? "Capital of an empire"
                    : `Dominated by ${capital?.name ?? "an empire"}`,
              ],
              ["Company control", region.companyControlled ? "Yes" : "No"],
              ["Presidency", region.associatedPresidency ?? (region.homePresidency ? `Home region of ${region.homePresidency}` : "None")],
              [
                "Governor",
                region.companyControlled
                  ? governor && !governor.vacant && governor.holder
                    ? playerName(game, governor.holder)
                    : "Vacant"
                  : "No Governor",
              ],
              ["Unrest", region.unrest],
              [
                "Loot token",
                region.lootToken.face === "loot" && region.lootToken.available ? `£${region.lootToken.value ?? "?"}` : "Taken",
              ],
              ["Export icons", region.exportIcons],
              ["Borders", region.adjacent.map((regionId) => game.india.regions[regionId]?.name ?? regionId).join(", ")],
              [
                "Elephant",
                elephant.regionId === id
                  ? elephant.facing
                    ? `Here, facing ${game.india.regions[elephant.facing]?.name ?? elephant.facing}`
                    : "Here, in the centre"
                  : "Not here",
              ],
            ]}
          />
        ),
      };
    }
    case "office": {
      const office = game.company.offices[id];
      if (!office) break;
      const holder = id === "chairman" ? chairmanHolder(game) : officeHolder(game, id);
      const state = game.company.unusedOffices.includes(id) || office.created === false ? "Not in play" : office.vacant ? "Vacant" : "Filled";
      return {
        title: officeLabel(id),
        body: (
          <Facts
            rows={[
              ["Holder", holder ? playerName(game, holder) : "None"],
              ["Status", state],
              ["Treasury", `£${office.treasury}`],
              ["Fatigue", office.fatigue],
            ]}
          />
        ),
      };
    }
    case "army": {
      const army = game.company.armies[id as PresidencyId];
      if (!army) break;
      const ready: Record<string, number> = {};
      const exhausted: Record<string, number> = {};
      for (const [playerId, stack] of Object.entries(army.officers)) {
        ready[playerId] = stack.ready;
        exhausted[playerId] = stack.exhausted;
      }
      const alliances = Object.entries(army.localAlliances ?? {}).map(([allianceId, status]) => {
        const alliance = allianceById.get(allianceId);
        return `${alliance?.name ?? allianceId} (${status}, strength ${alliance?.strength ?? "?"}, £${alliance?.cost ?? "?"})`;
      });
      return {
        title: `Army of ${id}`,
        body: (
          <Facts
            rows={[
              ["Commander", army.commander ? playerName(game, army.commander) : "Vacant"],
              ["Officers ready", perPlayer(game, ready)],
              ["Officers exhausted", perPlayer(game, exhausted)],
              ["Regiments", `${army.regiments.ready} ready, ${army.regiments.exhausted} exhausted`],
              ["Local alliances", alliances.length > 0 ? alliances.join("; ") : "None"],
            ]}
          />
        ),
      };
    }
    case "presidency": {
      const presidency = game.india.presidencies[id as PresidencyId];
      if (!presidency) break;
      const president = presidentOf(game, id as PresidencyId);
      const office = game.company.offices[`president-${id.toLowerCase()}`];
      const regions = Object.values(game.india.regions)
        .filter((region) => region.associatedPresidency === id)
        .map((region) => region.name);
      return {
        title: `Presidency of ${id}`,
        body: (
          <Facts
            rows={[
              ["President", president ? playerName(game, president) : "Vacant"],
              ["Treasury", `£${office?.treasury ?? 0}`],
              ["Writers", perPlayer(game, presidency.writers)],
              ["Sea zone", humanize(presidency.seaZone)],
              ["Associated regions", regions.length > 0 ? regions.join(", ") : "None yet"],
            ]}
          />
        ),
      };
    }
    case "sea": {
      const ships = game.company.ships.filter((ship) => ship.location === id);
      return {
        title: id === "china" ? "Trade in China" : `${humanize(id)} sea zone`,
        body: ships.length === 0 ? (
          <p>No ships.</p>
        ) : (
          <ul className="details-list">
            {ships.map((ship) => {
              const owner = ship.shipyardCardId ? shipyardOwner(game, ship.shipyardCardId) : undefined;
              const kind = ship.kind === "player" ? `${playerName(game, owner)}'s ship` : ship.kind === "company" ? "Company ship" : "Extra (leased) ship";
              return (
                <li key={ship.id}>
                  {kind}
                  {ship.shipyardCardId ? ` (${ship.shipyardCardId})` : ""}
                  {ship.fatigued ? ", fatigued" : ""}
                </li>
              );
            })}
          </ul>
        ),
      };
    }
    case "prize": {
      const prize = prizeById.get(id);
      if (!prize) break;
      const counts = Object.fromEntries(game.seatingOrder.map((playerId) => [playerId, game.players[playerId].familyMembers.prizes[id] ?? 0]));
      return {
        title: `£${prize.cost} prize`,
        body: (
          <Facts
            rows={[
              ["Cost", `£${prize.cost}`],
              ["Upkeep", `£${prize.upkeep}`],
              ["Victory points", prize.victoryPoints],
              ["Window icons", prize.windowTaxIcons],
              ["Retired here", perPlayer(game, counts)],
            ]}
          />
        ),
      };
    }
    case "stock": {
      const slot = game.company.stockExchange.find((candidate) => candidate.id === id);
      if (!slot) break;
      return {
        title: `Stock Exchange £${slot.cost}`,
        body: <p>{slot.share?.owner ? `${playerName(game, slot.share.owner)} is waiting to become a Company share.` : "Empty."}</p>,
      };
    }
    case "display": {
      const cardId = game.londonSeason.display[Number(id)];
      if (!cardId) return { title: "London Season Display", body: <p>Empty slot.</p> };
      if (isBlackmailCard(cardId)) {
        return { title: "Blackmail card", body: <p>Face down. A player choosing from the display may peek at it.</p> };
      }
      const card = prestigeById.get(cardId);
      return {
        title: cardName(cardId),
        body: (
          <>
            <Facts
              rows={[
                ["Type", card?.prestigeType === "spouse" ? "Spouse" : `Enterprise (${card?.enterpriseType ?? "-"})`],
                ["Victory points", card?.victoryPoints ?? 0],
                ["Power", card?.power ?? 0],
                ["Retirement discount", card?.retirementDiscount ? `£${card.retirementDiscount}` : "None"],
              ]}
            />
            {card?.text ? <p className="card-text">{card.text}</p> : null}
          </>
        ),
      };
    }
    case "court": {
      const counts: Record<string, number> = {};
      for (const share of game.company.court) if (share.owner) counts[share.owner] = (counts[share.owner] ?? 0) + 1;
      const chairman = chairmanHolder(game);
      return {
        title: "Court of Directors",
        body: (
          <Facts
            rows={[
              ["Company shares", perPlayer(game, counts)],
              ["Chairman", chairman ? `${playerName(game, chairman)} (also a share)` : "Vacant"],
            ]}
          />
        ),
      };
    }
    case "pensioners": {
      const counts = Object.fromEntries(game.seatingOrder.map((playerId) => [playerId, game.players[playerId].familyMembers.pensioners]));
      return { title: "Pensioners", body: <p>{perPlayer(game, counts)}</p> };
    }
    case "vacant":
      return {
        title: "Vacant Offices",
        body: <p>{game.company.vacantOffices.length > 0 ? game.company.vacantOffices.map(officeLabel).join(", ") : "None"}</p>,
      };
    case "officers-in-training": {
      const counts = Object.fromEntries(game.seatingOrder.map((playerId) => [playerId, game.players[playerId].familyMembers.officersInTraining]));
      return { title: "Officers-in-Training", body: <p>{perPlayer(game, counts)}</p> };
    }
    case "track": {
      if (id === "standing") {
        return {
          title: "Company Standing",
          body: <Facts rows={[["Standing", standingLabel(game)], ["Expectations", companyExpectations(game) === null ? "-" : `£${companyExpectations(game)}`]]} />,
        };
      }
      if (id === "debt") return { title: "Company Debt", body: <p>Debt {game.company.debt} of 8.</p> };
      if (id === "turn") return { title: "Turn", body: <p>Turn {game.turn}. The game ends after turn {game.finalTurn}.</p> };
      if (id === "balance") return { title: "Company Balance", body: <p>£{game.company.balance}</p> };
      if (id === "votes") return { title: "Votes", body: <p>Support for the current law: {game.parliament.voteMarker}. It passes at 0 or more.</p> };
      if (id === "power") {
        const positions = powerMarkerPositions(game);
        const space = policyDial.spaces[game.parliament.policyDialPosition];
        return {
          title: "Power track and policy",
          body: (
            <Facts
              rows={[
                ...(Object.keys(positions) as Array<keyof typeof positions>).map(
                  (marker) => [humanize(marker), `${powerTrackValue(game, marker)} power`] as [string, ReactNode],
                ),
                ["Policy dial", space ? `${humanize(space.consequence)}: ${humanize(space.target)}` : "-"],
                ["Prime Minister", playerName(game, game.parliament.primeMinister)],
              ]}
            />
          ),
        };
      }
      break;
    }
    case "player": {
      const player = game.players[id];
      if (!player) break;
      return { title: player.name, body: <p>{player.victoryPoints} victory points, £{player.cash} cash.</p> };
    }
    default:
      break;
  }

  return { title: humanize(target), body: <p>No details.</p> };
}

export function DetailsPanel({ game, target, optionCount, onClose }: Props) {
  const { title, body } = details(game, target);
  return (
    <section className="details-panel" aria-label="Selected board element">
      <header>
        <h3>{title}</h3>
        <button type="button" className="plain-button" onClick={onClose} aria-label="Close details">
          ✕
        </button>
      </header>
      {body}
      {optionCount > 0 ? (
        <p className="status-note">
          {optionCount} of the current options {optionCount === 1 ? "refers" : "refer"} to this. They are listed in the
          decision panel.
        </p>
      ) : null}
    </section>
  );
}
