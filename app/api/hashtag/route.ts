import { truthClient } from "@/lib/truthClient";
import { errorResponse, getNumber, getString } from "@/lib/routeHelpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tag = getString(searchParams, "tag");

  if (!tag) {
    return NextResponse.json(
      { error: "`tag` query parameter is required." },
      { status: 400 }
    );
  }

  const limit = getNumber(searchParams, "limit", 100);

  try {
    const result = await truthClient.hashtag(tag, limit ?? 100);
    return NextResponse.json({ data: result });
  } catch (error) {
    return errorResponse(error);
  }
}
