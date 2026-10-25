import { useState } from "react";
import { prestigeCards, prizes } from "../data";
import {
  blackmailCardName,
  blackmailPlayChoices,
  promiseCallOptions,
  promiseCardsHeldBy,
  promiseCardText,
  type GameState,
  type PlayerId,
  type TransferItem,
} from "../engine";
import { enterpriseName } from "./view-model";

// Anytime actions (rulebook p.8): transfers, deals, promise cards, and blackmail.
// Private cards are shown only after the chosen player confirms they have the device.

type Props = {
  game: GameState;
  revealedPlayer: PlayerId | null;
  onReveal: (playerId: PlayerId | null) => void;
  onCommand: (actorId: PlayerId, type: string, payload: unknown) => void;
  /** Online: the form always acts as this player, with no device hand-over step. */
  fixedPlayer?: PlayerId;
};

const prestigeById = new Map(prestigeCards.map((card) => [card.id, card]));

type Selection = Record<string, boolean>;

function selected(selection: Selection): string[] {
  return Object.entries(selection)
    .filter(([, on]) => on)
    .map(([key]) => key);
}

/** Things a player could hand over, keyed so the form can toggle them. */
function transferableAssets(game: GameState, playerId: PlayerId, showIdentities: boolean) {
  const player = game.players[playerId];
  const assets: Array<{ key: string; label: string; item: TransferItem }> = [];

  for (const enterprise of player.enterprises) {
    assets.push({ key: `enterprise:${enterprise.id}`, label: enterpriseName(enterprise.cardId, enterprise.type), item: { kind: "enterprise", enterpriseId: enterprise.id } });
  }
  for (const card of player.prestigeCards) {
    const definition = prestigeById.get(card.cardId);
    if (definition?.transferable) {
      assets.push({ key: `prestige:${card.id}`, label: definition.name, item: { kind: "prestige", cardInstanceId: card.id } });
    }
  }
  player.blackmailCards
    .filter((card) => card.facedown)
    .forEach((card, index) => {
      assets.push({
        key: `blackmail:${card.id}`,
        label: showIdentities ? `Blackmail: ${blackmailCardName(card.cardId)}` : `Face-down blackmail ${index + 1}`,
        item: { kind: "blackmail", cardInstanceId: card.id },
      });
    });
  for (const share of game.company.court.filter((candidate) => candidate.owner === playerId)) {
    assets.push({ key: `share:${share.id}`, label: "Company share", item: { kind: "share", shareId: share.id } });
  }
  for (const card of promiseCardsHeldBy(game, playerId)) {
    assets.push({
      key: `promise:${card.id}`,
      label: `Promise: ${game.players[card.guarantor]?.name}'s "${promiseCardText(card.type)}"`,
      item: { kind: "promise", promiseId: card.id },
    });
  }

  return assets;
}

function buildItems(
  game: GameState,
  owner: PlayerId,
  receiver: PlayerId,
  cash: number,
  selection: Selection,
  prizeForShares: string,
): TransferItem[] {
  const assets = transferableAssets(game, owner, false);
  const items: TransferItem[] = cash > 0 ? [{ kind: "cash", amount: cash }] : [];
  let supply = game.players[receiver].familyMembers.supply;

  for (const key of selected(selection)) {
    const asset = assets.find((candidate) => candidate.key === key);
    if (!asset) continue;
    if (asset.item.kind === "share" && supply <= 0 && prizeForShares) {
      items.push({ ...asset.item, fromPrizeId: prizeForShares });
    } else {
      if (asset.item.kind === "share") supply -= 1;
      items.push(asset.item);
    }
  }

  return items;
}

