import { beforeEach, describe, expect, it } from "vitest";

import { CognitoRequestAuthFailure } from "@/lib/ai/auth-failure";
import { resetJwksCacheForTests, verifyCognitoJwt } from "@/lib/ai/verify-cognito-jwt";

const USER_POOL_ID = "us-east-1_TestPool";
const CLIENT_ID = "test-client-id";
const ISSUER = `https://cognito-idp.us-east-1.amazonaws.com/${USER_POOL_ID}`;
const KID = "test-kid-1";
const NOW = 1_800_000_000;

function b64url(bytes: Uint8Array | string): string {
  const binary =
    typeof bytes === "string" ? bytes : Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

let keyPair: CryptoKeyPair;
let publicJwk: JsonWebKey;

async function makeToken(options?: {
  header?: Record<string, unknown>;
  claims?: Record<string, unknown>;
  signWith?: CryptoKey;
  tamper?: boolean;
}): Promise<string> {
  const header = { alg: "RS256", kid: KID, ...options?.header };
  const claims = {
    sub: "user-123",
    iss: ISSUER,
    aud: CLIENT_ID,
    token_use: "id",
    iat: NOW - 60,
    exp: NOW + 3600,
    ...options?.claims,
  };
  const signingInput = `${encodeJson(header)}.${encodeJson(claims)}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      options?.signWith ?? keyPair.privateKey,
      new TextEncoder().encode(signingInput),
    ),
  );
  if (options?.tamper) signature[0] ^= 0xff;
  return `${signingInput}.${b64url(signature)}`;
}

/** Serves the generated public key as a Cognito-shaped JWKS document. */
const jwksFetch = (async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input.toString();
  if (!url.endsWith("/.well-known/jwks.json")) {
    throw new Error(`unexpected fetch: ${url}`);
  }
  return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: KID, use: "sig" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as unknown as typeof fetch;

const baseOptions = {
  tokenUse: "id" as const,
  userPoolId: USER_POOL_ID,
  clientId: CLIENT_ID,
  nowSec: NOW,
  fetchImpl: jwksFetch,
};

async function expectRejected(token: string, options = baseOptions) {
  await expect(verifyCognitoJwt(token, options)).rejects.toBeInstanceOf(CognitoRequestAuthFailure);
}

beforeEach(async () => {
  resetJwksCacheForTests();
  if (!keyPair) {
    keyPair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  }
});

describe("verifyCognitoJwt", () => {
  it("accepts a correctly signed ID token", async () => {
    const claims = await verifyCognitoJwt(await makeToken(), baseOptions);
    expect(claims.sub).toBe("user-123");
    expect(claims.iss).toBe(ISSUER);
  });

  it("passes through non-standard claims for downstream authorization", async () => {
    const claims = await verifyCognitoJwt(
      await makeToken({ claims: { "custom:role": "Admin" } }),
      baseOptions,
    );
    expect(claims["custom:role"]).toBe("Admin");
  });

  // Algorithm confusion: the historic way to turn a public key into a shared secret.
  it("rejects alg: none", async () => {
    const header = encodeJson({ alg: "none", kid: KID });
    const payload = encodeJson({ sub: "attacker", iss: ISSUER, aud: CLIENT_ID });
    await expectRejected(`${header}.${payload}.`);
  });

  it("rejects HS256 where RS256 is expected", async () => {
    const header = encodeJson({ alg: "HS256", kid: KID });
    const payload = encodeJson({
      sub: "attacker",
      iss: ISSUER,
      aud: CLIENT_ID,
      token_use: "id",
      iat: NOW,
      exp: NOW + 3600,
    });
    await expectRejected(`${header}.${payload}.c2ln`);
  });

  it("rejects a tampered signature", async () => {
    await expectRejected(await makeToken({ tamper: true }));
  });

  it("rejects a token signed by a different key", async () => {
    const rogue = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    await expectRejected(await makeToken({ signWith: rogue.privateKey }));
  });

  it("rejects an unknown kid", async () => {
    await expectRejected(await makeToken({ header: { kid: "not-in-jwks" } }));
  });

  it("rejects a missing kid", async () => {
    const header = encodeJson({ alg: "RS256" });
    const payload = encodeJson({ sub: "a", iss: ISSUER, aud: CLIENT_ID });
    await expectRejected(`${header}.${payload}.c2ln`);
  });

  it("rejects a foreign issuer", async () => {
    await expectRejected(
      await makeToken({
        claims: { iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Other" },
      }),
    );
  });

  // A suffix check would pass this; an exact comparison must not.
  it("rejects an issuer that merely ends with the pool id", async () => {
    await expectRejected(
      await makeToken({ claims: { iss: `https://evil.example.com/${USER_POOL_ID}` } }),
    );
  });

  it("rejects a token minted for another app client", async () => {
    await expectRejected(await makeToken({ claims: { aud: "some-other-client" } }));
  });

  it("rejects an access token where an ID token is expected", async () => {
    await expectRejected(
      await makeToken({ claims: { token_use: "access", client_id: CLIENT_ID } }),
    );
  });

  it("rejects an expired token", async () => {
    await expectRejected(await makeToken({ claims: { exp: NOW - 3600 } }));
  });

  it("rejects a token issued in the future", async () => {
    await expectRejected(await makeToken({ claims: { iat: NOW + 3600 } }));
  });

  it("rejects a not-yet-valid token", async () => {
    await expectRejected(await makeToken({ claims: { nbf: NOW + 3600 } }));
  });

  it("rejects a malformed token", async () => {
    await expectRejected("not.a.jwt");
    await expectRejected("onlyonepart");
  });

  // A JWKS outage must deny, never degrade to accepting unverified claims.
  it("denies when the JWKS endpoint is unavailable", async () => {
    const failing = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expectRejected(await makeToken(), { ...baseOptions, fetchImpl: failing });
  });

  it("fails closed when the pool is not configured", async () => {
    await expect(
      verifyCognitoJwt(await makeToken(), {
        ...baseOptions,
        userPoolId: undefined,
        clientId: undefined,
      }),
    ).rejects.toBeInstanceOf(CognitoRequestAuthFailure);
  });

  it("serves repeat verifications from the JWKS cache", async () => {
    let calls = 0;
    const counting = (async (input: string | URL | Request) => {
      calls += 1;
      return jwksFetch(input as string);
    }) as unknown as typeof fetch;

    const options = { ...baseOptions, fetchImpl: counting };
    await verifyCognitoJwt(await makeToken(), options);
    await verifyCognitoJwt(await makeToken(), options);
    expect(calls).toBe(1);
  });
});
