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
  const post = getString(searchParams, "post");

  if (!post) {
    return NextResponse.json(
      { error: "`post` query parameter is required." },
      { status: 400 }
    );
  }

  const includeAll = getBoolean(searchParams, "includeAll", false);
  const top = getNumber(searchParams, "top", 40);

  try {
    const result = await truthClient.userLikes(post, {
      includeAll,
      top
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    return errorResponse(error);
  }
}
