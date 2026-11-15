import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fieldkit — customer data onboarding workbench",
  description: "AI-assisted, human-approved data mapping for Forward Deployed Engineers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
