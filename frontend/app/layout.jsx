import "./globals.css";
import RegisterSW from "../components/RegisterSW";

export const metadata = {
  title: "Read-Aloud PDF",
  description: "Listen to your PDFs",
  manifest: "/manifest.json",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};
export const viewport = { width: "device-width", initialScale: 1, themeColor: "#0E7C86" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
