import { NextResponse } from "next/server";
import { truthClient } from "@/lib/truthClient";

export async function GET() {
  return NextResponse.json({ data: truthClient.getRateLimit() });
}
