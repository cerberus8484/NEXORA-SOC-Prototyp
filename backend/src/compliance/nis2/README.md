# NIS2 Readiness & Evidence (P_NIS2_1)

**Ehrliche Positionierung — bitte exakt so kommunizieren:**

> Nexora unterstützt die **Dokumentation und Nachweisführung** zu den NIS2-
> Risikomanagement-Maßnahmen. Es ist **kein Konformitätsnachweis, keine
> Zertifizierung und kein Rechtsgutachten.** „NIS2 compliant" / „zertifiziert" /
> „rechtssicher konform" werden bewusst **nirgends** behauptet (im Code per Test
> erzwungen). Der Status `addressed` heißt „Arbeitsstand bearbeitet", **nicht**
> rechtlich konform.

Offizielle Quellen (BSIG §30 / NIS2-Richtlinie Art. 21) gehören als
weiterführende Referenz hierher in die Doku — **nicht** als Gesetzeszitate in
den Code. Die `sourceReference` je Control ist bewusst neutral gehalten.

## Was es ist

- **Statischer, versionierter Control-Katalog** (`nis2ControlCatalog.js`) mit den
  10 Risikomanagement-Maßnahmenbereichen (stabile `key`, deutsche Titel). Keine
  DB-Tabelle für die Definitionen.
- **Assessments** (`nis2_assessments`, eine Bewertung je Control) + **Evidence-
  Links** (`nis2_evidence_links`, mehrere je Assessment).
- Eine Admin/Viewer-Arbeitsansicht unter `/compliance/nis2`.

## Datenmodell

| Objekt | Felder (Kurz) | Status-Enum |
|---|---|---|
| `Nis2Assessment` | controlKey · status · owner · dueDate · notes · lastReviewedAt · created/updated(+By) | `not_started · in_progress · evidence_collected · needs_review · addressed · not_applicable` |
| `Nis2EvidenceLink` | assessmentId · evidenceType · evidenceRef · title · description · capturedAt | evidenceType: `ticket · audit_event · node · integration · gitops_profile · document · external_reference · other` |

Berechnete (nicht gespeicherte) Signale: `overdue`, `missingEvidence`,
`needsReview`. **Ehrlich:** `addressed` **ohne** Evidence ⇒ `needsReview`
(kein vollständiger Nachweis).

`not_applicable` verlangt eine Begründung in `notes`.

## API & RBAC

| Methode | Pfad | Rolle |
|---|---|---|
| GET | `/v1/nis2/controls` (Readiness-Übersicht + Summary) | viewer+ |
| GET | `/v1/nis2/catalog` · `/assessments` · `/assessments/:controlKey` | viewer+ |
| PUT | `/v1/nis2/assessments/:controlKey` | **admin** |
| POST | `/v1/nis2/assessments/:controlKey/evidence` | **admin** |
| DELETE | `/v1/nis2/evidence/:id` | **admin** |

## Sicherheit

- **Keine Secrets als Evidence.** `evidenceRef` wird hart validiert: nur
  http/https, **kein** `user:password@`, **keine** Secret-artigen Query- **oder**
  Fragment-Keys (`token/key/secret/password/bearer/authorization`), kein
  `javascript:/data:/file:/ftp:`-Schema, keine Steuerzeichen in URLs.
- **Keine HTML-Injection** in owner/notes/title/description (`<`/`>` + Steuerzeichen
  abgelehnt; Frontend rendert ohnehin via JSX-Escaping, kein `dangerouslySetInnerHTML`).
- **Audit** (`NIS2_ASSESSMENT_CREATED/UPDATED`, `NIS2_STATUS_CHANGED`,
  `NIS2_EVIDENCE_LINKED/REMOVED`) speichert **nur** sichere Metadaten
  (controlKey, ids, evidenceType, status/owner before/after) — **nie** notes,
  evidenceRef, Titel/Beschreibung oder URLs.

## Persistenz

InMemory (Dev/Test) bzw. Postgres (`DB_ENABLED`) über `nis2RepositoryFactory`.
Migration `036_nis2.sql` (läuft beim API-Boot). Evidence hat FK auf das
Assessment mit `ON DELETE CASCADE`.
