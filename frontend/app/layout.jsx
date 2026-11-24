import "./globals.css";
import RegisterSW from "../components/RegisterSW";

export const metadata = {
  title: "HIM Ministries · Library",
  description: "A thoughtful home for reading, reflection, and learning.",
  manifest: "/manifest.json",
  icons: { icon: "/favicon.svg", apple: "/favicon.svg" },
};
export const viewport = { width: "device-width", initialScale: 1, themeColor: "#FFFFFF" };

// Sets the saved theme before the page paints, so there is no flash of the wrong colors.
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark"||t==="bluewhite")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

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