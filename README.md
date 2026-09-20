# Boyar Connect

"Build a secure, exclusive matrimonial platform for the Boyar community (srilakshmimangalyamalai.com) with bilingual support (English and Tamil toggle). as a Progressive Web App (PWA). A PWA is the perfect solution because it's a single application that works like a website in a desktop browser but can be "installed" on a phone (both Android and iOS) to look, feel, and function like a native app.

1. Access Control & Admin:
Set up primary admin control for vijayalakshmi@srilakshmimangalyamalai.com with phone numbers +91 7639150271 and +91 9042761438. All other users register as clients.
2. Registration & Profile Fields:
Collect comprehensive client fields including Basic Info (Name, Gender, DOB, Marital Status, Sub-caste, Gothram, Mother Tongue, Height, Weight), Contact details, Education/Career levels, Family Background, and Partner Preferences.
Implement dynamic database-backed dropdowns for Sub-caste, Profession, and Native District where typing a new value automatically saves it to the database table and includes it in the menu for future users.
3. Strict Verification & Onboarding Workflow:
Require mandatory Government ID upload (Aadhaar/PAN/Voter ID/DL) and a clear profile photo during registration.
Integrate AI pre-screening to verify face match between the ID and photo, and check format validity.
If Marital Status is 'Divorced' or 'Widowed', make a court divorce certificate file upload mandatory.
Route all registrations through a mandatory manual admin approval queue. No profile goes live or can browse matches without explicit admin green light.
4. Pricing Tiers & Membership (1-Year Validity Subject to Admin Approval):
Free / Community Starter Tier (₹0): Profile creation, ID upload, browsing, and receiving interests.
Standard Plan (₹2,000): For UG degree holders, uneducated, +2, or 10th-pass members.
Premium Plan (₹5,000): For professional degree holders (Engineering, Medical, Post-graduates, etc.).
Implement manual payment submission via UPI and Card with UTR reference number upload for admin verification.
5. Jathagam (Horoscope) Add-on Service:
Add a 'Request Jathagam' feature priced at ₹500 requiring exact birth details (date, time, place). Link to payment flow and provide an admin panel section to upload verified horoscope PDF reports for client download.
6. Safety, Moderation & Legal Policies:
Include profile bookmarking/shortlisting, 'Block User', and 'Report Profile' buttons routing to the admin dashboard.
Add dedicated legal pages for Terms & Conditions, Privacy Policy, and Cancellation & Refund Policy.
Enforce a strict No Refund Policy stating all subscription payments are final and non-refundable.
Include terms specifying user liability for information accuracy and a legal action clause for payment evasion or breach of contract.
7. Cloud Storage & Client-Side Compression:
Implement a client-side image and document compression utility that optimizes file sizes (using WebP format while preserving crystal-clear original visual quality for photos and IDs) before uploading securely to Cloudflare R2 storage.
Add a 'Storage & Database Monitor' widget to the admin dashboard tracking real-time usage for Cloudflare R2 and Supabase database, displaying a prominent warning banner and alert if storage reaches 90% capacity."
8. Terms & Conditions & Legal Framework (T&C Details)

Strict No-Refund Policy:

Explicitly state that all subscription fees (Standard ₹2,000, Premium ₹5,000) and Jathagam add-on fees (₹500) paid via UPI or Card are strictly non-refundable under any circumstances once processed and accounts/services are activated.

Clarify that fees cover administrative expenses, identity verification, and secure database maintenance which cannot be reversed.

Accuracy of Information & Anti-Fake Liability:

Mandate that all users are legally responsible for the absolute truthfulness of their profile data, government ID scans, photos, and court divorce decrees.

State that submission of fake information, forged documents, or unauthorized photos will result in immediate permanent account termination without refund.

Post-Match Obligations & Right to Legal Action:

Include a binding clause stating that if a client utilizes the platform to find a match and subsequently gets engaged or married while evading applicable fees or attempting to bypass platform records, they remain legally liable for all dues.

Explicitly reserve the right to initiate legal action (including civil recovery suits for breach of contract and legal notices for professional service fee recovery) under Indian law.

Jurisdiction:

Specify that any legal disputes, claims, or proceedings shall be subject strictly to the local courts of jurisdiction in Tamil Nadu.

Mandatory User Consent:

Require every user to check a mandatory consent checkbox agreeing to these Terms & Conditions, Privacy Policy, and No-Refund Policy prior to final registration and payment checkout.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/2e53e0c9-286d-4afc-9a4e-105cc6b3730b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
