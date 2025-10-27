import { truthClient } from "@/lib/truthClient";
import { errorResponse, getString } from "@/lib/routeHelpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const acct = getString(searchParams, "acct");

  if (!acct) {
    return NextResponse.json(
      { error: "`acct` query parameter is required." },
      { status: 400 }
    );
  }

  try {
    const result = await truthClient.lookup(acct);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
