// Generates public/assets/js/config.js from environment variables (Vercel build step).
import { writeFileSync } from "node:fs";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
const domain = process.env.EMAIL_DOMAIN || "gpskg.app";

if (!url || !key) {
  if (process.env.VERCEL) {
    console.error("SUPABASE_URL and SUPABASE_ANON_KEY must be set in Vercel project settings.");
    process.exit(1);
  }
  console.warn("SUPABASE_URL / SUPABASE_ANON_KEY not set; leaving config.js unchanged.");
  process.exit(0);
}

// Safety net: refuse to publish a service-role key into browser code.
try {
  const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
  if (payload.role === "service_role") {
    console.error("Refusing to build: SUPABASE_ANON_KEY is a service-role key. Use the anon/public key.");
    process.exit(1);
  }
} catch { /* new-style publishable keys are not JWTs; that is fine */ }
if (/^sb_secret_/.test(key)) {
  console.error("Refusing to build: that is a secret key. Use the publishable/anon key.");
  process.exit(1);
}

writeFileSync(new URL("../public/assets/js/config.js", import.meta.url),
`export const SUPABASE_URL = ${JSON.stringify(url)};
export const SUPABASE_ANON_KEY = ${JSON.stringify(key)};
export const EMAIL_DOMAIN = ${JSON.stringify(domain)};
`);
console.log("config.js generated.");
