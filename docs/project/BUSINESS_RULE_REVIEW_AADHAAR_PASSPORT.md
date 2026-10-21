# Aadhaar / Passport requirement conflict — deferred review

Recorded 21 October 2026; documentation only, no implementation changes.

The user explicitly reaffirmed the approved requirement:
- Indian residents: Aadhaar is mandatory.
- Residents abroad: Passport is mandatory.

The supplied Windows snapshot's RegisterWizard.tsx uses
MANDATORY_DOCUMENT_KINDS and accepts any permitted Indian identity-document kind
as the primary requirement. Its comments describe India as "any one of five".
The snapshot residency.ts re-exports that mapping from screening.ts.
This conflicts with the user's reaffirmed Aadhaar requirement.

The approved requirement above governs the later review. Do not infer approval
for the broader rule from the snapshot or from passing tests. Review both client
and server enforcement, tests and wording in a separate scoped operation.
Any required visible UI change must be reviewed under the existing UI freeze.

Current operation changed no registration, authentication, document requirement,
UI, server authorization or business logic. Conflict remains OPEN / DEFERRED.
