import { NextResponse, type NextRequest } from "next/server";
import { lendingEnabled, resolveDeployTarget } from "@/config/target";
import { routeFor } from "@/config/routes";

// Inlined at build time, like every NEXT_PUBLIC_* read.
const LENDING = lendingEnabled(resolveDeployTarget(process.env.NEXT_PUBLIC_WRITZ_ENV));

/** Closes the lending surface on an Earn-only deploy (mainnet, #122). */
export function proxy(request: NextRequest) {
  const decision = routeFor(request.nextUrl.pathname, LENDING);
  if (decision.kind === "redirect") return NextResponse.redirect(new URL(decision.to, request.url));
  if (decision.kind === "not-found") return new NextResponse("Not found", { status: 404 });
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/borrow/:path*", "/loans/:path*", "/lend/:path*", "/help/reclaim/:path*", "/dev/:path*", "/api/cosign/:path*"],
};
