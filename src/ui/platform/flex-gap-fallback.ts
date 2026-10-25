// Safari 14.0 understands `gap` for grid but ignores it in flexbox (fixed in 14.1). On browsers
// without flex gap, copy each flex container's gap onto its children as margins. Everywhere else
// this does nothing.

export function supportsFlexGap(): boolean {
  const flex = document.createElement("div");
  flex.style.display = "flex";
  flex.style.flexDirection = "column";
  flex.style.rowGap = "1px";
  flex.append(document.createElement("div"), document.createElement("div"));
  document.body.append(flex);
  const supported = flex.scrollHeight === 1;
  flex.remove();
  return supported;
}

function applyGapMargins(root: HTMLElement): void {
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    if (!(element instanceof HTMLElement)) continue;
    const style = getComputedStyle(element);
    if (style.display !== "flex" && style.display !== "inline-flex") continue;

    const columnGap = parseFloat(style.columnGap) || 0;
    const rowGap = parseFloat(style.rowGap) || 0;
    if (columnGap === 0 && rowGap === 0) continue;

    const vertical = style.flexDirection.startsWith("column");
    const wraps = style.flexWrap !== "nowrap";
    Array.from(element.children).forEach((child, index) => {
      if (!(child instanceof HTMLElement)) return;
      if (vertical) {
        if (index > 0) child.style.marginTop = `${rowGap}px`;
      } else {
        if (index > 0) child.style.marginLeft = `${columnGap}px`;
        if (wraps && rowGap > 0) child.style.marginBottom = `${rowGap}px`;
      }
    });
  }
}

export function installFlexGapFallback(root: HTMLElement = document.body): () => void {
  if (supportsFlexGap()) return () => undefined;

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    const nextFrame = window.requestAnimationFrame ?? ((callback: () => void) => window.setTimeout(callback, 16));
    nextFrame(() => {
      scheduled = false;
      applyGapMargins(root);
    });
  };

  applyGapMargins(root);
  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
