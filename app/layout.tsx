import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import Cursor from "@/components/Cursor";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const retroFont = localFont({
  src: "../fonts/retrofont.ttf",
  variable: "--font-retro",
});

export const metadata: Metadata = {
  title: "Joël Mik — Creative Developer",
  description:
    "Joël Mik is a creative developer building websites with motion, WebGL and WebGPU.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${retroFont.variable} antialiased bg-[#24242a]`}
      >
   
        {children}
        <Cursor />
      </body>
    </html>
  );
}
