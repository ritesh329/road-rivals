import type { Metadata, Viewport } from "next";
import "../styles/globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "ROAD RIVALS",
  description: "Browser-based 3D multiplayer racing",
  manifest: "/manifest.webmanifest",
  applicationName: "Road Rivals",
  formatDetection: { telephone: false },
  // iOS "Add to Home Screen": full-screen app, content runs under the status bar
  appleWebApp: { capable: true, title: "Road Rivals", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon.svg" },
  other: { "mobile-web-app-capable": "yes" },
};

// Edge-to-edge on phones (notch / status bar / gesture bar); no pinch-zoom while driving.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#07080d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}
