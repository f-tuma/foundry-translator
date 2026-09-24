import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "../components/shell";
import { AccountPage } from "../components/account";

export const Route = createFileRoute("/ucet")({
  component: () => (
    <Shell>
      <AccountPage />
    </Shell>
  ),
});
