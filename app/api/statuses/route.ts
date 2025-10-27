import { truthClient } from "@/lib/truthClient";
import {
  errorResponse,
  getBoolean,
  getString
} from "@/lib/routeHelpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const username = getString(searchParams, "username");

  if (!username) {
    return NextResponse.json(
      { error: "`username` query parameter is required." },
      { status: 400 }
    );
  }

  const replies = getBoolean(searchParams, "replies", false);
  const pinned = getBoolean(searchParams, "pinned", false);
  const createdAfter = getString(searchParams, "createdAfter");
  const sinceId = getString(searchParams, "sinceId");

  try {
    const result = await truthClient.pullStatuses({
      username,
      replies,
      pinned,
      createdAfter: createdAfter ?? undefined,
      sinceId: sinceId ?? undefined
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    return errorResponse(error);
  }
}
