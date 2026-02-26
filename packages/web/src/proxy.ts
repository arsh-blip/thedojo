import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;

  // If no password configured, skip auth (local dev)
  if (!password) {
    return NextResponse.next();
  }

  // Skip auth for API routes (proxied internally) and static assets
  if (
    request.nextUrl.pathname.startsWith("/api/") ||
    request.nextUrl.pathname.startsWith("/_next/") ||
    request.nextUrl.pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const encoded = authHeader.split(" ")[1];
    if (encoded) {
      const decoded = Buffer.from(encoded, "base64").toString("utf-8");
      const submittedPassword = decoded.split(":").slice(1).join(":");
      if (submittedPassword === password) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="The Dojo"',
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
