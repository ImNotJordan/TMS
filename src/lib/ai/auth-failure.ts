/**
 * Shared auth failure type for server request authentication.
 *
 * Lives in its own module so the JWT verifier and the credential exchange can
 * both throw it without importing each other.
 */
export type CognitoRequestAuthError =
  | "missing_token"
  | "invalid_token"
  | "misconfigured"
  | "credentials_failed"
  | "expired_token";

export class CognitoRequestAuthFailure extends Error {
  readonly code: CognitoRequestAuthError;

  constructor(code: CognitoRequestAuthError, message: string) {
    super(message);
    this.name = "CognitoRequestAuthFailure";
    this.code = code;
  }
}
