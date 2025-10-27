import { truthClient } from "@/lib/truthClient";
import { errorResponse, getNumber, getString } from "@/lib/routeHelpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userHandle = getString(searchParams, "userHandle");
  const userId = getString(searchParams, "userId");

  if (!userHandle && !userId) {
    return NextResponse.json(
      {
        error: "Either `userHandle` or `userId` query parameter must be provided."
      },
      { status: 400 }
    );
  }

  const maximum = getNumber(searchParams, "maximum", 1000);
  const resume = getString(searchParams, "resume");

  try {
    const result = await truthClient.userFollowing({
      userHandle: userHandle ?? undefined,
      userId: userId ?? undefined,
      maximum: maximum ?? undefined,
      resume: resume ?? undefined
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    return errorResponse(error);
  }
}
