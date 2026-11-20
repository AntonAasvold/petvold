# Skadebesked och meddelanden om komplettering (PR #113)

**Datum:** 2026-11-20 **ADR:** 0032, 0036 (steg 6) **Moduler:** communications, api, apps/backoffice

## Vad
- Varje beslut i ett skadeärende blir ett skadebesked till försäkringstagaren.
- En begäran om komplettering till kunden blir ett meddelande, och likaså dess påminnelse och utgång. Meddelandet om utgång går att stänga av.
- Hela skadeprocessen före utbetalning är byggd.

## Hur det fungerar
1. **Reläet:** skadornas källa i `composition.ts` gör om händelsen med `claimsEventForNotices` och anropar `CommunicationsService.handleClaimEvent`, före webhooks.
2. **`planClaim`** läser beslutet eller begäran genom porten `ClaimSource`.
   - **Mottagaren** är försäkringstagaren på första behandlingsdagen, från policyns versioner.
   - **En begäran till kliniken** ger inget meddelande.
3. **`make`** tillämpar lagrum, förval och inställningar som för policyernas meddelanden, och sparar meddelandet med händelsens id som unik nyckel. En upprepad händelse ger därför inget nytt meddelande.
4. **`claimSource`** i `wiring.ts` bygger skadebeskedet av `getClaim` och `explainDecision`, och begäran av `getInformationRequests`. I kompositionsroten skapas meddelandemodulen före skademotorn, så porten läser skademotorn först när en händelse kommer.
5. **Back office:**
   - Typerna har namn.
   - Inställningarna kan stänga av meddelandet om utgång.
   - Ärendets historik visar meddelandena om ärendet. Meddelandena listas per policy och filtreras på `content.claimId`.

## Val och avvägningar
- **Skadebeskedet kräver bolagets text om prövning,** som avslaget på en ansökan. Utan texten hamnar beskedet i kön för en person.
- **Lagrummen:** FAL 7 kap. 1 § och dataskyddsförordningen artikel 22.3. En hänvisning till Finansinspektionens allmänna råd om klagomål valdes bort, eftersom det inte gick att bekräfta vilka regler som gäller nu. Ett lagrum som visas för kunden måste stämma.
- **Begäran och påminnelsen krävs.** Fristen på en månad börjar först när kunden har lämnat det som begärts, och kunden måste få veta vad det är. Utgången krävs inte, som beslutat i ADR 0036.
- **Inget nytt fält för ärendet på meddelandet.** Skadans id finns i innehållet, och meddelandet har policyns id. Ett eget fält för skador i lagringen kan komma om köerna behöver filtrera på det.

## Att känna till
- **Inga meddelanden i efterhand:** beslut och begäranden från före den här ändringen ger inga meddelanden, eftersom reläet redan har publicerat deras händelser.
- **Exempeldatan:** skadebesken hamnar i kön tills bolagets text om prövning finns i inställningarna.
- **En lokal databas med sparad rollinställning** behöver `npm run roles:sync -- --apply`, annars saknar handläggaren `notices:read` och ser inte meddelandena.

## Filer
- `modules/communications/src/index.ts`, `test/communications-service.test.ts`
- `db/migrations/0045_communications_claim_notices.sql` (ny), `db/test/claims-schema.test.ts`
- `modules/api/src/wiring.ts`, `src/composition.ts`, `src/app.ts`, `openapi.yaml`, `test/composition.test.ts`, `test/notices.test.ts`
- `apps/backoffice/src/history.ts`, `src/views/claim-detail.ts`, `src/views/labels.ts`, `src/views/settings-view.ts`, `src/locales/sv.ts`, `e2e/register.spec.ts`, `e2e/decisions.spec.ts`
