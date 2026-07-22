export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.6rem", marginBottom: "0.5rem" }}>
        Instagram Video Webhook
      </h1>
      <p style={{ color: "#a9a9b8", lineHeight: 1.6 }}>
        Dieser Dienst registriert per Webhook, wenn{" "}
        <code>edgechase.official</code> ein Video als Instagram-DM sendet, und
        analysiert es automatisch per KI (Claude + Keyframes + Transkript).
      </p>
      <ul style={{ color: "#a9a9b8", lineHeight: 1.9 }}>
        <li>
          <code>GET/POST /api/instagram/webhook</code> – Meta-Webhook-Endpoint
        </li>
        <li>
          <code>GET /api/analyses</code> – zuletzt analysierte Videos
        </li>
        <li>
          <code>GET /api/analyses/&lt;id&gt;</code> – einzelne Analyse
        </li>
      </ul>
      <p style={{ color: "#6b6b7b", fontSize: "0.85rem" }}>
        Setup-Anleitung siehe README.
      </p>
    </main>
  );
}
