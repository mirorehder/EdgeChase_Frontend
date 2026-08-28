-- Quellordner der Clothing-Sparte. Er stand bei der vorigen Migration noch
-- nicht fest, deshalb kommt er hier nach.
--
-- ON CONFLICT, falls er inzwischen über das Dashboard aufgenommen wurde: dann
-- bleibt der bestehende Eintrag samt Beschreibung und Schaltern unangetastet.
INSERT INTO "SourceFolder" ("id", "driveFolderId", "track", "sortIndex")
VALUES ('quelle-clothing-1', '1MjZhKn6Dlh1DDzQA7IoCsbTMmkVbv7Ns', 'clothing', 0)
ON CONFLICT ("driveFolderId") DO NOTHING;
