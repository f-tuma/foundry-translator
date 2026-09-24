import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "../components/shell";
import { Dashboard } from "../components/dashboard";
export const Route = createFileRoute("/prehled")({
  component: () => (
    <Shell privatePage>
      <Dashboard />
    </Shell>
  ),
});
