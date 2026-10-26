import type { ReactNode } from "react";

// Icon tokens in the Crown Handbook text ({bull}, {cube}, {die}...) as small inline badges.

const CLIMATE_NAMES: Record<string, string> = { bull: "Bull", stag: "Stag", lion: "Lion", bear: "Bear", peacock: "Peacock" };

const OTHER_ICONS: Record<string, { glyph: string; title: string }> = {
  cube: { glyph: "", title: "Crown promise cube" },
  die: { glyph: "⚅", title: "Die" },
  "pointing-hand": { glyph: "☞", title: "Pointing hand" },
  "hand-bullet": { glyph: "☞", title: "Pointing hand" },
  "writer-hand": { glyph: "W", title: "Writer" },
  "musket-fort": { glyph: "M", title: "Military (musket and fort)" },
  "eic-shield": { glyph: "EIC", title: "Company shield" },
  anchor: { glyph: "⚓", title: "Anchor (shipping)" },
  "top-hat": { glyph: "H", title: "Top hat" },
  cog: { glyph: "⚙", title: "Cog (workshop)" },
};

export function CrownIcon({ name }: { name: string }) {
  if (name in CLIMATE_NAMES) {
    const label = CLIMATE_NAMES[name];
    return (
      <span className={`crown-icon crown-climate crown-climate-${name}`} title={label} role="img" aria-label={label}>
        {label.slice(0, 2)}
      </span>
    );
  }
  const other = OTHER_ICONS[name];
  if (!other) return <span>{`{${name}}`}</span>;
  return (
    <span className={`crown-icon crown-icon-${name}`} title={other.title} role="img" aria-label={other.title}>
      {other.glyph}
    </span>
  );
}

/** Text with {icon} tokens replaced by badges. */
export function CrownRichText({ text }: { text: string }): ReactNode {
  return text.split(/(\{[a-z-]+\})/g).map((part, index) => {
    const token = /^\{([a-z-]+)\}$/.exec(part);
    return token ? <CrownIcon key={index} name={token[1]} /> : part;
  });
}
