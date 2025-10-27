import { NextResponse } from "next/server";
import { TruthApiError } from "./errors";

export function getString(
  searchParams: URLSearchParams,
  key: string
): string | undefined {
  const value = searchParams.get(key);
  return value ?? undefined;
}

export function getNumber(
  searchParams: URLSearchParams,
  key: string,
  fallback?: number
): number | undefined {
  const raw = searchParams.get(key);
  if (raw === null || raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function getBoolean(
  searchParams: URLSearchParams,
  key: string,
  fallback = false
): boolean {
  const raw = searchParams.get(key);
  if (raw === null) {
    return fallback;
  }
  const normalized = raw.toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export function errorResponse(error: unknown) {
  const status =
    error instanceof TruthApiError && Number.isInteger(error.status)
      ? error.status
      : 500;
  const message =
    error instanceof Error ? error.message : "Unexpected server error.";
  return NextResponse.json({ error: message }, { status });
}
