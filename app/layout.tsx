import type { Metadata } from 'next';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cliproom.sevencliproom.workers.dev';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'ClipRoom | Private Twitch Clip Queue',
  description:
    'A private Twitch clip queue where creator teams can review clips, prioritise edits, assign access, and track what has been posted.',
  openGraph: {
    title: 'ClipRoom | Private Twitch Clip Queue',
    description: 'Review, claim, prioritise, and publish Twitch clips with a trusted creator team.',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'ClipRoom private clip queues for creator teams',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClipRoom | Private Twitch Clip Queue',
    description: 'Review, claim, prioritise, and publish Twitch clips with a trusted creator team.',
    images: ['/og.png'],
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
