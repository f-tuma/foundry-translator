import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "../components/shell";
import { Proposals } from "../components/proposals";
export const Route = createFileRoute("/navrhy")({
  validateSearch: (search: Record<string, unknown>): { id?: string } => ({
    id: typeof search.id === "string" ? search.id : undefined,
  }),
  component: () => (
    <Shell privatePage>
      <Proposals />
    </Shell>
  ),
});
