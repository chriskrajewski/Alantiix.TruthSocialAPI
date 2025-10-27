import { truthClient } from "@/lib/truthClient";
import { errorResponse } from "@/lib/routeHelpers";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const result = await truthClient.groupTags();
    return NextResponse.json({ data: result });
  } catch (error) {
    return errorResponse(error);
  }
}
