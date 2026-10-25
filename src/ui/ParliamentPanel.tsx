import { lawsById, policyDial } from "../data";
import type { GameState } from "../engine";
import { deregulationAvailable, deregulationStatus } from "./firm-view";
import { humanize, playerName } from "./view-model";

type Props = {
  game: GameState;
};

/** The Prime Minister dial, the law before Parliament, and every passed law (pp.34-36). */
export function ParliamentPanel({ game }: Props) {
  const { parliament } = game;
  const session = parliament.session;
  const proposal = session?.lawId ? lawsById.get(session.lawId) : undefined;
  const proposedSpace = session?.policySpace;

  return (
    <div className="parliament-panel">
      <dl className="parliament-facts">
        <div>
          <dt>Prime Minister</dt>
          <dd>{playerName(game, parliament.primeMinister)}</dd>
        </div>
        <div>
          <dt>Opposition Leader</dt>
          <dd>{parliament.oppositionLeader ? playerName(game, parliament.oppositionLeader) : "-"}</dd>
        </div>
      </dl>

      {deregulationAvailable(game) || game.parliament.deregulated ? (
        <section className="deregulation-panel" aria-label="Deregulation">
          <h3>Deregulation</h3>
          <p>
            <span className="deregulation-status">{deregulationStatus(game).summary}.</span> {deregulationStatus(game).detail}
          </p>
        </section>
      ) : null}

      {proposal ? (
        <section aria-label="Law before Parliament">
          <h3>Before Parliament</h3>
          <p className="law-name">
            {proposal.name} <span className="law-kind">({proposal.kind})</span>
          </p>
          <p className="law-text">{proposal.text}</p>
          <p>Support: {parliament.voteMarker >= 0 ? `+${parliament.voteMarker}` : parliament.voteMarker}</p>
        </section>
      ) : null}

      <section aria-label="Prime Minister dial">
        <h3>Policy dial</h3>
        <ol className="policy-dial">
          {policyDial.spaces.map((space) => {
            const current = space.index === parliament.policyDialPosition;
            const proposed = space.index === proposedSpace;
            return (
              <li key={space.index} className={current ? "dial-current" : proposed ? "dial-proposed" : undefined}>
                {humanize(space.consequence)} · {humanize(space.target)}
                {current ? " ← arm" : proposed ? " ← proposed" : ""}
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-label="Passed laws">
        <h3>Passed laws</h3>
        {parliament.passedLaws.length === 0 ? <p>None yet.</p> : null}
        <ul className="passed-laws">
          {parliament.passedLaws.map((instance) => {
            const law = lawsById.get(instance.lawId);
            return (
              <li key={instance.id}>
                <strong>{law?.name ?? humanize(instance.lawId)}</strong>
                {law ? <p className="law-text">{law.text}</p> : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
