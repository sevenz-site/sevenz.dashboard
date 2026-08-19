// Shared between the client upload UI and the /api/extract route. Kept low
// because Gemini's free tier is rate-limited and photos are processed one at
// a time with spacing between them (see app/api/extract/route.ts) — a bigger
// batch would just make imports take proportionally longer.
export const MAX_IMPORT_PHOTOS = 6;

// Free plan: photos are capped per calendar month (resets on the 1st). Only
// successfully-processed photos count — a failed OCR read doesn't burn quota.
// Pro has no limit.
export const FREE_PLAN_MONTHLY_IMPORT_LIMIT = 5;
