# E2E Verification Report — Upload / Gallery / Lookup / i18n

**Project:** srilakshmangalyamalai (boyar-bond-forge)
**Environment:** local dev server (Port 5173) against production Supabase project `sxpkutjkqfekqwpabgrk` (org `yetkdwpfyiskirwqmqgl`), R2 bucket `srilakshmimangalyamalai`
**Date:** 2026-09-22
**Result:** **PASS — 85 checks / 85 passed (0 failed)**

Live browser tests were driven end-to-end through the real UI and server functions
(no mocking). All test users, profiles, documents, and R2 uploads created by the
suite were purged afterwards; real member data was verified untouched (9 member
documents, 17 profiles, 8 auth users remain — 0 e2e.* accounts).

---

## 1. Schema / seed migration

Migration `supabase/migrations/20260922100000_seed_gothram_mother_tongue_lookup.sql` applied to production.

| lookup_options category | rows | values |
|---|---|---|
| gothram | 6 | Dhandu Kulam, Eecham Kulam, Karumbu Kulam, Mudda Kulam, Uppu Kulam, Vembu Kulam |
| mother_tongue | 5 | English, Hindi, Kannada, Tamil, Telugu |
| occupation | 7 | Agriculture, Business, Doctor, Engineer, Government Employee, Other, Teacher |

Dropdowns verified to include `Other` (used for free-text entry). No test data was
written to `lookup_options` — lists remain pristine.

## 2. Phase results (all on one clean sequential run)

| Phase | Checks | Result |
|---|---|---|
| phaseSetup (accounts) | 5 | PASS |
| phaseWizard (A/B lookups + H dashboard) | 17 | PASS |
| phaseEdit (A/B/C custom values + strict partial-text) | 8 | PASS |
| phaseGallery (D add/reject/optimize/delete) | 15 | PASS |
| phaseDocs (E/F docs list + limits) | 15 | PASS |
| phaseStorage (F guards + bytes) | 3 | PASS |
| phaseSecurity (G RLS/privacy) | 7 | PASS |
| phaseLanguage (EN/TA) | 11 | PASS |
| phaseCleanup (purge + verify) | 4 | PASS |
| **Total** | **85** | **PASS** |

### Key behaviors verified

- **Lookup selects (RegisterWizard & Edit)** — options render (`Other` first), selection commits; custom values committed and persisted (`My Gothram`, `Konkani`, `Tailor`); a partially-typed father-occupation (`o`) is NOT stored (strict commit on pick).
- **Dashboard "My profile" (H)** — pending-status banner, member name, gothram, mother tongue, primary photo, Photo Gallery + Documents & Verification sections, photo count (1/6) and aadhaar doc, all rendered from freshly submitted data.
- **Photo gallery (D)** — starts 0/6 ✓; PNG/JPG/big add (1→2→3); >3 MB rejected with message; corrupt image rejected; 6 max reached; 7th rejected; delete frees count with toast.
- **Photo optimization** — 2,692,071 B photo auto-compressed to 367,616 B (WebP) before upload.
- **Documents (E/F)** — PNG/JPG converted to WebP (96 KB each), PDFs pass through size-untouched; owner can open every private doc (HTTP 200 via signed URL); docs listed under Documents & Verification, not in the photo gallery (and photos not in docs); 5th doc rejected at the 4-document limit (`UPLOAD_LIMIT_DOCS`).
- **Storage limits (F)** — server guard rejects uploads past 20 MB (`UPLOAD_LIMIT_STORAGE`); 11th file rejected at the 10-file cap (`UPLOAD_LIMIT_TOTAL`); deleting a file releases bytes in the UI ("17.9 MB / 20.0 MB → 17.8 MB / 20.0 MB").
- **Privacy / RLS (G)** — an unrelated member reads 0 owner documents; documents and profiles return nothing anonymously; the public profile payload exposes no document data; a stranger is denied `createViewUrl` ("Not allowed"); an admin can securely view private documents (200).
- **i18n (EN/TA)** — both languages fully translate gallery, documents, storage-hint and pending-status strings on `/ta/dashboard` with no English leakage.

## 3. Build & static checks

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS (exit 0) |
| `npm run build` | PASS (exit 0) |
| `git diff --check` | PASS (whitespace clean) |
| `git status` | 14 modified + 1 untracked (seed migration); `package.json`/`package-lock.json` unmodified |

## 4. Observations (out of scope, not blocking)

- `public.profiles` has **no FK to `auth.users`**, so deleting a user orphans its
  profile row (no cascade). The cleanup phase deletes these explicitly. Consider a
  `ON DELETE CASCADE` FK in a future migration if member deletion becomes a feature.
- Private R2 endpoints send no CORS headers; signed GET URLs work in `<img>`/downloads
  and Node clients, but a browser `fetch()` of a signed URL is blocked. App behavior
  is unaffected.

## 5. Files changed in this feature

- `src/lib/compress.ts`, `src/lib/upload.ts`, `src/lib/storage.functions.ts`, `src/lib/i18n.tsx`, `src/lib/format.ts`, `src/lib/admin-data.ts`
- `src/components/LookupSelect.tsx`, `src/components/TimeInput.tsx`, `src/components/pages/RegisterWizard.tsx`, `src/components/pages/DashboardPage.tsx`, `src/components/pages/JathagamAdminPage.tsx`, `src/components/pages/admin/AdminJathagamRequests.tsx`, `src/components/admin/CreateClientProfileDialog.tsx`, `src/components/admin/ProfileReviewDialog.tsx`
- `supabase/migrations/20260922100000_seed_gothram_mother_tongue_lookup.sql` (untracked, applied)