# Bygglogg

En post per PR som förklarar *hur* något är byggt och *varför*: vägen genom koden, valen som gjordes och vad som valdes bort. Den här loggen kompletterar annan dokumentation:

| Dokument | Svarar på |
| --- | --- |
| `docs/funktion/` | Vad gör Petvold, och hur ställs det in? |
| `docs/teknik/` | Hur ser systemet ut just nu? |
| `docs/adr/` | Vilka beslut är svåra att ändra, och varför fattades de? |
| `docs/status.md` | Vad gjordes i varje pass, och vad är nästa steg? |
| **`docs/logg/`** | **Hur implementerades en ändring, steg för steg, och vad är bra att veta när man läser koden?** |

Posterna ändras inte i efterhand. Om något ändras senare skriver den nya PR:en en ny post.

## Mall

Filnamn: `ÅÅÅÅ-MM-DD-kort-namn.md`.

```markdown
# Rubrik (PR #NN)

**Datum:** … **ADR:** … **Moduler:** …

## Vad
En eller två meningar om vad som går att göra nu.

## Hur det fungerar
Vägen genom koden för ett typiskt anrop, från HTTP till databas, med filer och funktioner.

## Val och avvägningar
Varför det blev så, och vad som valdes bort.

## Att känna till
Fallgropar, begränsningar och vad som inte är byggt.

## Filer
De viktigaste filerna.
```

## Poster

Senaste först.

