import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SCALA Content Manager Extractor",
  description: "Extract and filter SCALA players by country and filial type.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