export function NegotiationPanel({ game, revealedPlayer, onReveal, onCommand, fixedPlayer }: Props) {
  const players = game.seatingOrder.filter((playerId) => !game.players[playerId].isCrown);
  const [chosen, setChosen] = useState<PlayerId>(fixedPlayer ?? players[0]);
  const [partner, setPartner] = useState<PlayerId>(players[1] ?? players[0]);
  const [giveCash, setGiveCash] = useState(0);
  const [askCash, setAskCash] = useState(0);
  const [giveSelection, setGiveSelection] = useState<Selection>({});
  const [askSelection, setAskSelection] = useState<Selection>({});
  const [callSelection, setCallSelection] = useState<Selection>({});
  const [prizeForShares, setPrizeForShares] = useState("");

  if (revealedPlayer === null || revealedPlayer !== chosen) {
    return (
      <section className="negotiation-panel">
        <h2>Deals &amp; Cards</h2>
        <label className="field">
          <span>Act as</span>
          <select value={chosen} onChange={(event) => setChosen(event.target.value)}>
            {players.map((playerId) => (
              <option key={playerId} value={playerId}>
                {game.players[playerId].name}
              </option>
            ))}
          </select>
        </label>
        <p className="status-note">
          Pass the device to {game.players[chosen]?.name}. Their face-down blackmail stays hidden until they reveal it.
        </p>
        <button type="button" onClick={() => onReveal(chosen)}>
          I am {game.players[chosen]?.name}: reveal
        </button>
      </section>
    );
  }

  const me = revealedPlayer;
  const player = game.players[me];
  const others = players.filter((playerId) => playerId !== me);
  const counterpart = others.includes(partner) ? partner : others[0];
  const myAssets = transferableAssets(game, me, true);
  const theirAssets = counterpart ? transferableAssets(game, counterpart, false) : [];
  const callOptions = promiseCallOptions(game, me);
  const blackmail = blackmailPlayChoices(game, me);
  const played = player.blackmailCards.filter((card) => !card.facedown);
  const sharesSelected = selected(giveSelection).some((key) => key.startsWith("share:"));
  const needsPrize = counterpart && sharesSelected && game.players[counterpart].familyMembers.supply === 0;

  const resetForms = () => {
    setGiveCash(0);
    setAskCash(0);
    setGiveSelection({});
    setAskSelection({});
    setCallSelection({});
  };

  const give = () => {
    if (!counterpart) return;
    onCommand(me, "negotiation.give", { to: counterpart, items: buildItems(game, me, counterpart, giveCash, giveSelection, prizeForShares) });
    resetForms();
  };

  const proposeDeal = () => {
    if (!counterpart) return;
    onCommand(me, "negotiation.proposeTrade", {
      to: counterpart,
      give: buildItems(game, me, counterpart, giveCash, giveSelection, prizeForShares),
      receive: buildItems(game, counterpart, me, askCash, askSelection, ""),
    });
    resetForms();
  };

  const callIn = () => {
    const calls = selected(callSelection).map((key) => {
      const option = callOptions[Number(key)];
      return { promiseId: option.promiseId, option: option.option };
    });
    onCommand(me, "negotiation.callInPromises", { calls });
    setCallSelection({});
  };

  return (
    <section className="negotiation-panel">
      <div className="negotiation-heading">
        <h2>Deals &amp; Cards: {player.name}</h2>
        {fixedPlayer ? null : (
          <button type="button" className="plain-button" onClick={() => onReveal(null)}>
            Hide
          </button>
        )}
      </div>
      <p className="status-note">
        £{player.cash} · {player.enterprises.length} enterprise(s) ·{" "}
        {game.company.court.filter((share) => share.owner === me).length} Court share(s)
      </p>

      <h3>Your blackmail</h3>
      {blackmail.length === 0 && played.length === 0 ? <p className="status-note">None.</p> : null}
      <ul className="negotiation-list">
        {blackmail.map((card) => (
          <li key={card.cardInstanceId}>
            <strong>{card.name}</strong> (face down)
            {card.unavailableReason ? (
              <small>{card.unavailableReason}</small>
            ) : (
              <span className="negotiation-options">
                {card.options.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() =>
                      onCommand(me, "negotiation.playBlackmail", { cardInstanceId: card.cardInstanceId, params: option.params })
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </span>
            )}
          </li>
        ))}
        {played.map((card) => (
          <li key={card.id}>
            {blackmailCardName(card.cardId)} (played, face up)
          </li>
        ))}
      </ul>

      <h3>Promises you can call in</h3>
      {callOptions.length === 0 ? (
        <p className="status-note">None right now.</p>
      ) : (
        <>
          <ul className="negotiation-list">
            {callOptions.map((option, index) => (
              <li key={`${option.promiseId}-${index}`}>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(callSelection[index])}
                    onChange={(event) => setCallSelection({ ...callSelection, [index]: event.target.checked })}
                  />{" "}
                  {option.label}
                </label>
              </li>
            ))}
          </ul>
          <button type="button" disabled={selected(callSelection).length === 0} onClick={callIn}>
            Call in selected
          </button>
        </>
      )}

      {counterpart ? (
        <>
          <h3>Give or trade</h3>
          <label className="field">
            <span>With</span>
            <select value={counterpart} onChange={(event) => setPartner(event.target.value)}>
              {others.map((playerId) => (
                <option key={playerId} value={playerId}>
                  {game.players[playerId].name}
                </option>
              ))}
            </select>
          </label>

          <div className="negotiation-columns">
            <fieldset>
              <legend>You give</legend>
              <label className="field">
                <span>Cash (£)</span>
                <input
                  type="number"
                  min={0}
                  max={player.cash}
                  value={giveCash}
                  onChange={(event) => setGiveCash(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
                />
              </label>
              {myAssets.map((asset) => (
                <label key={asset.key} className="negotiation-check">
                  <input
                    type="checkbox"
                    checked={Boolean(giveSelection[asset.key])}
                    onChange={(event) => setGiveSelection({ ...giveSelection, [asset.key]: event.target.checked })}
                  />{" "}
                  {asset.label}
                </label>
              ))}
              {needsPrize ? (
                <label className="field">
                  <span>{game.players[counterpart].name} has no supply: take their piece from</span>
                  <select value={prizeForShares} onChange={(event) => setPrizeForShares(event.target.value)}>
                    <option value="">Choose a prize</option>
                    {prizes
                      .filter((prize) => (game.players[counterpart].familyMembers.prizes[prize.id] ?? 0) > 0)
                      .map((prize) => (
                        <option key={prize.id} value={prize.id}>
                          £{prize.cost} prize (−{prize.victoryPoints} VP)
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
            </fieldset>

            <fieldset>
              <legend>You ask for (deals only)</legend>
              <label className="field">
                <span>Cash (£)</span>
                <input
                  type="number"
                  min={0}
                  value={askCash}
                  onChange={(event) => setAskCash(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
                />
              </label>
              {theirAssets.map((asset) => (
                <label key={asset.key} className="negotiation-check">
                  <input
                    type="checkbox"
                    checked={Boolean(askSelection[asset.key])}
                    onChange={(event) => setAskSelection({ ...askSelection, [asset.key]: event.target.checked })}
                  />{" "}
                  {asset.label}
                </label>
              ))}
            </fieldset>
          </div>

          <div className="negotiation-actions">
            <button type="button" onClick={give} title="Hand these over now. Gifts are binding (p.8).">
              Give now
            </button>
            <button
              type="button"
              onClick={proposeDeal}
              disabled={game.negotiation.interrupts.length > 0}
              title={
                game.negotiation.interrupts.length > 0
                  ? "Another player's response is pending."
                  : `${game.players[counterpart].name} must accept before anything moves.`
              }
            >
              Propose deal
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
