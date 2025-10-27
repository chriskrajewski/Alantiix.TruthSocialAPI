import { truthClient } from "@/lib/truthClient";
import { errorResponse, getString } from "@/lib/routeHelpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const device = getString(searchParams, "device") ?? "desktop";

  try {
    const result = await truthClient.ads(device);
    return NextResponse.json({ data: result });
  } catch (error) {
    return errorResponse(error);
  }
}
