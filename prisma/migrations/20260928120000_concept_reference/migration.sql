-- Fremdmaterial aus dem Referenzvideo: manche Konzepte übernehmen einen
-- Ausschnitt des Originals 1:1 (Meme, Filmszene, die im Text beschriebenen
-- Aufnahmen). Dafür behalten wir das kurze Referenzvideo (referenceVideoUrl)
-- und übersteuern das Verhalten bei Bedarf von Hand (foreignMode).

-- Öffentliche Adresse des behaltenen Referenzvideos (Render-Bucket,
-- concept-refs/<id>). NULL = kein Fremdmaterial.
ALTER TABLE "Concept" ADD COLUMN "referenceVideoUrl" TEXT;

-- "auto" folgt der Analyse, "an" erzwingt Fremdmaterial, "aus" verbietet es.
ALTER TABLE "Concept" ADD COLUMN "foreignMode" TEXT NOT NULL DEFAULT 'auto';
