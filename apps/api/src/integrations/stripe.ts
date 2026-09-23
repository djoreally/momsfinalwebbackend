import Stripe from "stripe";

let stripe: Stripe | undefined;

export function getStripe() {
  const rawKey = process.env.STRIPE_SECRET_KEY;
  if (!rawKey) throw new Error("STRIPE_SECRET_KEY is required");
  // Secret stores can accidentally retain surrounding whitespace/newlines.
  // Normalize only surrounding whitespace; never alter the credential itself.
  const key = rawKey.trim();
  if (!/^sk_(test|live)_/.test(key)) throw new Error("STRIPE_SECRET_KEY is malformed");
  stripe ??= new Stripe(key);
  return stripe;
}
