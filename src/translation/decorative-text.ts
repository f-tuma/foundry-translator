const ICON_STYLES = new Set(["fa", "fa-solid", "fa-regular", "fa-light", "fa-thin", "fa-duotone", "fa-brands"]);

/** Ember uses zero-width placeholders inside Font Awesome spans. They carry no
 * prose or mechanics, and older translations sometimes omitted them. Keep the
 * element, attributes and any actual text/commands fully protected. */
export function isDecorativeIconText(node: Node): boolean {
  if (node.nodeType !== 3 || !/^[\s\u200B-\u200D\uFEFF]*$/u.test(node.textContent ?? "")) return false;
  const parent = node.parentElement;
  if (!parent || !["SPAN", "I"].includes(parent.tagName)) return false;
  return [...parent.classList].some(name => ICON_STYLES.has(name)) &&
    [...parent.classList].some(name => name.startsWith("fa-") && !ICON_STYLES.has(name));
}
