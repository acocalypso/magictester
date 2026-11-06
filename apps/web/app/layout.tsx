import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "MagicTester · Deck intelligence",
  description:
    "Benchmark Magic: The Gathering decks with real Forge AI simulations.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
