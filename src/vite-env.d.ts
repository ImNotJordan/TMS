/// <reference types="vite/client" />
/// <reference types="google.maps" />

interface ImportMetaEnv {
  readonly VITE_AWS_REGION?: string | undefined;
  readonly VITE_COGNITO_REGION?: string | undefined;
  readonly VITE_COGNITO_USER_POOL_ID?: string | undefined;
  readonly VITE_COGNITO_USER_POOL_CLIENT_ID?: string | undefined;
  readonly VITE_COGNITO_IDENTITY_POOL_ID?: string | undefined;

  readonly VITE_PROFILE_TABLE_NAME?: string | undefined;
  readonly VITE_LOADS_TABLE_NAME?: string | undefined;
  readonly VITE_TRUCKS_TABLE_NAME?: string | undefined;
  readonly VITE_RFPS_TABLE_NAME?: string | undefined;
  readonly VITE_QUOTES_TABLE_NAME?: string | undefined;
  readonly VITE_INVOICES_TABLE_NAME?: string | undefined;
  readonly VITE_TRACKING_MESSAGES_TABLE_NAME?: string | undefined;
  readonly VITE_RISK_MODELS_TABLE_NAME?: string | undefined;
  readonly VITE_BIDDING_WORKSPACE_TABLE_NAME?: string | undefined;
  readonly VITE_WORKSPACE_SETTINGS_TABLE_NAME?: string | undefined;
  readonly VITE_CARRIERS_TABLE_NAME?: string | undefined;
  readonly VITE_CRM_ACCOUNTS_TABLE_NAME?: string | undefined;
  readonly VITE_CRM_CONTACTS_TABLE_NAME?: string | undefined;
  readonly VITE_CRM_LEADS_TABLE_NAME?: string | undefined;
  readonly VITE_CRM_ACTIVITIES_TABLE_NAME?: string | undefined;
  readonly VITE_CRM_CAMPAIGNS_TABLE_NAME?: string | undefined;
  readonly VITE_CRM_PROSPECTING_TABLE_NAME?: string | undefined;

  readonly VITE_DRIVER_APP_URL?: string | undefined;
  readonly VITE_DISPATCH_APP_URL?: string | undefined;

  readonly [key: string]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
