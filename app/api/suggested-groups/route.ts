import { truthClient } from "@/lib/truthClient";
import { errorResponse, getNumber } from "@/lib/routeHelpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const maximum = getNumber(searchParams, "maximum", 50);

  try {
    const result = await truthClient.suggestedGroups(maximum ?? 50);
    return NextResponse.json({ data: result });
  } catch (error) {
    return errorResponse(error);
  }
}
