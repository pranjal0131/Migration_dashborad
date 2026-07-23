import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Migration Monitor", description: "Website migration auditing for teams" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
