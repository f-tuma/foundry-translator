import { useQuery } from "@tanstack/react-query";
import type { Session } from "./shared";
export const BRIDGE = "/weblate/foundry";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    const session = await api<{ csrf: string }>("session");
    headers["X-CSRFToken"] = session.csrf;
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${BRIDGE}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json().catch(() => ({
    error: "Server nevrátil platnou odpověď. Zkuste obnovit stránku.",
  }));
  if (!response.ok)
    throw new ApiError(
      value.error || "Operace se nezdařila.",
      response.status,
      value.details,
    );
  return value;
}
export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => api<Session>("session"),
    staleTime: 30000,
  });
}
export function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
