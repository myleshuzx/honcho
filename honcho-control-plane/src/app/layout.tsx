import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Honcho Control Plane",
  description: "Workspace-scoped control plane for Honcho memory"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
