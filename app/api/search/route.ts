import { truthClient } from "@/lib/truthClient";
import {
  errorResponse,
  getBoolean,
  getNumber,
  getString
} from "@/lib/routeHelpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = getString(searchParams, "query");
  const type = getString(searchParams, "type");

  if (!query || !type) {
    return NextResponse.json(
      { error: "`query` and `type` query parameters are required." },
      { status: 400 }
    );
  }

  const limit = getNumber(searchParams, "limit", 40);
  const resolve = getBoolean(searchParams, "resolve", true);
  const offset = getNumber(searchParams, "offset", 0);
  const minId = getString(searchParams, "minId") ?? "0";
  const maxId = getString(searchParams, "maxId");

  try {
    const result = await truthClient.search({
      query,
      type,
      limit,
      resolve,
      offset,
      minId,
      maxId: maxId ?? undefined
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    return errorResponse(error);
  }
}
