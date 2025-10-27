import { truthClient } from "@/lib/truthClient";
import { errorResponse, getNumber } from "@/lib/routeHelpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = getNumber(searchParams, "limit", 10);

  try {
    const result = await truthClient.trending(limit ?? 10);
    return NextResponse.json({ data: result });
  } catch (error) {
    return errorResponse(error);
  }
}
