import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "../components/shell";
import { Glossary } from "../components/glossary";
export const Route = createFileRoute("/glosar")({
  component: () => (
    <Shell privatePage>
      <Glossary />
    </Shell>
  ),
});
