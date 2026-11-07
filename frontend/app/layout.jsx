import "./globals.css";
import RegisterSW from "../components/RegisterSW";

export const metadata = {
  title: "Read-Aloud PDF",
  description: "Listen to your PDFs",
  manifest: "/manifest.json",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};
export const viewport = { width: "device-width", initialScale: 1, themeColor: "#0E1018" };

// Sets the saved theme before the page paints, so there is no flash of the wrong colors.
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}