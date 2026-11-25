import "./globals.css";

export const metadata = {
  title: "Admin · HIM Ministries",
  description: "Manage members, groups, library books, usage analytics, and announcements",
  icons: { icon: "/admin/favicon.svg" },
  manifest: "/admin/manifest.json",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F1F5F9",
};

const themeScript = `try{
  var t=localStorage.getItem("theme");
  if(t==="light")t="pure";
  if(!["pure","sky","mint","dark"].includes(t))t="sky";
  document.documentElement.setAttribute("data-theme",t);
  document.documentElement.style.colorScheme=(t==="dark"?"dark":"only light");
}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="sky" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="only light" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
