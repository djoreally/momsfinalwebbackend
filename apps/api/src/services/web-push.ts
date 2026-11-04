import {
  createCipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign as cryptoSign,
  type JsonWebKeyInput,
  type KeyObject,
} from "node:crypto";

/**
 * Minimal Web Push sender — RFC 8291 (aes128gcm payload encryption)
 * and RFC 8292 (VAPID) — built only on Node's built-in crypto.
 * No npm dependency.
 *
 * Why this file exists: the `web-push` package is CommonJS, and its
 * vapid helper performs a dynamic `require("crypto")`. Under Vercel's
 * ESM bundling that require becomes a shim that throws
 * `Dynamic require of "crypto" is not supported` at module load,
 * which crashed EVERY route in the function (production outage
 * 2026-11-04; PR #24 emergency-reverted by PR #26). Lazy-importing
 * the package only moves the same throw to the first send. Push
 * sending is a small amount of standard cryptography, so the backend
 * owns it here and the fragile dependency is gone for good.
 *
 * Error contract mirrors the old library: an HTTP failure throws an
 * Error carrying a `statusCode` property, which the delivery engine
 * in services/notifications.ts reads to unsubscribe dead endpoints
 * (404/410).
 */

export interface WebPushVapidKeys {
  /** Base64url VAPID public key: 65-byte uncompressed P-256 point. */
  publicKey: string;
  /** Base64url VAPID private key: 32-byte P-256 scalar. */
  privateKey: string;
  /** VAPID "sub" claim, e.g. "mailto:support@momsoilchange.com". */
  subject: string;
}

export interface WebPushSubscription {
  endpoint: string;
  keys: {
    /** Base64url subscriber public key: 65-byte uncompressed point. */
    p256dh: string;
    /** Base64url subscriber auth secret (16 bytes). */
    auth: string;
  };
}

const b64urlToBuffer = (value: string): Buffer => Buffer.from(value, "base64url");
const bufferToB64url = (value: Buffer): string => value.toString("base64url");

/** Split a 65-byte uncompressed P-256 point (0x04 || X || Y) into JWK coordinates. */
function pointToJwk(point: Buffer): { x: string; y: string } {
  if (point.length !== 65 || point[0] !== 0x04) throw new Error("invalid_p256_point");
  return {
    x: bufferToB64url(point.subarray(1, 33)),
    y: bufferToB64url(point.subarray(33, 65)),
  };
}

function publicKeyObject(point: Buffer): KeyObject {
  return createPublicKey({
    format: "jwk",
    key: { kty: "EC", crv: "P-256", ...pointToJwk(point) },
  } as JsonWebKeyInput);
}

function vapidPrivateKeyObject(vapid: WebPushVapidKeys): KeyObject {
  return createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      ...pointToJwk(b64urlToBuffer(vapid.publicKey)),
      d: bufferToB64url(b64urlToBuffer(vapid.privateKey)),
    },
  } as JsonWebKeyInput);
}

/** RFC 8292: the `vapid` Authorization header value (ES256 JWT + public key). */
function vapidAuthorization(endpoint: string, vapid: WebPushVapidKeys): string {
  const encode = (obj: unknown) => bufferToB64url(Buffer.from(JSON.stringify(obj)));
  const signingInput = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: vapid.subject,
  })}`;
  const signature = cryptoSign("sha256", Buffer.from(signingInput), {
    key: vapidPrivateKeyObject(vapid),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${signingInput}.${bufferToB64url(signature)}, k=${vapid.publicKey}`;
}

/** RFC 8291 §3.4 + RFC 8188: frame and encrypt one aes128gcm message. */
function encryptPayload(payload: string, subscription: WebPushSubscription): Buffer {
  const uaPublic = b64urlToBuffer(subscription.keys.p256dh);
  const authSecret = b64urlToBuffer(subscription.keys.auth);

  // One ephemeral application-server key pair per message.
  const serverKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const serverJwk = serverKeys.publicKey.export({ format: "jwk" });
  if (!serverJwk.x || !serverJwk.y) throw new Error("invalid_server_key");
  const asPublic = Buffer.concat([
    Buffer.from([0x04]),
    b64urlToBuffer(serverJwk.x),
    b64urlToBuffer(serverJwk.y),
  ]);

  const sharedSecret = diffieHellman({
    privateKey: serverKeys.privateKey,
    publicKey: publicKeyObject(uaPublic),
  });

  const salt = randomBytes(16);
  // IKM: HKDF with the auth secret as the salt, keyed by the ECDH
  // secret, with the WebPush info string binding both public keys.
  const ikm = Buffer.from(hkdfSync(
    "sha256",
    sharedSecret,
    authSecret,
    Buffer.concat([Buffer.from("WebPush: info\0", "utf8"), uaPublic, asPublic]),
    32,
  ));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12));

  // A single, final record: payload bytes followed by the 0x02 delimiter.
  const plaintext = Buffer.concat([Buffer.from(payload, "utf8"), Buffer.from([0x02])]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  // aes128gcm header: salt (16) || record size (uint32 BE) || keyid length || keyid.
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ciphertext]);
}

/**
 * Encrypt and POST one push message. Resolves on any 2xx from the
 * push service; throws (with `statusCode` on HTTP failures) otherwise.
 */
export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: string,
  vapid: WebPushVapidKeys,
  options: { ttlSeconds?: number } = {},
): Promise<void> {
  const body = encryptPayload(payload, subscription);
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Authorization": vapidAuthorization(subscription.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": String(options.ttlSeconds ?? 2419200),
    },
    body: new Uint8Array(body),
  });
  if (response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    return;
  }
  const detail = await response.text().catch(() => "");
  const error = new Error(
    `web_push_http_${response.status}${detail ? `:${detail.slice(0, 200)}` : ""}`,
  ) as Error & { statusCode?: number };
  error.statusCode = response.status;
  throw error;
}
