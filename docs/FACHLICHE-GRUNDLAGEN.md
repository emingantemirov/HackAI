# Fachliche Grundlagen und offene Punkte

Alle Aussagen stammen aus den mitgelieferten Quellen (`sources/`). Das Portal erfindet keine Regeln, Felddefinitionen, Hersteller-Schnittstellen oder Zertifizierungsbefugnisse.

## Umgesetzte Regel (Abgabegrund 41, DBVO)
Kalendermonate; festes Tagesdatum im Testkontext; Rückwärtsverkettung von AU-Zeiten; 12-Monats-Fenster; offenes AU-Ende wird mit Tagesdatum + 7 Tagen angesetzt; Kriterien-IDs der vier Originalkriterien werden übernommen. Dokumentversion (13.1) und Datensatzversion (13) werden getrennt geführt.

## Klärungsvorgänge (7)
Das Portal entscheidet sie nicht still; betroffene Soll-Ergebnisse bleiben „Klärung erforderlich“, bis eine berechtigte Person entscheidet.

1. Sechsmonatsgrenze: „nicht mehr als 6 Monate“ (ergänzende Kriterien) vs. „nicht mindestens 6 Monate vergangen“ (Erläuterung).
2. Papier-AU im Jahr der Anfrage: Auslegung des Szenarios.
3. Rückmeldung (61) vs. Storno (88) im Mehrschritt-Szenario.
4. Zeitstempel (Februar-Beispiel): Bewertung von DATUM-ERSTELLUNG.
5. EFZ-Berechnung im Szenario (dokumentierte Erwartungswerte, keine allgemeine Regel).
6. Zeichenkodierung der EEL-Datei – in den Quellen nicht festgelegt; die Beispieldatei enthält U+FFFD-Ersatzzeichen (gültiges UTF-8, Information bereits verloren).
7. Feld „Beschäftigungsende“: „am“ oder „zum“.

## Nicht bekannt (nur als Rohdaten geführt)
Aufbau von DBNA/DBAP, VOSZ/DSKO/NCSZ. Ein Lexware-Adapter existiert nicht; das Profil steht auf „Noch nicht konfiguriert“.

## Mehrstufiges Szenario
Aus den Hinweisen zur Testkonstellation: AG 41 → KK 61 (Kennzeichen 4) → AG 01 (EFZ-Ende 30.03.2026) → KK korrigiert 61 → AG 88 Storno → AG 01 (EFZ-Ende 27.03.2026) → KK 62 (Ende EEL 31.03.2026, Grund 99); AZVU 1234-5678-007. Es ist ein dokumentiertes Szenario, keine allgemeine Regel.
