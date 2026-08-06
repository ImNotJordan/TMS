import { configureAmplifyBasics, hasIdentityPoolBasics } from "@titan/aws-client";

/**
 * Ops-console Amplify configure. Delegates to shared @titan/aws-client basics
 * so Cognito setup stays consistent with the driver portal.
 */
export function configureAmplify() {
  configureAmplifyBasics({ warnLabel: "[amplify]" });
}

export function hasIdentityPool() {
  return hasIdentityPoolBasics();
}
