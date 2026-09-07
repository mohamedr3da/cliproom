import type { Metadata } from 'next';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cliproom.sevencliproom.workers.dev';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'ClipRoom | Private Clip Queue',
  description:
    'A private clip queue for creator teams to review, organise, and track Twitch and Kick clips.',
  icons: {
    icon: [
      { url: '/favicon.png?v=cliproom-2', type: 'image/png', sizes: '64x64' },
      { url: '/favicon.svg?v=cliproom-2', type: 'image/svg+xml', sizes: 'any' },
    ],
    apple: { url: '/apple-touch-icon.png?v=cliproom-2', sizes: '180x180', type: 'image/png' },
  },
  openGraph: {
    title: 'ClipRoom | Private Clip Queue',
    description: 'Your team’s clip queue. Review, organise, and track Twitch and Kick clips together.',
    images: [
      {
        url: '/og.png?v=cliproom-3',
        width: 1200,
        height: 630,
        alt: 'ClipRoom — Your team’s clip queue',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClipRoom | Private Clip Queue',
    description: 'Your team’s clip queue. Review, organise, and track Twitch and Kick clips together.',
    images: ['/og.png?v=cliproom-3'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
