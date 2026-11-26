import "./globals.css";
import RegisterSW from "../components/RegisterSW";

export const metadata = {
  title: "HIM Ministries · Library",
  description: "A thoughtful home for reading, reflection, and learning.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};
export const viewport = { width: "device-width", initialScale: 1, themeColor: "#F3F8FD", colorScheme: "light" };

const themeScript = `try{
  var raw=localStorage.getItem("theme");
  var map={light:"bluewhite",pure:"bluewhite",sky:"bluewhite",mint:"greenpurple",parchment:"sepia"};
  var t=map[raw]||raw;
  var bg={bluewhite:"#F3F8FD",greenpurple:"#F3F7F2",sepia:"#FAF6F0",olive:"#F3F6F1",dark:"#0F172A"};
  if(!bg[t])t="bluewhite";
  document.documentElement.setAttribute("data-theme",t);
  document.documentElement.style.colorScheme=(t==="dark"?"dark":"only light");
  var m=document.querySelector('meta[name="theme-color"]');
  if(m)m.setAttribute("content",bg[t]);
}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="bluewhite" style={{ colorScheme: "only light" }} suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
