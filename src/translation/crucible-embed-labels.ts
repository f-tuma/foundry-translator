/** Crucible 0.11's Actor/Item embeds ignore the standard explicit label.
 * Restore it on the returned DOM only; source documents and link UUIDs stay intact.
 */
export function applyEmbedLabel(root: HTMLElement, uuid: string, originalName: string, label: string): void {
  const replace = (element: Element): void => {
    const texts: Text[] = [];
    const visit = (node: Node): void => {
      if (node.nodeType === 3) texts.push(node as Text);
      else for (const child of node.childNodes) visit(child);
    };
    visit(element);
    if (texts.map(node => node.data).join("").trim() !== originalName) return;
    const first = texts.find(node => node.data.trim());
    if (!first) return;
    for (const node of texts) node.data = node === first ? label : "";
  };
  for (const link of root.querySelectorAll<HTMLElement>("a[data-uuid]")) {
    if (link.dataset.uuid === uuid) replace(link);
  }
  // Item cards render a plain heading as well as the caption's document link.
  for (const heading of root.querySelectorAll(".crucible.item-embed > .action > .action-header .title > h4")) {
    if (heading.closest("document-embed")?.getAttribute("uuid") === uuid) replace(heading);
  }
  for (const image of root.querySelectorAll("img[alt]")) {
    if (image.getAttribute("alt") === originalName) image.setAttribute("alt", label);
  }
}

interface EmbedDocument { uuid: string; name: string }
type EmbedMethod = (this: EmbedDocument, config: { label?: string }, ...args: unknown[]) => Promise<HTMLElement | null>;
const PATCHED = Symbol("foundry-translate-embed-label");
interface EmbedPrototype { toEmbed?: EmbedMethod; [PATCHED]?: boolean }

export function registerCrucibleEmbedLabels(): void {
  if (game.system?.id !== "crucible") return;
  for (const type of [CONFIG.Actor, CONFIG.Item]) {
    const prototype = type?.documentClass?.prototype as EmbedPrototype | undefined;
    if (!prototype?.toEmbed || prototype[PATCHED]) continue;
    const original = prototype.toEmbed;
    prototype.toEmbed = async function(config = {}, ...args) {
      const root = await original.call(this, config, ...args);
      if (root && typeof config.label === "string" && config.label.trim()) applyEmbedLabel(root, this.uuid, this.name, config.label);
      return root;
    };
    prototype[PATCHED] = true;
  }
}
