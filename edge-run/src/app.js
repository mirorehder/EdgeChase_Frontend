/* =========================================================================
   EDGE RUN — App-Steuerung (Screens, API, Gewinn-Enthüllung)
   ========================================================================= */
import { createGame } from "./game.js";

// Überschreibbar aus Wix per <script>window.EDGE_RUN={...}</script> vor dem Embed.
const CONF = Object.assign({
  apiBase: "",                       // "" = gleiche Origin (Vercel)
  shopUrl: "https://www.edgechase.de",
  termsUrl: "",
  privacyUrl: "",
}, window.EDGE_RUN || {});

const $ = (s) => document.querySelector(s);
const screens = {
  intro: $("#screen-intro"),
  game: $("#screen-game"),
  result: $("#screen-result"),
};
function show(name) {
  for (const k in screens) screens[k].classList.toggle("screen--active", k === name);
}

/* ---------- Logo vorladen (PNG bevorzugt, sonst SVG) ---------- */
function preloadLogo() {
  return new Promise((resolve) => {
    const png = new Image();
    png.onload = () => resolve(png);
    png.onerror = () => {
      const svg = new Image();
      svg.onload = () => resolve(svg);
      svg.onerror = () => resolve(null);
      svg.src = "./public/logo.svg";
    };
    png.src = "./public/logo.png";
  });
}

let logoImg = null;
let game = null;
let session = null;          // { token, name }

/* ---------- Intro ---------- */
const form = $("#intro-form");
const errBox = $("#intro-error");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errBox.hidden = true;
  const name = $("#in-name").value.trim();
  const email = $("#in-email").value.trim();
  const consent = $("#in-consent").checked;

  if (name.length < 2) return showError("Bitte gib deinen Namen ein.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showError("Bitte gib eine gültige E-Mail an.");
  if (!consent) return showError("Bitte akzeptiere die Teilnahmebedingungen.");

  const btn = $("#btn-start");
  btn.disabled = true; btn.textContent = "STARTET…";
  try {
    const res = await api("/api/start", { name, email });
    if (!res.ok) {
      if (res.error === "already_played") {
        // schon gespielt -> direkt Ergebnis/Blocker zeigen
        show("result");
        renderBlocked(res.message || "Du hast heute bereits gespielt.");
        return;
      }
      throw new Error(res.message || "Start fehlgeschlagen");
    }
    session = { token: res.token, name };
    startGameFlow();
  } catch (err) {
    showError(err.message || "Etwas ist schiefgelaufen. Bitte erneut versuchen.");
  } finally {
    btn.disabled = false; btn.textContent = "SPIEL STARTEN";
  }
});
function showError(msg) { errBox.textContent = msg; errBox.hidden = false; }

/* ---------- Spielablauf ---------- */
function startGameFlow() {
  show("game");
  const canvas = $("#game-canvas");
  const hintEl = $("#controls-hint");
  const scoreEl = $("#hud-score");
  const threatEl = $("#threat-fill");

  game = createGame(canvas, {
    logoImg,
    onScore: (s) => { scoreEl.textContent = s; },
    onThreat: (t) => { threatEl.style.width = Math.round(t * 100) + "%"; },
    onGameOver: handleGameOver,
  });

  countdown(() => {
    game.start();
    setTimeout(() => hintEl.classList.add("controls-hint--hidden"), 2600);
  });
}

function countdown(done) {
  const el = $("#countdown");
  el.hidden = false;
  const seq = ["3", "2", "1", "LOS!"];
  let i = 0;
  el.textContent = seq[i];
  const iv = setInterval(() => {
    i++;
    if (i >= seq.length) { clearInterval(iv); el.hidden = true; done(); return; }
    el.textContent = seq[i];
  }, 650);
}

async function handleGameOver(result) {
  show("result");
  $("#result-loading").hidden = false;
  $("#result-content").hidden = true;
  $("#result-score").textContent = result.score;

  try {
    const res = await api("/api/reward", {
      token: session?.token,
      score: result.score,
      durationMs: result.durationMs,
      jumps: result.jumps,
      hits: result.hits,
      reason: result.reason,
    });
    if (!res.ok) {
      if (res.error === "already_played") return renderBlocked(res.message);
      throw new Error(res.message || "Auswertung fehlgeschlagen");
    }
    renderReward(res, result.score);
  } catch (err) {
    renderError(err.message);
  }
}

/* ---------- Ergebnis-Rendering ---------- */
function renderReward(res, score) {
  $("#result-loading").hidden = true;
  const content = $("#result-content");
  content.hidden = false;

  const prize = $("#result-prize");
  const value = $("#prize-value");
  const label = $("#prize-label");
  const headline = $("#result-headline");
  const codeWrap = $("#result-code-wrap");
  const note = $("#result-note");
  const shopBtn = $("#btn-shop");

  prize.classList.remove("prize--jackpot", "prize--none");
  $("#result-score").textContent = score;

  const r = res.reward || { kind: "none" };
  if (r.kind === "free") {
    headline.textContent = "JACKPOT";
    prize.classList.add("prize--jackpot");
    value.textContent = "GRATIS";
    label.textContent = "KLEIDUNGSSTÜCK";
    celebrate();
  } else if (r.kind === "percent") {
    headline.textContent = headlineFor(r.value);
    value.textContent = r.value + "%";
    label.textContent = "RABATT";
  } else {
    headline.textContent = "KNAPP!";
    prize.classList.add("prize--none");
    value.textContent = "0%";
    label.textContent = "DIESMAL KEIN CODE";
  }

  if (res.code) {
    codeWrap.hidden = false;
    $("#result-code").textContent = res.code;
    $("#result-expiry").textContent = res.expiresAt
      ? "Gültig bis " + formatDate(res.expiresAt) + (res.demo ? " · (Demo – noch kein echter Wix-Code)" : "")
      : (res.demo ? "Demo – noch kein echter Wix-Code" : "");
  } else {
    codeWrap.hidden = true;
  }

  note.textContent = res.message || (r.kind === "none"
    ? "Kein Code diesmal – aber du bist für kommende Drops & Aktionen dabei."
    : "Code an der Kasse einlösen. Nur solange gültig – zöger nicht!");

  shopBtn.hidden = false;
}

