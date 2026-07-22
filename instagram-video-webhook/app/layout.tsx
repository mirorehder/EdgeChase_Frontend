export const metadata = {
  title: "Instagram Video Webhook",
  description:
    "Empfängt Instagram-DM-Videos von edgechase.official und analysiert sie per KI.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body
        style={{
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          margin: 0,
          padding: "3rem 1.5rem",
          background: "#0b0b0f",
          color: "#e8e8ee",
        }}
      >
        {children}
      </body>
    </html>
  );
}
