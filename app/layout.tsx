import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next"

export const metadata: Metadata = {
  title: "Truth Social API Gateway",
  description: "Wrapper API built with Next.js that mirrors the truthbrush Python client."
};

export default function RootLayout(props: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{props.children}</body>
      <Analytics/>
    </html>
    
  );
}
