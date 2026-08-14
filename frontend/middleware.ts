// Route protection via NextAuth v4 edge middleware.
//
// All routes require an authenticated session by default.
// The matcher below excludes paths that must remain public.
//
// NOTE: This middleware replaces CAC/mTLS browser-level access control.
// The old mTLS requirement was enforced at the reverse proxy (Nginx/Cloudflare).
// Once OIDC login is proven working, remove the mTLS client cert requirement
// from the Cloudflare Tunnel / Nginx config for browser traffic.
// Keep mTLS in place for service-to-service calls until those are migrated.

export { default } from 'next-auth/middleware';

export const config = {
  matcher: [
    /*
     * Protect all paths EXCEPT:
     *   /api/auth/*    — NextAuth sign-in / callback / sign-out / session endpoints
     *   /login         — Our custom sign-in page
     *   /api/health    — Health check (no auth, safe for probes)
     *   /_next/static  — Next.js compiled assets
     *   /_next/image   — Next.js image optimisation
     *   /favicon.ico   — Browser favicon
     */
    '/((?!api/auth|login|api/health|_next/static|_next/image|favicon\\.ico|.*\\.png|.*\\.ico|.*\\.svg|.*\\.jpg|.*\\.webp).*)',
  ],
};
