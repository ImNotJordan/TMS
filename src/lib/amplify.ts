import { Amplify } from "aws-amplify";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { defaultStorage } from "aws-amplify/utils";

const region = import.meta.env.VITE_COGNITO_REGION as string | undefined;
const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined;
const userPoolClientId = import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID as string | undefined;
const identityPoolId = import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID as string | undefined;

let configured = false;

export function configureAmplify() {
  if (configured) return;
  if (typeof window === "undefined") return;

  if (!region || !userPoolId || !userPoolClientId) {
    console.warn(
      "[amplify] Cognito env vars are missing. Set VITE_COGNITO_REGION, VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_USER_POOL_CLIENT_ID in your .env file.",
    );
    return;
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        ...(identityPoolId
          ? { identityPoolId, allowGuestAccess: false }
          : {}),
        signUpVerificationMethod: "code",
        loginWith: {
          email: true,
          username: false,
        },
      },
    },
  });

  cognitoUserPoolsTokenProvider.setKeyValueStorage(defaultStorage);

  configured = true;
}

export function hasIdentityPool() {
  return Boolean(identityPoolId);
}
