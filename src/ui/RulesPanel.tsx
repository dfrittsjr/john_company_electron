import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  RULES_ATTRIBUTION,
  figureCaption,
  highlightParts,
  rulesSections,
  searchRuleSections,
  type RuleBlock,
  type RuleFigure,
  type RuleSection,
} from "../data/rules-text";

type Props = {
  /** Section to show when the panel opens. Defaults to the first section. */
  initialSectionId?: string;
  onClose: () => void;
};

function Highlighted({ text, query }: { text: string; query: string }): ReactNode {
  return highlightParts(text, query).map((part, index) =>
    part.match ? <mark key={index}>{part.text}</mark> : part.text,
  );
}

function numbered(items: string[]): boolean {
  return items.length > 0 && items.every((item) => /^\d+\.\s/.test(item));
}

function Block({ block, query }: { block: RuleBlock; query: string }) {
  if (block.kind === "h3") return <h4><Highlighted text={block.text ?? ""} query={query} /></h4>;
  if (block.kind === "ul") {
    const items = block.items ?? [];
    return (
      <ul className={numbered(items) ? "rules-numbered" : undefined}>
        {items.map((item) => (
          <li key={item}>
            <Highlighted text={item} query={query} />
          </li>
        ))}
      </ul>
    );
  }
  return <p><Highlighted text={block.text ?? ""} query={query} /></p>;
}

function Figure({ figure }: { figure: RuleFigure }) {
  const caption = figureCaption(figure);
  return (
    <figure className="rules-figure">
      <a href={figure.src} target="_blank" rel="noreferrer" title="Open full size">
        <img src={figure.src} alt={figure.alt} width={figure.width} height={figure.height} loading="lazy" />
      </a>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function RulesPanel({ initialSectionId, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(
    rulesSections.some((section) => section.id === initialSectionId) ? initialSectionId! : rulesSections[0].id,
  );
  const bodyRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => searchRuleSections(query), [query]);
  const selected: RuleSection | undefined = results.find((section) => section.id === selectedId) ?? results[0];

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    bodyRef.current?.scrollTo?.({ top: 0 });
  }, [selected?.id]);

  return (
    <div className="rules-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="rules-panel" role="dialog" aria-modal="true" aria-labelledby="rules-heading">
        <header className="rules-header">
          <h2 id="rules-heading">Rules reference</h2>
          <input
            type="search"
            className="rules-search"
            placeholder="Search the rules"
            aria-label="Search the rules"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="rules-layout">
          <nav className="rules-toc" aria-label="Rules contents">
            {results.length === 0 ? (
              <p className="status-note">No section mentions that.</p>
            ) : (
              <ul>
                {results.map((section) => (
                  <li key={section.id} className={section.parentId ? "rules-toc-child" : undefined}>
                    <button
                      type="button"
                      className={section.id === selected?.id ? "rules-toc-link rules-toc-active" : "rules-toc-link"}
                      aria-current={section.id === selected?.id ? "true" : undefined}
                      onClick={() => setSelectedId(section.id)}
                    >
                      {section.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
          <div className="rules-body" ref={bodyRef}>
            {selected ? (
              <article aria-labelledby="rules-section-title">
                <h3 id="rules-section-title">
                  <Highlighted text={selected.title} query={query} />
                </h3>
                <p className="rules-pages">
                  Rulebook page{selected.pages.includes("-") ? "s" : ""} {selected.pages}
                  {selected.notInApp ? <span className="rules-badge">Not yet in this app</span> : null}
                </p>
                {selected.blocks.map((block, index) => (
                  <Block key={index} block={block} query={query} />
                ))}
                {(selected.figures ?? []).map((figure) => (
                  <Figure key={figure.src} figure={figure} />
                ))}
              </article>
            ) : null}
          </div>
        </div>
        <footer className="rules-attribution">{RULES_ATTRIBUTION}</footer>
      </section>
    </div>
  );
}
