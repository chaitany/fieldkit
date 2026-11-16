import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fieldkit: customer data onboarding workbench",
  description: "Map a customer's messy export to your schema, review every field, and import clean records.",
};

export const viewport: Viewport = { themeColor: "#EDF0F3" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
