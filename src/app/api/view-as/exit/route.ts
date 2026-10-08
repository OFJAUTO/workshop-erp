import { NextResponse, type NextRequest } from "next/server";
import { VIEW_AS_COOKIE } from "@/lib/auth";

/** The owner leaves "View as" and returns to their own screens. A plain link, so it works while changes are blocked. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/team";
  url.search = "";
  const res = NextResponse.redirect(url);
  res.cookies.set(VIEW_AS_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
