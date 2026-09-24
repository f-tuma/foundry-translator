import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "../components/shell";
import { Editor } from "../components/editor";
export const Route = createFileRoute("/editor")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { book?: string; q?: string; state?: string; all?: boolean } => ({
    book: typeof search.book === "string" ? search.book : undefined,
    q: typeof search.q === "string" ? search.q.slice(0, 200) : undefined,
    state: ["pending", "reviewed"].includes(String(search.state))
      ? String(search.state)
      : undefined,
    all: search.all === true || search.all === "true" ? true : undefined,
  }),
  component: EditorPage,
});
function EditorPage() {
  const initial = Route.useSearch();
  return (
    <Shell privatePage>
      <Editor key={JSON.stringify(initial)} initial={initial} />
    </Shell>
  );
}
