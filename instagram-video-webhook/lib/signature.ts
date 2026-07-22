import crypto from "node:crypto";

/**
 * Verifiziert die X-Hub-Signature-256 des Meta-Webhooks.
 * Meta signiert den ROHEN Request-Body per HMAC-SHA256 mit dem App-Secret.
 * Header-Format: "sha256=<hex>".
 *
 * @param rawBody roher (unparsed) Request-Body als String
 * @param signatureHeader Wert des Headers "x-hub-signature-256"
 * @param appSecret META_APP_SECRET
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined,
): boolean {
  if (!appSecret) {
    // Ohne App-Secret kann nicht verifiziert werden -> ablehnen (fail closed).
    return false;
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");

  const provided = signatureHeader.slice("sha256=".length);

  // Längen müssen für timingSafeEqual übereinstimmen.
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
