import { CROWN_CLIMATES } from "../data";
import { crownHandbook, type CrownFavor, type CrownHandbookPage, type CrownHandbookSection } from "../data/crown-handbook";
import { CrownIcon, CrownRichText } from "./CrownIcons";

// The Crown Handbook (solo and two-player games) as part of the rules reference.

export const HANDBOOK_ID_PREFIX = "crown-handbook-";

export type HandbookEntry = { id: string; title: string; page: number };

function plain(text: string): string {
  return text.replace(/\{([a-z-]+)\}/g, "$1");
}

function sectionText(section: CrownHandbookSection): string {
  return [
    section.title,
    section.subtitle,
    section.text,
    ...(section.favors ?? []).map((favor) => favor.text),
    ...(section.tables ?? []).flatMap((table) => [table.caption, ...table.columns, ...table.rows.flat()]),
    ...(section.notes ?? []),
  ]
    .filter(Boolean)
    .map((part) => plain(String(part)))
    .join("\n")
    .toLowerCase();
}

function pageTitle(page: CrownHandbookPage): string {
  return `Handbook p.${page.page}: ${page.sections.map((section) => section.title).join(", ")}`;
}

/** The Handbook pages that mention every term of the search (all of them for an empty search). */
export function handbookEntries(terms: string[]): HandbookEntry[] {
  return crownHandbook
    .filter((page) => {
      if (terms.length === 0) return true;
      const haystack = `${pageTitle(page)}\n${page.sections.map(sectionText).join("\n")}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .map((page) => ({ id: `${HANDBOOK_ID_PREFIX}${page.page}`, title: pageTitle(page), page: page.page }));
}

function Cost({ cost }: { cost: string }) {
  const trimmed = cost.trim();
  const className = trimmed.startsWith("+") ? "cube-cost cube-cost-gain" : trimmed.startsWith("-") || trimmed.startsWith("−") ? "cube-cost cube-cost-pay" : "cube-cost";
  return (
    <span className={className}>
      <span className="promise-cube" aria-hidden="true" />
      {trimmed === "—" ? "—" : trimmed.replace(/^-/, "−")}
    </span>
  );
}

function FavorRow({ favor }: { favor: CrownFavor }) {
  const cost = favor.cost;
  return (
    <li className={favor.mandatory ? "handbook-favor handbook-favor-mandatory" : "handbook-favor"}>
      <span className="handbook-favor-cost">
        {typeof cost === "string" ? (
          <Cost cost={cost} />
        ) : (
          <span className="handbook-favor-climates">
            {CROWN_CLIMATES.map((climate) => (
              <span key={climate} className="handbook-climate-cost">
                <CrownIcon name={climate} />
                <Cost cost={cost[climate]} />
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="handbook-favor-text">
        {favor.mandatory ? <strong className="rules-badge">Always applies</strong> : null}
        {favor.mode ? <strong className="rules-badge">{favor.mode === "solo" ? "Solo only" : "Two players only"}</strong> : null}
        <CrownRichText text={favor.text} />
      </span>
    </li>
  );
}

function Section({ section }: { section: CrownHandbookSection }) {
  return (
    <section className="handbook-section">
      <h4>
        {section.title}
        {section.subtitle ? <small> / {section.subtitle}</small> : null}
      </h4>
      {section.text
        ? section.text.split(/\n{2,}/).map((paragraph, index) => (
            <p key={index}>
              <CrownRichText text={paragraph} />
            </p>
          ))
        : null}
      {(section.tables ?? []).map((table, index) => (
        <table key={index} className="handbook-table">
          {table.caption ? <caption>{table.caption}</caption> : null}
          <thead>
            <tr>
              {table.columns.map((column, columnIndex) => (
                <th key={columnIndex} scope="col">
                  <CrownRichText text={column} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>
                    <CrownRichText text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      {section.favors && section.favors.length > 0 ? (
        <>
          <h5>Favors</h5>
          <ul className="handbook-favors">
            {section.favors.map((favor, index) => (
              <FavorRow key={index} favor={favor} />
            ))}
          </ul>
        </>
      ) : null}
      {(section.notes ?? []).map((note, index) => (
        <p key={index} className="handbook-note">
          <CrownRichText text={note} />
        </p>
      ))}
    </section>
  );
}

export function HandbookPage({ page }: { page: number }) {
  const found = crownHandbook.find((candidate) => candidate.page === page);
  if (!found) return null;
  return (
    <article aria-labelledby="rules-section-title">
      <h3 id="rules-section-title">Crown Handbook, page {found.page}</h3>
      <p className="rules-pages">For solo and two-player games. Favors cost promise cubes: red to pay the Crown, blue to gain from it (rulebook p.46).</p>
      {found.sections.map((section, index) => (
        <Section key={index} section={section} />
      ))}
    </article>
  );
}
