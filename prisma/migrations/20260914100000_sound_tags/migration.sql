-- Stimmungs-/Genre-Tags für Sounds: ein globaler, im Dashboard pflegbarer
-- Katalog (SoundTag) plus die je Sparte gewählten Tags (PostZeitplan.soundTags).
-- Pool-Sounds tragen ihre eigenen Tags in trendSounds[].tags; beim Posten
-- kommen nur Sounds infrage, deren Tags zur Sparten-Auswahl passen.

-- Die je Sparte gewählten Tags (Schlüssel aus dem Katalog). Leer = keine
-- Einschränkung.
ALTER TABLE "PostZeitplan" ADD COLUMN "soundTags" JSONB NOT NULL DEFAULT '[]';

-- Der globale Tag-Katalog. Eine gemeinsame Liste für alle vier Sparten.
CREATE TABLE "SoundTag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'stimmung',
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoundTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SoundTag_key_key" ON "SoundTag"("key");

-- Vorschlagsliste: Stimmungen/Energie und ein paar Genres. Der Nutzer kann
-- jederzeit welche hinzufügen oder entfernen; das gilt dann für alle Sparten.
INSERT INTO "SoundTag" ("id", "key", "label", "kind", "sortIndex") VALUES
    ('stag_aggressiv',  'aggressiv',        'Aggressiv',         'stimmung', 0),
    ('stag_hart',       'hart',             'Hart',              'stimmung', 1),
    ('stag_treibend',   'treibend',         'Treibend',          'stimmung', 2),
    ('stag_episch',     'episch',           'Episch',            'stimmung', 3),
    ('stag_dramatisch', 'dramatisch',       'Dramatisch',        'stimmung', 4),
    ('stag_euphorisch', 'euphorisch',       'Euphorisch',        'stimmung', 5),
    ('stag_hype',       'hype',             'Hype',              'stimmung', 6),
    ('stag_groovy',     'groovy',           'Groovy',            'stimmung', 7),
    ('stag_cool',       'cool',             'Cool',              'stimmung', 8),
    ('stag_verspielt',  'verspielt',        'Verspielt',         'stimmung', 9),
    ('stag_chillig',    'chillig',          'Chillig',           'stimmung', 10),
    ('stag_ruhig',      'ruhig',            'Ruhig',             'stimmung', 11),
    ('stag_emotional',  'emotional',        'Emotional',         'stimmung', 12),
    ('stag_duester',    'duester',          'Düster',            'stimmung', 13),
    ('stag_uplifting',  'uplifting',        'Uplifting',         'stimmung', 14),
    ('gtag_hiphop',     'hip-hop-trap',     'Hip-Hop/Trap',      'genre',    100),
    ('gtag_phonk',      'phonk',            'Phonk',             'genre',    101),
    ('gtag_edm',        'edm-house',        'EDM/House',         'genre',    102),
    ('gtag_pop',        'pop',              'Pop',               'genre',    103),
    ('gtag_afro',       'afrobeats-amapiano','Afrobeats/Amapiano','genre',   104),
    ('gtag_latin',      'latin',            'Latin',             'genre',    105),
    ('gtag_rock',       'rock',             'Rock',              'genre',    106),
    ('gtag_cinematic',  'cinematic-score',  'Cinematic/Score',   'genre',    107),
    ('gtag_lofi',       'lo-fi-chill',      'Lo-Fi/Chill',       'genre',    108),
    ('gtag_dnb',        'drum-bass',        'Drum&Bass',         'genre',    109);