function headlineFor(pct) {
  if (pct >= 30) return "MADNESS!";
  if (pct >= 20) return "INSANE RUN";
  return "STARKER LAUF";
}

function renderBlocked(msg) {
  $("#result-loading").hidden = true;
  const content = $("#result-content");
  content.hidden = false;
  $("#result-headline").textContent = "SCHON GESPIELT";
  $("#result-prize").classList.add("prize--none");
  $("#prize-value").textContent = "1×";
  $("#prize-label").textContent = "PRO TAG";
  $("#result-code-wrap").hidden = true;
  $("#result-note").textContent = msg || "Komm morgen wieder und versuch dein Glück erneut.";
  $("#btn-again").hidden = true;
  $("#btn-shop").hidden = false;
}

function renderError(msg) {
  $("#result-loading").hidden = true;
  const content = $("#result-content");
  content.hidden = false;
  $("#result-headline").textContent = "HOPPLA";
  $("#prize-value").textContent = "!";
  $("#prize-label").textContent = "FEHLER";
  $("#result-code-wrap").hidden = true;
  $("#result-note").textContent = msg || "Verbindung fehlgeschlagen. Bitte erneut versuchen.";
}

/* ---------- Buttons ---------- */
$("#btn-again").addEventListener("click", () => {
  // Neuer Versuch: zurück zur Intro (Server entscheidet über Tageslimit).
  $("#btn-again").hidden = false;
  $("#controls-hint").classList.remove("controls-hint--hidden");
  show("intro");
});
$("#btn-shop").addEventListener("click", () => navigateTop(CONF.shopUrl));
$("#btn-copy").addEventListener("click", async () => {
  const code = $("#result-code").textContent;
  try { await navigator.clipboard.writeText(code); flash($("#btn-copy"), "Kopiert!"); }
  catch { fallbackCopy(code); flash($("#btn-copy"), "Kopiert!"); }
});

/* ---------- How-to Modal & Legal ---------- */
$(".link-how").addEventListener("click", () => { $("#modal-how").hidden = false; });
$('[data-close="how"]').addEventListener("click", () => { $("#modal-how").hidden = true; });
document.querySelectorAll("[data-legal]").forEach((a) => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    const url = a.dataset.legal === "privacy" ? CONF.privacyUrl : CONF.termsUrl;
    if (url) navigateTop(url);
    else alert(a.dataset.legal === "privacy"
      ? "Datenschutzhinweise: bitte im Shop hinterlegen (window.EDGE_RUN.privacyUrl)."
      : "Teilnahmebedingungen: bitte im Shop hinterlegen (window.EDGE_RUN.termsUrl).");
  });
});

/* ---------- Helfer ---------- */
async function api(path, body) {
  const r = await fetch(CONF.apiBase + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await r.json(); } catch { /* ignore */ }
  if (!("ok" in data)) data.ok = r.ok;
  return data;
}
function navigateTop(url) {
  if (!url) return;
  try { window.top.location.href = url; } catch { window.open(url, "_blank"); }
}
function flash(btn, text) {
  const old = btn.textContent; btn.textContent = text;
  setTimeout(() => (btn.textContent = old), 1400);
}
function fallbackCopy(text) {
  const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta);
  ta.select(); try { document.execCommand("copy"); } catch {} document.body.removeChild(ta);
}
function formatDate(iso) {
  try { return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }); }
  catch { return iso; }
}
function celebrate() {
  const n = 60;
  for (let i = 0; i < n; i++) {
    const d = document.createElement("div");
    d.style.cssText = `position:fixed;top:-10px;left:${Math.random() * 100}vw;width:8px;height:14px;
      background:${["#ff2b2b", "#ffcf4a", "#ffffff"][i % 3]};z-index:99;pointer-events:none;
      transform:rotate(${Math.random() * 360}deg);animation:fall ${1 + Math.random() * 1.5}s linear forwards`;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 2600);
  }
  if (!document.getElementById("confetti-kf")) {
    const st = document.createElement("style"); st.id = "confetti-kf";
    st.textContent = "@keyframes fall{to{top:105vh;transform:translateX(40px) rotate(720deg)}}";
    document.head.appendChild(st);
  }
}

/* ---------- Init ---------- */
(async function init() {
  logoImg = await preloadLogo();
  // Intro-Logo aus SVG lassen (CSS invert); Canvas nutzt logoImg.
  show("intro");
})();
