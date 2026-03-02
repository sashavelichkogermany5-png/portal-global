import "./globals.css";
import { Space_Grotesk } from "next/font/google";
import { Providers } from "./providers";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap"
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.className} bg-black text-white`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