| Datum | Post | PR |
| --- | --- | --- |
| 2026-11-25 | [Pengar, steg 7c: Stripe för kort och Swish](2026-11-25-stripe.md) | #168 |
| 2026-11-25 | [Pengar, steg 7b: bankfiler ut](2026-11-25-bankfiler-ut.md) | #167 |
| 2026-11-25 | [Pengar, steg 7a: bankfiler in](2026-11-25-bankfiler-in.md) | #166 |
| 2026-11-25 | [Gallring av dokument](2026-11-25-gallring-av-dokument.md) | #165 |
| 2026-11-24 | [Besked om kreditnota till kunden](2026-11-24-besked-om-kreditnota.md) | #164 |
| 2026-11-24 | [Betaluppgifter raderas med parten](2026-11-24-betaluppgifter-raderas.md) | #163 |
| 2026-11-24 | [Pengar, steg 8d: bokföringen i back office](2026-11-24-bokforing-i-back-office.md) | #162 |
| 2026-11-24 | [Menyns ordning](2026-11-24-menyns-ordning.md) | #161 |
| 2026-11-24 | [Pengar, steg 8c: betaluppgifter och kliniker i back office](2026-11-24-betaluppgifter-och-kliniker.md) | #160 |
| 2026-11-24 | [Det fladdrande testet för skadans historik](2026-11-24-fladdrande-historik.md) | #159 |
| 2026-11-24 | [Pengar, steg 8b: betalarens konto i back office](2026-11-24-betalarkonto.md) | #158 |
| 2026-11-24 | [Pengar, steg 8a: köerna i back office](2026-11-24-pengar-i-back-office.md) | #157 |
| 2026-11-24 | [Demon kan uppdateras med datan kvar](2026-11-24-demo-roller.md) | #156 |
| 2026-11-24 | [Affärsprocesser för teckning, policy, skada, meddelanden och personuppgifter](2026-11-24-processer.md) | #155 |
| 2026-11-24 | [Systemdokumentation i back office](2026-11-24-systemdokumentation.md) | #154 |
| 2026-11-24 | [Pengar, steg 6b: dagsavslut och kontoplan](2026-11-24-dagsavslut.md) | #153 |
| 2026-11-24 | [Pengar, steg 6a: verifikationer](2026-11-24-verifikationer.md) | #152 |
| 2026-11-23 | [Pengar, steg 5b: kreditnotor och avskrivningar med attest](2026-11-23-kreditnotor-med-attest.md) | #151 |
| 2026-11-23 | [Pengar, steg 5a: tillgodohavanden](2026-11-23-tillgodohavanden.md) | #150 |
| 2026-11-23 | [Pengar, steg 4: obetald premie](2026-11-23-obetald-premie.md) | #149 |
| 2026-11-23 | [Specen för demotjänsten i repot](2026-11-23-demotjanst-spec.md) | #148 |
| 2026-11-23 | [Pengar, steg 3c-2: direktreglering till kliniker](2026-11-23-direktreglering.md) | #147 |
| 2026-11-23 | [Pengar, steg 3c-1: utbetalningar till försäkringstagaren](2026-11-23-utbetalningar.md) | #146 |
| 2026-11-23 | [Pengar, steg 3b: inbetalningar kopplas till fakturorna](2026-11-23-koppling-av-inbetalningar.md) | #145 |
| 2026-11-22 | [Demon på en annan port, med certifikat från DuckDNS](2026-11-22-demo-duckdns.md) | #144 |
| 2026-11-22 | [Demon på en server](2026-11-22-demo-deploy.md) | #143 |
| 2026-11-22 | [Testdata för demon](2026-11-22-demo-testdata.md) | #142 |
| 2026-11-22 | [Demoläget för inloggningen](2026-11-22-demolage-inloggning.md) | #141 |
| 2026-11-22 | [Avbildningar för demon](2026-11-22-avbildningar.md) | #140 |
| 2026-11-22 | [ADR 0041: demon](2026-11-22-adr-0041-demo.md) | #139 |
| 2026-11-22 | [Pengar, steg 3a: inbetalningar och låtsasbanken](2026-11-22-inbetalningar.md) | #138 |
| 2026-11-21 | [Återkallelse av ett avslut mot fakturorna](2026-11-21-aterkallelse.md) | #137 |
| 2026-11-21 | [Ändring, avslut och överlåtelse mot fakturorna](2026-11-21-avrakning-mot-fakturor.md) | #136 |
| 2026-11-21 | [Betalningsintervall vid tecknandet](2026-11-21-betalningsintervall.md) | #135 |
| 2026-11-21 | [Mall för fakturan](2026-11-21-fakturamall.md) | #134 |
| 2026-11-21 | [Pengar, steg 2b-2: fakturan som meddelande](2026-11-21-fakturan-som-meddelande.md) | #133 |
| 2026-11-21 | [Testerna och arbetssättet: egenskapstest för faktureringen och lagens månad](2026-11-21-tester-och-arbetssatt.md) | #132 |
| 2026-11-21 | [Pengar, steg 2b: fakturor, nummerserie och betalningsreferens](2026-11-21-billing-fakturor.md) | #131 |
| 2026-11-21 | [Pengar, steg 2a: betalarkonton och premieplaner](2026-11-21-billing-premieplaner.md) | #130 |
| 2026-11-21 | [Pengar, steg 1: `billing-core`](2026-11-21-billing-core.md) | #129 |
| 2026-11-21 | [Händelsekontraktet: ordningsnummer, källor och ersättningens betydelse](2026-11-21-handelsekontraktet.md) | #128 |
| 2026-11-21 | [ADR 0040: pengar](2026-11-21-adr-0040-pengar.md) | #127 |
| 2026-11-21 | [Produktens och regeluppsättningens sidor enligt designsystemet](2026-11-21-katalogsidorna.md) | #126 |
| 2026-11-21 | [Webhookens sida enligt designsystemet](2026-11-21-webhooksidan.md) | #125 |
| 2026-11-21 | [Meddelandets sida enligt designsystemet](2026-11-21-meddelandesidan.md) | #124 |
| 2026-11-21 | [Ansökans sida enligt designsystemet](2026-11-21-ansokningssidan.md) | #123 |
| 2026-11-21 | [Policysidan enligt designsystemet](2026-11-21-policysidan.md) | #122 |
| 2026-11-21 | [Partens sida: numren bland uppgifterna och djurens försäkring](2026-11-21-partens-sida.md) | #121 |
| 2026-11-21 | [Partens livscykel: sökning på namn, nummer som tas bort, begränsning och avslut](2026-11-21-partens-livscykel.md) | #120 |
| 2026-11-21 | [End-to-end-scenarier för en hel kundresa](2026-11-21-end-to-end-scenarier.md) | #119 |
| 2026-11-21 | [Dokument, steg 4: Petvold gör breven automatiskt](2026-11-21-dokument-steg-4.md) | #118 |
| 2026-11-21 | [Dokument, steg 3: Gotenberg och mallarna](2026-11-21-dokument-steg-3.md) | #117 |
| 2026-11-20 | [Dokument, steg 2: uppladdning och kundens dokument](2026-11-20-dokument-steg-2.md) | #116 |
| 2026-11-20 | [Dokument, steg 1: arkivet och länkarna](2026-11-20-dokument-steg-1.md) | #115 |
| 2026-11-20 | [ADR 0038: dokument, arkiv och länkar](2026-11-20-adr-0038-dokument.md) | #114 |
| 2026-11-20 | [Skadebesked och meddelanden om komplettering](2026-11-20-skadebesked.md) | #113 |
| 2026-11-20 | [dev-all, och djur som redan är försäkrade](2026-11-20-dev-all.md) | #112 |
| 2026-11-20 | [Bilagor som referenser till bolagets arkiv](2026-11-20-bilagor.md) | #111 |
| 2026-11-20 | [Teckna försäkring från kundens sida](2026-11-20-teckna-fran-kund.md) | #110 |
| 2026-11-20 | [Formulär för produkter och skaderegler](2026-11-20-produktformular.md) | #109 |
| 2026-11-20 | [Rättelse av skador med revisioner](2026-11-20-rattelse.md) | #108 |
| 2026-11-20 | [Hur långt fram en policy får börja](2026-11-20-startdag-i-forvag.md) | #107 |
| 2026-11-20 | [Komplettering av skador](2026-11-20-komplettering.md) | #106 |
| 2026-11-19 | [Kön för radering i back office](2026-11-19-radering-i-backoffice.md) | #105 |
| 2026-11-19 | [Ansökan och grupper i back office](2026-11-19-ansokan-och-grupper.md) | #104 |
| 2026-11-19 | [Teckna och ändra policyer i back office](2026-11-19-policyer-i-backoffice.md) | #103 |
| 2026-11-19 | [Djur och kullar i back office](2026-11-19-djur-i-backoffice.md) | #102 |
| 2026-11-19 | [Parter i back office](2026-11-19-parter-i-backoffice.md) | #101 |
| 2026-11-19 | [Schemaändringar med fyra ögon och larm för körningar](2026-11-19-korningar-schema-och-larm.md) | #100 |
| 2026-11-19 | [Körningar i API:t och back office](2026-11-19-korningar-i-backoffice.md) | #99 |
| 2026-11-19 | [Reläet bakom ett lån](2026-11-19-relaet-bakom-lan.md) | #98 |
| 2026-11-19 | [Schemaläggaren och historiken för körningar](2026-11-19-schemalaggaren.md) | #97 |
| 2026-11-18 | [ADR 0037: körningar](2026-11-18-adr-0037-korningar.md) | #96 |
| 2026-11-18 | [Körningar och det som saknas i back office](2026-11-18-inventering-backoffice.md) | #95 |
| 2026-11-18 | [Återkallelse och avvisning av skador](2026-11-18-aterkallelse-och-avvisning.md) | #94 |
| 2026-11-18 | [Skadenummer och id från servern](2026-11-18-skadenummer.md) | #93 |
| 2026-11-17 | [ADR 0036: skadeprocessen](2026-11-17-adr-0036-skadeprocessen.md) | #91 |
| 2026-11-17 | [Registrera skada i back office](2026-11-17-registrera-skada.md) | #90 |
| 2026-11-17 | [Beräkningen och historiken som komponenter](2026-11-17-waterfall-och-logg.md) | #89 |
| 2026-11-16 | [Skadeärendet enligt designsystemet](2026-11-16-backoffice-skadearende.md) | #88 |
| 2026-11-16 | [Toppraden och menyn enligt designsystemet](2026-11-16-backoffice-skal.md) | #87 |
| 2026-11-16 | [Designsystemet Petvold](2026-11-16-designsystem.md) | #86 |
| 2026-11-16 | [Back office, steg 5b: produkter och regler](2026-11-16-backoffice-produkter.md) | #85 |
| 2026-11-16 | [Back office, steg 5a: inställningar](2026-11-16-backoffice-installningar.md) | #84 |
| 2026-11-16 | [Back office, steg 4: meddelanden och webhooks](2026-11-16-backoffice-integration.md) | #83 |
| 2026-11-16 | [Back office, steg 3: policyer och ansökningar](2026-11-16-backoffice-policyer.md) | #82 |
| 2026-11-16 | [Back office, steg 2: beslut, attest och prövning](2026-11-16-backoffice-beslut.md) | #81 |
| 2026-11-16 | [Back office, steg 1: grunden och skadornas köer](2026-11-16-backoffice-grund.md) | #80 |
| 2026-11-16 | [ADR om ett gränssnitt för back office](2026-11-16-backoffice-adr.md) | #79 |
| 2026-11-16 | [Webhooks, steg 3: döda händelser och gallring](2026-11-16-webhooks-steg3.md) | #78 |
| 2026-11-16 | [Webhooks, steg 2: alla händelser och AsyncAPI](2026-11-16-webhooks-steg2.md) | #77 |
| 2026-11-16 | [Webhooks, steg 1](2026-11-16-webhooks.md) | #76 |
| 2026-11-16 | [ADR om händelser till bolagets system](2026-11-16-webhooks-adr.md) | #72 |
| 2026-11-16 | [Genomgång av dokumentationen](2026-11-16-dokumentationsgenomgang.md) | #75 |
| 2026-11-16 | [Adresserna enligt konventionerna](2026-11-16-api-adresser.md) | #74 |
| 2026-11-16 | [Konventioner för API-kontraktet](2026-11-16-api-konventioner.md) | #73 |
| 2026-11-16 | [Bolagets inställningar för meddelanden och erbjudande om överlåtelse](2026-11-16-meddelandeinstallningar.md) | #71 |
| 2026-11-16 | [Kundmeddelanden](2026-11-16-kundmeddelanden.md) | #70 |
| 2026-11-16 | [Produktens dokument och godkännandet](2026-11-16-produktdokument.md) | #69 |
| 2026-11-16 | [ADR om meddelanden och dokument till kunden](2026-11-16-meddelanden-adr.md) | #68 |
| 2026-11-16 | [Manuell prövning av ansökningar](2026-11-16-manuell-provning.md) | #67 |
| 2026-11-16 | [Ansökan med teckningsregler och godkännande](2026-11-16-ansokan.md) | #66 |
| 2026-11-15 | [Teckningsregler och `underwriting-core`](2026-11-15-teckningsregler.md) | #65 |
| 2026-11-15 | [ADR om teckningsregler och ansökan](2026-11-15-teckningsregler-adr.md) | #64 |
| 2026-11-15 | [Inför ett gränssnitt: vem är jag, CORS och exempeldata](2026-11-15-infor-gransnitt.md) | #63 |
| 2026-11-15 | [Listor och sidindelning](2026-11-15-listor.md) | #62 |
| 2026-11-15 | [Drift: kompositionsrot, relä och inloggning](2026-11-15-drift.md) | #61 |
| 2026-11-15 | [Datum i marknadens tidszon](2026-11-15-tidszon.md) | #60 |
| 2026-11-15 | [Granskning av arkitektur och funktion](2026-11-15-granskning.md) | #59 |
| 2026-11-15 | [Priset på policyn](2026-11-15-pris-pa-policyn.md) | #58 |
| 2026-11-15 | [Prisvilkor: rabatter efter grundpriset](2026-11-15-prisvillkor.md) | #57 |
| 2026-11-15 | [Produktens tariff och prisindikation](2026-11-15-prisindikation.md) | #56 |
| 2026-11-15 | [Prisfunktion och tariffer](2026-11-15-prisfunktion.md) | #55 |
| 2026-11-15 | [ADR om tariffen](2026-11-15-tariff-adr.md) | #54 |
| 2026-11-15 | [Policygrupper för kull och hushåll](2026-11-15-grupper.md) | #53 |
| 2026-11-15 | [Ändring av val under termen](2026-11-15-andring.md) | #52 |
| 2026-11-15 | [Gallringen känner till skador](2026-11-15-gallring-skador.md) | #51 |
| 2026-11-15 | [Omprövning av skador när en policyversion ersätts](2026-11-15-omprovning-policy.md) | #50 |
| 2026-11-15 | [Överlåtelse och dödsfall från djurregistrets händelser](2026-11-15-overlatelse.md) | #49 |
| 2026-11-15 | [Förnyelse av policyer](2026-11-15-fornyelse.md) | #48 |
| 2026-11-15 | [Avslut av policyer](2026-11-15-avslut.md) | #47 |
| 2026-11-15 | [Policymodulen: tecknande](2026-11-15-policyer.md) | #46 |
| 2026-11-15 | [ADR om policyns livscykel](2026-11-15-policy-adr.md) | #45 |
| 2026-11-15 | [Nya standardroller till en sparad rollinställning](2026-11-15-roles-sync.md) | #44 |
| 2026-11-15 | [Gallring: lagringstider och gallringskörning](2026-11-15-gallring.md) | #43 |
| 2026-11-15 | [Anonymisering och begränsning av parter](2026-11-15-anonymisering.md) | #42 |
| 2026-11-15 | [ADR om gallring och anonymisering](2026-11-15-gallring-adr.md) | #41 |
| 2026-11-15 | [Kullar i djurregistret](2026-11-15-kullar.md) | #39 |
| 2026-11-15 | [Djurregistret kontrollerar ägaren](2026-11-15-agarkontroll.md) | #38 |
| 2026-11-15 | [Parter: personer och organisationer](2026-11-15-parter.md) | #37 |
| 2026-11-15 | [Dokumentationen och API-specen på GitHub Pages](2026-11-15-dokumentationssajt.md) | #36 |
| 2026-11-15 | [Uppslagning av djur för kliniker](2026-11-15-uppslagning-av-djur.md) | #35 |
| 2026-11-15 | [Djurregister: djur, id-nummer och ägarskap](2026-11-15-djurregister.md) | #34 |
| 2026-11-15 | [Produkter och produktversioner](2026-11-15-produktversioner.md) | #33 |
| 2026-11-15 | [Referensdata: arter, raser och kön](2026-11-15-referensdata.md) | #32 |
