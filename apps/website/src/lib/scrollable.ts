/**
 * Keyboard access to content that scrolls horizontally (code, wide tables on small screens): while an
 * element overflows, it is focusable so the arrow keys can scroll it (axe `scrollable-region-focusable`).
 * With a `name`, it is also exposed as a named region, so that several of them on a page stay
 * distinguishable (axe `landmark-unique`). Checked at once, then whenever the element is resized.
 *
 * Expressive Code toggles `tabindex` and `role` on its own code blocks too, but only after a delay and
 * without a name; both agree on when a block overflows.
 */
export function focusWhileScrollable(elements: Iterable<HTMLElement>, name?: (element: HTMLElement) => string) {
  const update = (element: HTMLElement) => {
    if (element.scrollWidth > element.clientWidth) {
      element.setAttribute('tabindex', '0');
      if (name) {
        element.setAttribute('role', 'region');
        element.setAttribute('aria-label', name(element));
      }
    } else {
      element.removeAttribute('tabindex');
      if (name) {
        element.removeAttribute('role');
        element.removeAttribute('aria-label');
      }
    }
  };
  const observer = new ResizeObserver((entries) => entries.forEach(({ target }) => update(target as HTMLElement)));
  for (const element of elements) {
    update(element);
    observer.observe(element);
  }
}

/** Appends ` (2)`, ` (3)`… to the names that occur several times, so that each one is unique. */
export function uniqueNames(names: string[]): string[] {
  return names.map((name, index) => {
    if (names.indexOf(name) === names.lastIndexOf(name)) return name;
    return `${name} (${names.slice(0, index + 1).filter((other) => other === name).length})`;
  });
}
