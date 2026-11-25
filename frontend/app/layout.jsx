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
export const viewport = { width: "device-width", initialScale: 1, themeColor: "#FFFFFF", colorScheme: "light" };

const themeScript = `try{var t=localStorage.getItem("theme")||"light";var bg={light:"#FFFFFF",bluewhite:"#F3F8FD",greenpurple:"#F3F7F2",dark:"#17151A",sepia:"#F4ECD8"}[t]||"#FFFFFF";document.documentElement.setAttribute("data-theme",t);document.documentElement.style.colorScheme=(t==="dark"?"dark":"only light");var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",bg)}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="light" style={{ colorScheme: "only light" }} suppressHydrationWarning>
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
