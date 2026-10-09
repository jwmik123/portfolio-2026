import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { parseBody } from "next-sanity/webhook";

import { PROJECTS_TAG } from "@/lib/projects";

/**
 * Sanity calls this on every create, update or delete of a project. The
 * signature is checked against SANITY_REVALIDATE_SECRET, then the cached
 * project list is expired so the next request renders the new one.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SANITY_REVALIDATE_SECRET;
  if (!secret) {
    return new NextResponse("Missing SANITY_REVALIDATE_SECRET", { status: 500 });
  }

  // waits until the change is visible in the Content Lake before we refetch
  const { isValidSignature, body } = await parseBody<{ _type?: string }>(
    req,
    secret,
    true
  );

  if (!isValidSignature) {
    return new NextResponse("Invalid signature", { status: 401 });
  }
  if (body?._type !== "project") {
    return NextResponse.json({ revalidated: false, reason: "not a project" });
  }

  revalidateTag(PROJECTS_TAG, { expire: 0 });
  return NextResponse.json({ revalidated: true, tag: PROJECTS_TAG });
}
