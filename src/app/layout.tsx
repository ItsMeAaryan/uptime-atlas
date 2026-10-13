import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Uptime Atlas — Website Monitoring & Incident Tracking",
  description:
    "Real-time HTTP/HTTPS endpoint uptime monitoring, latency tracking, and incident management platform.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-emerald-500 selection:text-slate-950">
        {children}
      </body>
    </html>
  );
}
