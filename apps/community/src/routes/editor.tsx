import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "../components/shell";
import { Editor } from "../components/editor";
export const Route = createFileRoute("/editor")({
  component: () => (
    <Shell privatePage>
      <Editor />
    </Shell>
  ),
});
