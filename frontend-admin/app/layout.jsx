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
  themeColor: "#F3F8FD",
};

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
    <html lang="en" data-theme="bluewhite" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="only light" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
