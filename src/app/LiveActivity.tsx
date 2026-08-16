"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Entry {
  id: string;
  at: string;
  level: string;
  message: string;
}

interface Stats {
  total: number;
  analyzed: number;
  usable: number;
  pending: number;
  activeJobs: number;
}

// Während ein Lauf arbeitet, soll die Anzeige zügig nachziehen; im Leerlauf
// genügt ein deutlich ruhigeres Intervall, damit die Datenbank nicht ohne
// Grund im Sekundentakt abgefragt wird.
const POLL_BUSY_MS = 3000;
const POLL_IDLE_MS = 15000;

// So lange nach dem letzten Eintrag gilt ein Lauf als aktiv.
const BUSY_WINDOW_MS = 90_000;

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

export function LiveActivity() {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let lastNewestId: string | null = null;

    async function tick() {
      try {
        const res = await fetch("/api/activity", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;

        setEntries(data.entries);
        setStats(data.stats);

        const newest = data.entries[0];
        const isBusy =
          data.stats.activeJobs > 0 ||
          (newest ? Date.now() - new Date(newest.at).getTime() < BUSY_WINDOW_MS : false);
        setBusy(isBusy);

        // Kam ein neuer Eintrag dazu, kann sich auch die Videoliste geändert
        // haben - die wird serverseitig gerendert und muss angestossen werden.
        if (newest && newest.id !== lastNewestId) {
          if (lastNewestId !== null) router.refresh();
          lastNewestId = newest.id;
        }

        timer = setTimeout(tick, isBusy ? POLL_BUSY_MS : POLL_IDLE_MS);
      } catch {
        if (!cancelled) timer = setTimeout(tick, POLL_IDLE_MS);
      }
    }

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [router]);

  const progress =
    stats && stats.total > 0 ? Math.round((stats.analyzed / stats.total) * 100) : 0;

  return (
    <section className="live">
      <div className="live-head">
        <h2>
          Was gerade passiert
          {busy && <span className="pulse" aria-label="läuft" />}
        </h2>
        {stats && stats.pending > 0 && (
          <span className="live-progress">
            {stats.analyzed} von {stats.total} Clips analysiert ({progress} %)
          </span>
        )}
      </div>

      {stats && stats.total > 0 && (
        <div className="bar">
          <div className="bar-fill" style={{ width: `${progress}%` }} />
        </div>
      )}

      {entries.length === 0 ? (
        <p className="empty-state">
          Noch keine Aktivität. Löse oben einen Abgleich oder ein Video aus.
        </p>
      ) : (
        <ul className="log">
          {entries.map((entry) => (
            <li key={entry.id} className={entry.level === "error" ? "log-error" : undefined}>
              <span className="log-time">{formatTime(entry.at)}</span>
              <span>{entry.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
