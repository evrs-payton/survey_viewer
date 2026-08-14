import NextAuth, { type NextAuthOptions } from 'next-auth';
import AuthentikProvider from 'next-auth/providers/authentik';

export const authOptions: NextAuthOptions = {
  // AUTH_SECRET is the Auth.js v5 naming convention; NextAuth v4 also accepts NEXTAUTH_SECRET.
  // Both are supported here so either works in .env.
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,

  providers: [
    AuthentikProvider({
      clientId: process.env.AUTH_AUTHENTIK_ID!,
      clientSecret: process.env.AUTH_AUTHENTIK_SECRET!,
      // Issuer must match the Authentik application slug, no trailing slash.
      // Example: https://auth.evrslab.com/application/o/rfexplorer
      issuer: process.env.AUTH_AUTHENTIK_ISSUER!,
    }),
  ],

  pages: {
    signIn: '/login',
  },

  callbacks: {
    // MVP authorization: allow any user authenticated by Authentik.
    //
    // To add group/role authorization later, inspect `profile` here:
    //   const groups = (profile as any).groups as string[] | undefined;
    //   return groups?.includes('rfexplorer-users') ?? false;
    async signIn() {
      return true;
    },

    // Forward relevant token claims into the session so pages can read them.
    // Add role/group fields to the return value when authorization expands.
    async session({ session, token }) {
      return session;
    },
  },
};

export default NextAuth(authOptions);
