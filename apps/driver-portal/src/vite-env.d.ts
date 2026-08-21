/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_COGNITO_REGION?: string;
  readonly VITE_COGNITO_USER_POOL_ID?: string;
  readonly VITE_COGNITO_USER_POOL_CLIENT_ID?: string;
  readonly VITE_COGNITO_IDENTITY_POOL_ID?: string;
  readonly VITE_AWS_REGION?: string;
  readonly VITE_LOADS_TABLE_NAME?: string;
  readonly VITE_TRACKING_MESSAGES_TABLE_NAME?: string;
  readonly VITE_DISPATCH_APP_URL?: string;
  readonly VITE_CLIENT_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
