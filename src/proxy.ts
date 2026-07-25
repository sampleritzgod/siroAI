import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Session sync only — auth is enforced at each page/layout/API/action via
 * auth.protect() / requireUser() (Clerk resource-based auth).
 * Do not gate by path matchers here (createRouteMatcher is deprecated).
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/__clerk/:path*",
    "/(api|trpc)(.*)",
  ],
};
