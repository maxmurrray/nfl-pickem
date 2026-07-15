import type { Metadata, Viewport } from "next";
import Header from "@/components/Header";
import { PlayerProvider } from "@/components/PlayerContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bruce vs Rich · NFL Pick'em",
  description: "Weekly NFL pick'em: Bruce vs Rich, straight-up winners.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <PlayerProvider>
          <Header />
          {children}
        </PlayerProvider>
      </body>
    </html>
  );
}
