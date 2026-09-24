import { createFileRoute } from "@tanstack/react-router";
import { Releases } from "../components/releases";
export const Route = createFileRoute("/vydani")({ component: Releases });
