import { truthClient } from "@/lib/truthClient";
import { errorResponse, getNumber, getString } from "@/lib/routeHelpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const groupId = getString(searchParams, "groupId");

  if (!groupId) {
    return NextResponse.json(
      { error: "`groupId` query parameter is required." },
      { status: 400 }
    );
  }

  const limit = getNumber(searchParams, "limit", 20);

  try {
    const result = await truthClient.groupPosts(groupId, limit ?? 20);
    return NextResponse.json({ data: result });
  } catch (error) {
    return errorResponse(error);
  }
}
