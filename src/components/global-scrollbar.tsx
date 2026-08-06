import "./global-scrollbar.css";

/**
 * Mount once under the root route. Imports global scrollbar styling so every
 * scrollable regions pick up themed scrollbars tied to `:root` / `.dark`
 * semantic colors; the app sidebar (`[data-sidebar="content"]`) uses `--sidebar*` tokens.
 */
export function GlobalScrollbar() {
  return null;
}
