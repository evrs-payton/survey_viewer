import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { SessionProvider, signOut, useSession } from 'next-auth/react';

import '../styles/globals.css';

function SignOutButton() {
  const { data: session } = useSession();
  const router = useRouter();
  // Pages with their own navbars manage sign-out themselves
  const hasOwnNav = router.pathname.startsWith('/surveys') ||
    router.pathname.startsWith('/assignments') ||
    router.pathname.startsWith('/survey-band');
  if (!session || hasOwnNav) return null;
  return (
    <div style={{
      position: 'fixed',
      top: '0.75rem',
      right: '1rem',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      gap: '0.6rem',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    }}>
      <span style={{ fontSize: '0.78rem', color: 'rgba(200,215,240,0.5)' }}>
        {session.user?.email ?? session.user?.name}
      </span>
      <button
        onClick={() => signOut({ callbackUrl: '/login' })}
        style={{
          padding: '0.3rem 0.75rem',
          background: 'rgba(15,20,35,0.85)',
          color: 'rgba(200,215,240,0.7)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '0.5rem',
          fontSize: '0.75rem',
          cursor: 'pointer',
        }}
      >
        Sign out
      </button>
    </div>
  );
}

export default function App({ Component, pageProps: { session, ...pageProps } }: AppProps) {
  return (
    <SessionProvider session={session}>
      <Head>
        <title>RF Spectrum Explorer</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/png" href="/favicon.png" />
      </Head>
      <SignOutButton />
      <Component {...pageProps} />
    </SessionProvider>
  );
}
