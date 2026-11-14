# 0021. Produktkatalog och regeluppsättningar

- Status: Beslutad
- Datum: 2026-11-14

## Sammanhang

Skademotorn läser i dag produktens skaderegler från exempeldata i koden (`StaticRulesPort`). ADR 0018 bestämmer att regler är versionerad data i modulen `decisioning`. Reglerna har livscykeln utkast, granskning, publicerad och avvecklad, och publicering kräver fyra ögon. Roadmapen för M2 har dessutom en produktkatalog med versionerade produktpaket och referensdata (arter, raser, kön) med översättningar.

Kvar att bestämma:

- Vad som hör till produkten och vad som hör till reglerna.
- Hur en skada hittar rätt regler.
- I vilken ordning delarna byggs.

## Beslut

**1. Två moduler med var sitt ansvar.**

| Modul | Äger | Frågan den svarar på |
| --- | --- | --- |
| `decisioning` | Regeluppsättningar: `ClaimsRules` och vilken beräkningsmodell som används | Hur bedöms en skada? |
| `catalog` | Produkter och produktversioner (moment, villkorsalternativ, säljperiod), referensdata med översättningar | Vad kan säljas, och med vilka val? |

- Produktversionen pekar på en *regelserie*, till exempel `SE-HUND-VV`. Den pekar inte på en enskild regelversion.
- Policyns villkor (försäkringsbelopp, självrisk, karenstid) kommer från produktens alternativ när policyn tecknas (M3 och M4), och ligger sedan på policyn som i dag.

**2. Regeluppsättningar är versioner i en serie, och de gäller från ett datum.**
- En version har innehållet (`ClaimsRules` utom versionsfältet), beräkningsmodellen, ett datum den gäller från (`effectiveFrom`) och en kontrollsumma (sha256 över innehållet).
- **Livscykel:** `draft → in_review → published → retired`.
  - Ett utkast kan ändras.
  - Granskning låser innehållet.
  - Publicering kräver en annan person än den som skickade till granskning (ADR 0016 och 0019).
  - En publicerad version ändras aldrig. Den kan bara avvecklas.
- **Rätt regler för en skada:** den publicerade version i serien som gäller på behandlingsdatumet, det vill säga senaste `effectiveFrom` som inte ligger efter behandlingsdatumet. Avvecklade versioner används inte för nya bedömningar.
- **Ett gammalt beslut** behåller sina regler i underlaget (ADR 0018). Omräkning använder alltid det sparade underlaget.
- **Kontrollsumman** följer med i reglerna (`rulesChecksum`) och ingår därmed i `inputHash`.
- `rulesVersion` blir `<serie>@<version>`, till exempel `SE-HUND-VV@3`.

**3. Simulering före publicering.** Ett utkast kan köras mot sparade underlag i en period, utan att något sparas. Svaret visar vilka beslut som hade ändrats och hur mycket (ADR 0018). Simuleringen byggs efter livscykeln.

**4. Ordning.**
1. `decisioning`: regelserier och versioner med livscykel, API och Postgres, och en `RulesPort` som läser publicerade versioner. Skademotorn byter från exempeldata till modulen.
2. Simulering av utkast.
3. `catalog`: referensdata med översättningar, produkter och produktversioner med säljperiod och villkorsalternativ.
4. `assess` och `calculate` flyttas till `decisioning-core` (ADR 0018), när katalogen och policymodulen behöver dem utanför skademotorn.

## Konsekvenser

- Att ändra en regel, till exempel att lägga till en diagnoskod i en grupp eller sänka `autoSettleMax`, blir ett utkast som granskas och publiceras, utan ny kod.
- En ny regelversion påverkar bara skador med behandlingsdatum från dess `effectiveFrom`. En skada som redan är bedömd men inte beslutad bedöms om med de regler som gäller på behandlingsdatumet.
- Publicerade versioner och deras kontrollsummor går att granska i efterhand.
- Beräkningen är fortfarande kod. Ett utkast kan bara välja en beräkningsmodell som finns i `CALCULATION_MODELS`.
- En ny databasroll, `decisioning_service`.

## Alternativ

- **Regelversionen bunden till produktversionen:** varje regeländring skulle kräva en ny produktversion och nya policyer. Regler ändras oftare än produkter.
- **Regler som fritt uttrycksspråk (till exempel DMN eller JSON-logik):** kraftfullt men svårt att granska och testa. Parametrar räcker för det motorn behöver i dag (ADR 0018).
- **En modul för katalog och regler:** mindre att bygga, men olika ägare (produktteam och skadeteam) och olika takt.

## Källor

- OMG, *Decision Model and Notation (DMN) 1.5*, om versionerade beslutsmodeller (valt bort för innehållet, men samma livscykeltanke). omg.org/dmn
- NIST SP 800-53 Rev. 5, CM-3 *Configuration Change Control* och AC-5 *Separation of Duties*. csrc.nist.gov
- ADR 0001, 0016, 0018 och 0019.
