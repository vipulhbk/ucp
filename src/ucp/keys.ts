import { createECDH, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, type JsonWebKey, type KeyObject } from "node:crypto";

/**
 * Signing keys (spec: signatures.md → Signature Algorithms, Key Format).
 * ES256 (ECDSA P-256) is the universal baseline every verifier MUST support, so it is the default.
 * Ed25519 (EdDSA) is supported as an optional algorithm, for signing and verifying.
 */
export type SigAlg = "ES256" | "EdDSA";

export interface PublicJwk {
  kid: string;
  kty: "EC" | "OKP";
  crv: "P-256" | "Ed25519";
  x: string;
  y?: string;
  use: "sig";
  alg: SigAlg;
}

export interface SigningKey {
  kid: string;
  alg: SigAlg;
  privateKey: KeyObject;
  publicJwk: PublicJwk;
  /** True when derived from the published demo seed: proves the mechanism, is not secret. */
  isDemoKey: boolean;
}

/** RFC 7638 JWK thumbprint (required members, lexicographic order, no whitespace). */
export function jwkThumbprint(jwk: { kty: string; crv: string; x: string; y?: string }): string {
  const canonical = jwk.kty === "EC" ? `{"crv":"${jwk.crv}","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}` : `{"crv":"${jwk.crv}","kty":"OKP","x":"${jwk.x}"}`;
  return createHash("sha256").update(canonical).digest("base64url");
}

export function algOfJwk(jwk: { kty?: string; crv?: string }): SigAlg | null {
  if (jwk.kty === "EC" && jwk.crv === "P-256") return "ES256";
  if (jwk.kty === "OKP" && jwk.crv === "Ed25519") return "EdDSA";
  return null; // open vocabulary: unsupported keys are skipped, never rejected
}

function publicJwkOf(privateKey: KeyObject): PublicJwk {
  const jwk = createPublicKey(privateKey).export({ format: "jwk" }) as JsonWebKey & { crv: string; x: string; y?: string; kty: string };
  const alg = algOfJwk(jwk);
  if (!alg) throw new Error(`unsupported signing key type ${jwk.kty}/${jwk.crv}`);
  return { kid: jwkThumbprint(jwk), kty: jwk.kty as "EC" | "OKP", crv: jwk.crv as "P-256" | "Ed25519", x: jwk.x, ...(jwk.y ? { y: jwk.y } : {}), use: "sig", alg };
}

function wrap(privateKey: KeyObject, isDemoKey: boolean): SigningKey {
  const publicJwk = publicJwkOf(privateKey);
  return { kid: publicJwk.kid, alg: publicJwk.alg, privateKey, publicJwk, isDemoKey };
}

const seed = (label: string) => createHash("sha256").update(`ucp-playground/${label}`).digest();

/** Deterministic demo ES256 key (fixed, public seed). */
export function demoSigningKey(): SigningKey {
  const d = seed("demo-signing-key/es256/v1");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey(); // 0x04 || X || Y
  const privateKey = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: d.toString("base64url"), x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33, 65).toString("base64url") }, format: "jwk" });
  return wrap(privateKey, true);
}

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** Deterministic demo Ed25519 key, used in tests of the optional EdDSA path. */
export function demoEd25519Key(): SigningKey {
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed("demo-signing-key/ed25519/v1")]), format: "der", type: "pkcs8" });
  return wrap(privateKey, true);
}

/** Load a private JWK (EC P-256 or OKP Ed25519) from a JSON string. */
export function signingKeyFromJwk(json: string): SigningKey {
  const jwk = JSON.parse(json) as { kty?: string; crv?: string; d?: string };
  if (!algOfJwk(jwk) || !jwk.d) throw new Error("MERCHANT_SIGNING_JWK must be a private EC P-256 or OKP Ed25519 JWK (with `d`)");
  return wrap(createPrivateKey({ key: jwk as JsonWebKey, format: "jwk" }), false);
}

/** New throwaway ES256 private JWK, as a JSON string. */
export function generateSigningKeyJwk(): string {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return JSON.stringify(privateKey.export({ format: "jwk" }));
}

export function generateSigningKey(alg: SigAlg = "ES256"): SigningKey {
  const { privateKey } = alg === "ES256" ? generateKeyPairSync("ec", { namedCurve: "P-256" }) : generateKeyPairSync("ed25519");
  return wrap(privateKey, false);
}
