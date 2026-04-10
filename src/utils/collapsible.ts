/**
 * Reusable collapsible utility with full ARIA + keyboard support.
 * Pattern from Claudian (MIT).
 */

interface CollapsibleState {
  expanded: boolean;
}

interface CollapsibleOptions {
  initiallyExpanded?: boolean;
  onToggle?: (expanded: boolean) => void;
  baseAriaLabel?: string;
}

/**
 * Wire up a collapsible: clicking the header toggles the content div.
 * Handles click, Enter/Space keydown, aria-expanded, display style.
 */
export function setupCollapsible(
  wrapperEl: HTMLElement,
  headerEl: HTMLElement,
  contentEl: HTMLElement,
  state: CollapsibleState,
  options: CollapsibleOptions = {}
): void {
  state.expanded = options.initiallyExpanded ?? false;
  applyState(wrapperEl, headerEl, contentEl, state, options.baseAriaLabel);

  headerEl.setAttribute("tabindex", "0");
  headerEl.setAttribute("role", "button");

  const toggle = () => {
    state.expanded = !state.expanded;
    applyState(wrapperEl, headerEl, contentEl, state, options.baseAriaLabel);
    options.onToggle?.(state.expanded);
  };

  headerEl.addEventListener("click", toggle);
  headerEl.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });
}

/**
 * Programmatically collapse a collapsible element.
 */
export function collapseElement(
  wrapperEl: HTMLElement,
  headerEl: HTMLElement,
  contentEl: HTMLElement,
  state: CollapsibleState,
  baseAriaLabel?: string
): void {
  state.expanded = false;
  applyState(wrapperEl, headerEl, contentEl, state, baseAriaLabel);
}

function applyState(
  wrapperEl: HTMLElement,
  headerEl: HTMLElement,
  contentEl: HTMLElement,
  state: CollapsibleState,
  baseAriaLabel?: string
): void {
  headerEl.setAttribute("aria-expanded", String(state.expanded));
  contentEl.style.display = state.expanded ? "block" : "none";
  wrapperEl.toggleClass("is-expanded", state.expanded);

  if (baseAriaLabel) {
    const suffix = state.expanded ? "click to collapse" : "click to expand";
    headerEl.setAttribute("aria-label", `${baseAriaLabel} - ${suffix}`);
  }
}
