import { generateSigningKeyJwk } from "../src/ucp/keys";

// Prints a private Ed25519 JWK for MERCHANT_SIGNING_JWK. Keep it out of git and out of the client bundle.
console.log(generateSigningKeyJwk());
