import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "../components/shell";
import { Importer } from "../components/importer";
export const Route = createFileRoute("/import")({
  component: () => (
    <Shell privatePage>
      <Importer />
    </Shell>
  ),
});
