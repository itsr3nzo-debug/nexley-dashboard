/**
 * Centralized Integration Provider Registry.
 *
 * Two sources combine into the final PROVIDERS list:
 *   1. CURATED (below) — hand-tuned entries with specific descriptions,
 *      icon colors, and category assignments. ~22 providers our customers
 *      care about most.
 *   2. AUTO from composio-registry.json — every other Composio-managed
 *      toolkit (~100 more), categorized automatically.
 *
 * OAuth routes look up via getComposioProvider() in lib/composio.ts.
 */

import composioRegistry from './composio-registry.json'

export interface ProviderOAuthConfig {
  authUrl: string
  tokenUrl: string
  userinfoUrl?: string
  revokeUrl?: string
  scopes: string
  clientIdEnv: string
  clientSecretEnv: string
}

export type ProviderCategory =
  | 'communication'
  | 'scheduling'
  | 'accounting'
  | 'documents'
  | 'practice'
  | 'tax'
  | 'reporting'
  | 'crm'
  | 'payments'
  | 'productivity'
  | 'social'
  | 'storage'
  | 'meetings'
  | 'marketing'
  | 'support'
  | 'devtools'
  | 'data'
  | 'other'

export interface ProviderPATConfig {
  // For integrations that use a Personal Access Token (pasted by the user) instead of OAuth.
  // The user clicks Connect → we show a modal asking for the token → we store it encrypted.
  tokenName: string // e.g., "Fergus API key" shown in the UI
  helpUrl: string // link to the provider's docs on how to generate the PAT
  placeholder?: string // placeholder text for the input
  validateUrl?: string // if set, we GET this (with Authorization: Bearer <token>) to validate before saving
}

export interface CompoundPatField {
  // One field in a compound credential form (e.g. WordPress = siteUrl + username + appPassword).
  key: string                       // form field key (used in API request body)
  label: string                     // human label
  placeholder?: string
  type?: 'text' | 'url' | 'password' | 'email'
  helpText?: string                 // shown beneath the input
  validate?: 'url' | 'email' | 'username' | 'wp_app_password' | 'hostname'  // client-side regex check before submit
}

export interface ProviderCompoundPatConfig {
  // Multi-field credential form. Custom validation handler at /api/integrations/{providerId}.
  // Compound creds get JSON-encoded then encrypted into integrations.access_token_enc.
  fields: CompoundPatField[]
  helpUrl: string                   // primary "how do I get these creds" link
  validateEndpoint: string          // e.g. '/api/integrations/wordpress' — POST validates + saves
}

export interface ProviderConfig {
  id: string
  name: string
  description: string
  category: ProviderCategory
  iconColor: string // tailwind dark-mode classes
  iconUrl?: string // path to brand SVG in /public/integrations/
  available: boolean // true = OAuth wired, false = "Coming Soon"
  oauth?: ProviderOAuthConfig
  pat?: ProviderPATConfig // alternative auth mode — pasted token
  compoundPat?: ProviderCompoundPatConfig // multi-field credential form (e.g. WordPress)
  customOAuth?: boolean // OAuth not handled by Composio — use direct flow at /api/oauth/{id}
  customPage?: string // dashboard page path for setup-wizard providers (e.g. iCloud Bridge)
  createsDualRows?: string[] // e.g., Google creates ['gmail', 'google_calendar']
  oauthProvider?: string // if this row maps to a different OAuth provider (e.g., gmail → google)
  recommendedForTrades?: boolean // surface in "Recommended for Trades" section
}

export const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'accounting', label: 'Accounting' },
  { id: 'communication', label: 'Communication' },
  { id: 'scheduling', label: 'Scheduling' },
  { id: 'crm', label: 'CRM' },
  { id: 'documents', label: 'Documents' },
  { id: 'storage', label: 'File Storage' },
  { id: 'meetings', label: 'Meetings & Video' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'social', label: 'Social' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'support', label: 'Customer Support' },
  { id: 'practice', label: 'Practice Management' },
  { id: 'tax', label: 'Tax & Compliance' },
  { id: 'reporting', label: 'Reporting' },
  { id: 'payments', label: 'Payments' },
  { id: 'devtools', label: 'Developer Tools' },
  { id: 'data', label: 'Data & Analytics' },
  { id: 'other', label: 'Other' },
]

const CURATED_PROVIDERS: ProviderConfig[] = [
  // ═══ Communication ═══
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read and send emails on behalf of the client',
    category: 'communication',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
    recommendedForTrades: true,
  },
  {
    id: 'outlook',
    name: 'Outlook',
    description: 'Microsoft 365 email — read, send, and manage emails',
    category: 'communication',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Send updates and alerts to Slack channels',
    category: 'communication',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
    oauth: {
      authUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      userinfoUrl: 'https://slack.com/api/auth.test',
      revokeUrl: 'https://slack.com/api/auth.revoke',
      scopes: 'chat:write channels:read users:read',
      clientIdEnv: 'SLACK_CLIENT_ID',
      clientSecretEnv: 'SLACK_CLIENT_SECRET',
    },
  },
  {
    id: 'microsoft_teams',
    name: 'Microsoft Teams',
    description: 'Team messaging, channels, and collaboration',
    category: 'communication',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
  },

  // ═══ Scheduling ═══
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    description: 'Sync appointments and book jobs automatically',
    category: 'scheduling',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
    recommendedForTrades: true,
  },
  {
    id: 'calendly',
    name: 'Calendly',
    description: 'Client booking and appointment scheduling',
    category: 'scheduling',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
    oauth: {
      authUrl: 'https://auth.calendly.com/oauth/authorize',
      tokenUrl: 'https://auth.calendly.com/oauth/token',
      userinfoUrl: 'https://api.calendly.com/users/me',
      scopes: 'default',
      clientIdEnv: 'CALENDLY_CLIENT_ID',
      clientSecretEnv: 'CALENDLY_CLIENT_SECRET',
    },
  },
  {
    id: 'outlook_calendar',
    name: 'Outlook Calendar',
    description: 'Microsoft 365 calendar — sync appointments automatically',
    category: 'scheduling',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
    oauthProvider: 'outlook',
  },

  // ═══ Accounting ═══
  {
    id: 'xero',
    name: 'Xero',
    description: 'Invoices, contacts, bank reconciliation, VAT/CIS — Nexley drafts, you approve',
    category: 'accounting',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
    recommendedForTrades: true,
    oauth: {
      authUrl: 'https://login.xero.com/identity/connect/authorize',
      tokenUrl: 'https://identity.xero.com/connect/token',
      userinfoUrl: 'https://api.xero.com/connections',
      revokeUrl: 'https://identity.xero.com/connect/revocation',
      // GRANULAR scopes — required for apps created after 2 Mar 2026 (Nexley's
      // Xero app was registered 2026-04-17, so we're on the new-granular system).
      // The older broad scopes `accounting.transactions.read` and
      // `accounting.reports.read` are REJECTED by Xero's OAuth as
      // "unauthorized_client / Invalid scope" for post-Mar-2026 apps — they
      // must be split into the specific granular scopes below.
      //
      // Verified against Xero docs 2026-04-20 (developer.xero.com/documentation/guides/oauth2/scopes):
      //   ✅ accounting.contacts                     — contact CRUD
      //   ✅ accounting.invoices                     — invoice CRUD (read included)
      //   ✅ accounting.payments                     — payment CRUD
      //   ✅ accounting.banktransactions.read        — bank transactions (replaces part of transactions.read)
      //   ✅ accounting.settings.read                — chart of accounts, items, tax rates, currencies
      //   ✅ accounting.reports.aged.read            — aged receivables/payables (chase-overdue skill)
      //   ✅ accounting.reports.profitandloss.read   — P&L (monthly brief)
      //   ✅ accounting.reports.balancesheet.read    — BS
      //   ✅ accounting.reports.trialbalance.read    — TB
      //   ✅ accounting.reports.taxreports.read      — VAT return (MTD)
      //   ✅ offline_access                          — refresh tokens
      // Existing clients who authorised before this change must reconnect to
      // pick up the new scope set (Xero consent screen re-prompts).
      scopes: 'openid profile email accounting.contacts accounting.invoices accounting.payments accounting.banktransactions.read accounting.settings.read accounting.reports.aged.read accounting.reports.profitandloss.read accounting.reports.balancesheet.read accounting.reports.trialbalance.read accounting.reports.taxreports.read offline_access',
      clientIdEnv: 'XERO_CLIENT_ID',
      clientSecretEnv: 'XERO_CLIENT_SECRET',
    },
  },
  {
    // Fergus now offers self-serve PATs (shipped 2025). Path in Fergus web app:
    // Settings (gear) → Integrations → Fergus API → Generate PAT → Copy.
    // Help article: https://help.fergus.com/en/articles/14605426-fergus-api-personal-access-tokens-pats
    id: 'fergus',
    name: 'Fergus',
    description: 'Trade job management — push captured jobs from WhatsApp straight to your Fergus board',
    category: 'practice',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
    recommendedForTrades: true,
    pat: {
      tokenName: 'Fergus Personal Access Token',
      helpUrl: 'https://help.fergus.com/en/articles/14605426-fergus-api-personal-access-tokens-pats',
      placeholder: 'Paste PAT from Fergus → Settings → Integrations → Fergus API',
      validateUrl: 'https://api.fergus.com/users',
    },
  },
  {
    // Dext is intentionally routed through Xero instead of being a direct
    // integration. Reason: Dext's public API is partner-gated (sales-led,
    // uncertain approval). ~80% of what trades customers want Dext for
    // (total supplier spend, bills by supplier) is readable via Xero Bills
    // because Dext auto-syncs everything to Xero. Tile exists so customers
    // see the coverage story — clicking it just points them at Xero.
    id: 'dext',
    name: 'Dext (via Xero)',
    description: 'Supplier receipts + spend analysis. Connect Xero → Dext already syncs to it → Nexley reads your bills.',
    category: 'accounting',
    iconColor: 'bg-muted text-muted-foreground',
    available: false, // rendered as info-only tile, not clickable for connection
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    description: 'Accounting, invoicing, and expense tracking',
    category: 'accounting',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
    oauth: {
      authUrl: 'https://appcenter.intuit.com/connect/oauth2',
      tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      userinfoUrl: 'https://accounts.platform.intuit.com/v1/openid_connect/userinfo',
      revokeUrl: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
      scopes: 'com.intuit.quickbooks.accounting openid profile email',
      clientIdEnv: 'QUICKBOOKS_CLIENT_ID',
      clientSecretEnv: 'QUICKBOOKS_CLIENT_SECRET',
    },
  },
  {
    id: 'sage',
    name: 'Sage',
    description: 'Business accounting and financial management',
    category: 'accounting',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
    oauth: {
      authUrl: 'https://www.sageone.com/oauth2/auth/central?filter=apiv3.1',
      tokenUrl: 'https://oauth.accounting.sage.com/token',
      userinfoUrl: 'https://api.accounting.sage.com/v3.1/user',
      scopes: 'full_access',
      clientIdEnv: 'SAGE_CLIENT_ID',
      clientSecretEnv: 'SAGE_CLIENT_SECRET',
    },
  },
  {
    id: 'freeagent',
    name: 'FreeAgent',
    description: 'Freelancer accounting, invoicing, and expenses',
    category: 'accounting',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
    oauth: {
      authUrl: 'https://api.freeagent.com/v2/approve_app',
      tokenUrl: 'https://api.freeagent.com/v2/token_endpoint',
      userinfoUrl: 'https://api.freeagent.com/v2/users/me',
      scopes: '',
      clientIdEnv: 'FREEAGENT_CLIENT_ID',
      clientSecretEnv: 'FREEAGENT_CLIENT_SECRET',
    },
  },

  // ═══ Document Processing ═══
  {
    id: 'google_drive',
    name: 'Google Drive',
    description: 'Access and manage files in Google Drive',
    category: 'documents',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
  },
  {
    id: 'one_drive',
    name: 'OneDrive',
    description: 'Microsoft 365 cloud storage — access and manage files',
    category: 'storage',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
  },
  {
    id: 'share_point',
    name: 'SharePoint',
    description: 'Microsoft 365 team sites and document libraries',
    category: 'documents',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
  },
  // (Dext removed here — the canonical Dext entry above at the Accounting
  // section is "Dext (via Xero)" with the explanatory copy. Having two `dext`
  // entries caused React-key duplicate warnings in the modal grid. Audit
  // round 3 finding M1, 2026-05-01.)
  {
    id: 'hubdoc',
    name: 'HubDoc',
    description: 'Automated document collection for Xero',
    category: 'documents',
    iconColor: 'bg-muted text-muted-foreground',
    available: false,
  },

  // ═══ Practice Management ═══
  {
    id: 'ignition',
    name: 'Ignition',
    description: 'Client proposals, engagement letters, and billing',
    category: 'practice',
    iconColor: 'bg-muted text-muted-foreground',
    available: false,
  },
  {
    id: 'brightmanager',
    name: 'BrightManager',
    description: 'Practice management and workflow',
    category: 'practice',
    iconColor: 'bg-muted text-muted-foreground',
    available: false,
  },
  {
    id: 'pixie',
    name: 'Pixie',
    description: 'Simple workflow management for smaller firms',
    category: 'practice',
    iconColor: 'bg-muted text-muted-foreground',
    available: false,
  },

  // ═══ Tax & Compliance ═══
  {
    id: 'taxcalc',
    name: 'TaxCalc',
    description: 'Tax return preparation and filing',
    category: 'tax',
    iconColor: 'bg-muted text-muted-foreground',
    available: false,
  },
  {
    id: 'iris',
    name: 'Iris',
    description: 'Statutory accounts and tax compliance',
    category: 'tax',
    iconColor: 'bg-muted text-muted-foreground',
    available: false,
  },

  // ═══ Reporting ═══
  {
    id: 'fathom',
    name: 'Fathom',
    description: 'Visual financial reporting and analysis',
    category: 'reporting',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
  },
  {
    id: 'spotlight',
    name: 'Spotlight Reporting',
    description: 'Forecasting and management reporting',
    category: 'reporting',
    iconColor: 'bg-muted text-muted-foreground',
    available: false,
  },

  // ═══ CRM ═══
  {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'Marketing, sales CRM, and service desk',
    category: 'crm',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
    oauth: {
      authUrl: 'https://app.hubspot.com/oauth/authorize',
      tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
      userinfoUrl: 'https://api.hubapi.com/oauth/v1/access-tokens/',
      revokeUrl: 'https://api.hubapi.com/oauth/v1/refresh-tokens/',
      scopes: 'crm.objects.contacts.read crm.objects.contacts.write crm.objects.deals.read',
      clientIdEnv: 'HUBSPOT_CLIENT_ID',
      clientSecretEnv: 'HUBSPOT_CLIENT_SECRET',
    },
  },

  // ═══ Payments ═══
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Payment processing and subscription billing',
    category: 'payments',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
    recommendedForTrades: true,
  },

  // ═══ Marketing / Web — custom-built (not Composio) ═══
  {
    // WordPress — connects via the customer's WP REST API + Application Password.
    // Composio doesn't have a WordPress toolkit (verified Apr 2026 against the
    // 1032-toolkit catalog), so we ship our own MCP adapter on the VPS.
    // Auth: compound credentials (site URL + bot username + app password) so the
    // owner can mint a dedicated `nexley_bot` Editor-role user instead of giving
    // us their admin login. App passwords created in WP-Admin → Profile.
    id: 'wordpress',
    name: 'WordPress',
    description: 'Publish blog posts, update pages, upload media on your WordPress site',
    category: 'marketing',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
    recommendedForTrades: true,
    compoundPat: {
      validateEndpoint: '/api/integrations/wordpress',
      helpUrl: 'https://wordpress.org/documentation/article/application-passwords/',
      fields: [
        {
          key: 'siteUrl',
          label: 'Site URL',
          placeholder: 'https://yoursite.co.uk',
          type: 'url',
          validate: 'url',
          helpText: 'Your full WordPress site URL (https://...)',
        },
        {
          key: 'username',
          label: 'Bot username',
          placeholder: 'nexley_bot',
          type: 'text',
          validate: 'username',
          helpText: 'A dedicated WP user (Editor role recommended, not Administrator)',
        },
        {
          key: 'appPassword',
          label: 'Application password',
          placeholder: 'xxxx xxxx xxxx xxxx xxxx xxxx',
          type: 'password',
          validate: 'wp_app_password',
          helpText: 'Create at WP-Admin → Users → Profile → Application Passwords',
        },
      ],
    },
  },

  // ═══ Marketing — Google Business Profile (custom OAuth) ═══
  {
    // Google Business Profile (formerly Google My Business). Composio has no
    // toolkit for this. Requires (a) listing verified ≥60 days, (b) Google
    // OAuth verification of the `business.manage` sensitive scope (1-4 weeks),
    // (c) Standard API Access form approved (1-3 weeks).
    //
    // Until verification clears, integration sits in `blocked_external` status
    // with `expected_ready_at` showing the customer when it'll come online.
    id: 'google_business_profile',
    name: 'Google Business Profile',
    description: 'Post updates, reply to reviews, manage hours on your Google listing',
    category: 'marketing',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
    customOAuth: true,
    recommendedForTrades: true,
  },

  // ═══ Email — generic IMAP/SMTP (covers HostGator, Bluehost, Namecheap,
  //     IONOS, Krystal, 123-reg, and any standard email host) ═══
  {
    // The customer's email is hosted on something running standard IMAP/SMTP.
    // For a HostGator-hosted domain `ckbuilding.co.uk` the IMAP server is
    // typically `mail.ckbuilding.co.uk:993` (SSL) and SMTP `:465` (SSL) — same
    // for most cPanel-style hosts. Auth is the email-account password (NOT
    // the cPanel login). 2FA users issue an app-specific password.
    //
    // Composio has no generic IMAP toolkit. This is a custom build with
    // imapflow + nodemailer running on the VPS adapter.
    id: 'hostgator_email',
    name: 'Email (IMAP/SMTP)',
    description: 'Read inbox + draft replies for your business email (works with HostGator, Bluehost, Namecheap, any IMAP host)',
    category: 'communication',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
    recommendedForTrades: true,
    compoundPat: {
      validateEndpoint: '/api/integrations/email-imap',
      helpUrl: 'https://www.hostgator.com/help/article/email-server-settings',
      fields: [
        {
          key: 'emailAddress',
          label: 'Email address',
          placeholder: 'info@ckbuilding.co.uk',
          type: 'email',
          validate: 'email',
          helpText: 'The full email address (e.g. info@yourbusiness.co.uk)',
        },
        {
          key: 'password',
          label: 'Email password',
          placeholder: '••••••••',
          type: 'password',
          helpText: 'The password for THIS email account (not your cPanel/HostGator login). 2FA users: use an app-specific password.',
        },
        {
          key: 'imapHost',
          label: 'IMAP server (optional)',
          placeholder: 'auto-detect from email domain',
          type: 'text',
          validate: 'hostname',
          helpText: 'Leave blank to auto-derive (mail.{your-domain}). Override if HostGator gave you a different hostname.',
        },
      ],
    },
  },

  // ═══ Salon Booking System (WordPress plugin) ═══
  {
    // Salon Booking System is a WordPress plugin. We talk to it via its REST
    // API at /wp-json/salon/api/v1, which requires the plugin's "Pro" version
    // (free version has no API). Auth: a plugin-issued API key the owner
    // generates inside the plugin's settings, separate from WordPress
    // application passwords. We expose it as a separate integration from
    // WordPress because the API surface is plugin-specific (services,
    // appointments, availability, customers).
    //
    // Composio has zero SBS support. Custom build.
    id: 'salon_booking_system',
    name: 'Salon Booking System',
    description: 'Manage appointment bookings on your WordPress site (Salon Booking System Pro)',
    category: 'scheduling',
    iconColor: 'bg-muted text-muted-foreground',
    available: true,
    recommendedForTrades: true,
    compoundPat: {
      validateEndpoint: '/api/integrations/salon-booking-system',
      helpUrl: 'https://www.salonbookingsystem.com/salon-booking-system-restful-api/',
      fields: [
        {
          key: 'siteUrl',
          label: 'WordPress site URL',
          placeholder: 'https://yoursite.co.uk',
          type: 'url',
          validate: 'url',
          helpText: 'The same WordPress site where Salon Booking System Pro is installed',
        },
        {
          key: 'apiKey',
          label: 'Plugin API key',
          placeholder: 'Generated in WP-Admin → Salon → Settings → API',
          type: 'password',
          helpText: 'Generate inside the Salon Booking System Pro plugin: WP-Admin → Salon → Settings → API → Generate Key',
        },
      ],
    },
  },

  // ═══ HeyReach — LinkedIn outreach add-on ═══
  {
    // HeyReach handles the LinkedIn flows Composio's API doesn't expose:
    // connection requests, autonomous engagement on prospect posts, message
    // inbox. The AI Employee orchestrates via HeyReach's MCP server (official
    // Claude integration). The owner connects their LinkedIn inside HeyReach
    // (once), then sequences run on warmed cloud sessions — much lower ban
    // risk than DIY browser automation.
    //
    // Cost on Nexley side: $79/mo Starter for 3 LinkedIn senders, or $199/mo
    // Business for unlimited. We recharge each connected client.
    //
    // Compound credentials: API key + MCP server URL (one per HeyReach
    // workspace). The watcher writes these to /opt/clients/{slug}/integrations/
    // heyreach.json and run-loop.sh sources HEYREACH_API_KEY before spawning
    // Claude Code so the HeyReach MCP server (in .mcp.json) can authenticate.
    // HeyReach handles the LinkedIn flows Composio's API doesn't expose:
    // connection requests, autonomous engagement on prospect posts, LinkedIn
    // inbox. Connected via the official HeyReach remote MCP server (npx
    // mcp-remote bridge) + direct REST fallback via X-API-KEY.
    //
    // Backend ready 2026-05-11:
    //   - /api/integrations/heyreach route validates against api.heyreach.io/api/public/auth/CheckApiKey
    //   - custom-integrations-watcher tracks 'heyreach' + auto-restarts claude-whatsapp on connect
    //   - run-loop.sh sources HEYREACH_API_KEY + HEYREACH_MCP_URL before spawning Claude Code
    //   - .mcp.json template includes `heyreach` MCP server entry with env-var expansion
    //   - linkedin-strategy.md skill documents tools + warming schedule + fallback REST
    //
    // Cost: $59-79/sender/mo (HeyReach Growth plan, per-sender pricing).
    id: 'heyreach',
    name: 'HeyReach — LinkedIn outreach',
    description: 'LinkedIn connection requests, prospect engagement, and inbox replies on autopilot',
    category: 'marketing',
    iconColor: 'bg-muted text-muted-foreground',
    iconUrl: '/integrations/heyreach.svg',
    available: true,
    recommendedForTrades: false,
    compoundPat: {
      validateEndpoint: '/api/integrations/heyreach',
      // Points at the HeyReach Integrations + API collection — covers API-key,
      // MCP-server, and webhook setup all in one place. Linked from the
      // "How do I get these?" link at the top of the modal.
      helpUrl: 'https://help.heyreach.io/en/collections/10421873-integrations-api',
      fields: [
        {
          key: 'apiKey',
          label: 'HeyReach API key',
          placeholder: 'Paste the value from HeyReach',
          type: 'password',
          helpText: 'Need a HeyReach account first — sign up at heyreach.io (Growth plan, 1 sender) and connect your LinkedIn inside HeyReach. Then: open Integrations & API → HeyReach API → "Create new API key" → name it Nexley → paste the value here. Full walkthrough at the "How do I get these?" link above.',
        },
        {
          key: 'mcpUrl',
          label: 'HeyReach MCP URL',
          placeholder: 'https://api.heyreach.io/mcp/...',
          type: 'url',
          validate: 'url',
          helpText: 'On the same Integrations & API page in HeyReach: open the HeyReach MCP Server section → "New MCP Key" → name it Nexley → copy the URL (starts with https://api.heyreach.io/mcp/).',
        },
      ],
    },
  },

  // ═══ File Storage — iCloud Bridge ═══
  {
    // iCloud Bridge — read/write the customer's iCloud Drive, Photos, Notes, and
    // Apple Shortcuts via a small service installed on a Mac in their office.
    // Apple has no public API; the bridge runs on a Mac signed into iCloud
    // and exposes REST over Tailscale + HMAC. Setup needs ~30 min of Zoom
    // screen-share on first install (concierge) OR ~10 clicks self-serve.
    id: 'icloud_bridge',
    name: 'iCloud',
    description: 'Read your iCloud Drive, Photos, Notes, and run Apple Shortcuts (requires a Mac)',
    category: 'storage',
    iconColor: 'bg-muted text-muted-foreground',
    iconUrl: '/integrations/icloud-bridge.svg',
    available: true,
    customPage: '/integrations/icloud-bridge',
    recommendedForTrades: true,
  },
]

// ═══ Auto-generated providers from Composio registry ═══
// Every Composio-managed toolkit not already in CURATED_PROVIDERS
// becomes a provider entry, categorized from the toolkit's metadata.

type ComposioRegistryEntry = { authConfigId: string; name: string; categories: string[] }
const REGISTRY = composioRegistry as Record<string, ComposioRegistryEntry>

// Map dashboard provider IDs to Composio toolkit slugs (mismatches only).
// Used by the dedupe loop below to suppress the auto-generated AUTO_PROVIDERS
// tile when a curated provider already exists for that slug.
//
// 2026-05-01: added `calcom: 'cal'` to suppress Composio's `cal` toolkit, which
// otherwise renders as a SECOND scheduling tile next to our custom Cal.com one
// — and would route through Composio's flow instead of our direct OAuth handler.
// Devil's-advocate review caught this. Pre-emptively listed wordpress + GBP too
// in case Composio adds them later; they're zero-impact today since neither slug
// exists in the current Composio catalog.
const PROVIDER_TO_TOOLKIT: Record<string, string> = {
  google_calendar: 'googlecalendar',
  google_drive: 'googledrive',
  wordpress: 'wordpress',
  google_business_profile: 'google_business_profile',
}

// Composio toolkits we DO NOT want to auto-render as tiles (no curated entry,
// not via PROVIDER_TO_TOOLKIT either). Use this when we explicitly DON'T offer
// an integration but Composio's catalog includes it. Keeps the modal clean.
//
// 2026-05-01: `cal` suppressed because Cal.com was scope-corrected out (user
// originally asked for Salon Booking System, not Cal.com).
const SUPPRESSED_AUTO_TOOLKITS = new Set<string>([
  'cal',
])

// Reverse: toolkit slug → curated provider ID
const TOOLKIT_TO_CURATED_ID = new Map<string, string>()
for (const p of CURATED_PROVIDERS) {
  const toolkitSlug = PROVIDER_TO_TOOLKIT[p.id] || p.id
  TOOLKIT_TO_CURATED_ID.set(toolkitSlug, p.id)
}

// Categorize a Composio toolkit by inspecting its first category string
function categorizeFromComposio(rawCats: string[]): ProviderCategory {
  const c = (rawCats[0] || '').toLowerCase()
  if (c.includes('crm') || c.includes('contact')) return 'crm'
  if (c.includes('accounting') || c.includes('invoice')) return 'accounting'
  if (c.includes('email') && c.includes('newsletter')) return 'marketing'
  if (c === 'email') return 'communication'
  if (c.includes('chat') || c.includes('communication') || c.includes('messaging')) return 'communication'
  if (c.includes('phone') || c.includes('sms')) return 'communication'
  if (c.includes('calendar') || c.includes('scheduling') || c.includes('booking')) return 'scheduling'
  if (c.includes('file') || c.includes('storage')) return 'storage'
  if (c.includes('document') || c.includes('signature') || c.includes('docs')) return 'documents'
  if (c.includes('video') || c.includes('meeting') || c.includes('conference')) return 'meetings'
  if (c.includes('social media') || c.includes('social')) return 'social'
  if (c.includes('marketing') || c.includes('ads')) return 'marketing'
  if (c.includes('support') || c.includes('helpdesk') || c.includes('customer')) return 'support'
  if (c.includes('developer') || c.includes('devtools')) return 'devtools'
  if (c.includes('database') || c.includes('analytics') || c.includes('intelligence') || c.includes('data')) return 'data'
  if (c.includes('payment')) return 'payments'
  if (c.includes('project') || c.includes('task') || c.includes('productivity') || c.includes('notes') || c.includes('spreadsheet')) return 'productivity'
  return 'other'
}

// All categories collapse to a single muted neutral fallback tile. The
// previous 18-colour rainbow was visible most strongly in the Add
// Integration modal where it lit up like a fruit machine. Logos do the
// brand-recognition work; the fallback letter tile only renders when the
// SVG fails to load — and at that point a subtle gray is what's wanted.
// Fallback letter-tile for any provider without a brand SVG. The square
// stays muted so it doesn't fight the icon row, but the LETTER inside
// uses `text-foreground` for real contrast — earlier `text-muted-foreground`
// + `bg-muted` left the letter virtually invisible (DA flagged).
const CATEGORY_NEUTRAL = 'bg-muted text-foreground'
const CATEGORY_COLORS: Record<ProviderCategory, string> = {
  communication: CATEGORY_NEUTRAL,
  scheduling:    CATEGORY_NEUTRAL,
  accounting:    CATEGORY_NEUTRAL,
  documents:     CATEGORY_NEUTRAL,
  storage:       CATEGORY_NEUTRAL,
  meetings:      CATEGORY_NEUTRAL,
  social:        CATEGORY_NEUTRAL,
  marketing:     CATEGORY_NEUTRAL,
  support:       CATEGORY_NEUTRAL,
  crm:           CATEGORY_NEUTRAL,
  productivity:  CATEGORY_NEUTRAL,
  payments:      CATEGORY_NEUTRAL,
  practice:      CATEGORY_NEUTRAL,
  tax:           CATEGORY_NEUTRAL,
  reporting:     CATEGORY_NEUTRAL,
  devtools:      CATEGORY_NEUTRAL,
  data:          CATEGORY_NEUTRAL,
  other:         CATEGORY_NEUTRAL,
}

const AUTO_PROVIDERS: ProviderConfig[] = []
for (const [slug, entry] of Object.entries(REGISTRY)) {
  if (TOOLKIT_TO_CURATED_ID.has(slug)) continue // already curated
  if (SUPPRESSED_AUTO_TOOLKITS.has(slug)) continue // explicitly suppressed
  const category = categorizeFromComposio(entry.categories)
  AUTO_PROVIDERS.push({
    id: slug,
    name: entry.name,
    description: entry.categories.slice(0, 2).join(' · ') || 'Composio integration',
    category,
    iconColor: CATEGORY_COLORS[category],
    available: true,
  })
}

// Brand icons: every provider now has an SVG in /public/integrations/{id}.svg
// Curated providers with underscored IDs need hyphen mapping for filenames.
const CURATED_ICON_OVERRIDES: Record<string, string> = {
  microsoft_teams: 'microsoft-teams', google_calendar: 'google-calendar',
  outlook_calendar: 'outlook-calendar', google_drive: 'google-drive',
  icloud_bridge: 'icloud-bridge',
}

function applyIcons(providers: ProviderConfig[]): ProviderConfig[] {
  return providers.map(p => {
    const iconFile = CURATED_ICON_OVERRIDES[p.id] || p.id
    return { ...p, iconUrl: `/integrations/${iconFile}.svg` }
  })
}

export const PROVIDERS: ProviderConfig[] = [
  ...applyIcons(CURATED_PROVIDERS),
  ...applyIcons(AUTO_PROVIDERS).sort((a, b) => a.name.localeCompare(b.name)),
]

// ═══ Google OAuth (special case — one flow, two integration rows) ═══
export const GOOGLE_OAUTH_CONFIG: ProviderOAuthConfig = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userinfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email openid',
  clientIdEnv: 'GOOGLE_CLIENT_ID',
  clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
}

// ═══ Helpers ═══

export function getProvider(id: string): ProviderConfig | undefined {
  return PROVIDERS.find(p => p.id === id)
}

export function getOAuthConfig(providerId: string): ProviderOAuthConfig | undefined {
  const provider = getProvider(providerId)
  if (!provider) return undefined

  // Google suite shares one OAuth flow
  if (provider.oauthProvider === 'google' || providerId === 'google') {
    return GOOGLE_OAUTH_CONFIG
  }

  return provider.oauth
}

export function getAvailableProviders(): ProviderConfig[] {
  return PROVIDERS.filter(p => p.available)
}

export function getProvidersByCategory(category: string): ProviderConfig[] {
  if (category === 'all') return PROVIDERS
  return PROVIDERS.filter(p => p.category === category)
}

/** Get the OAuth provider ID to use for initiating the flow (e.g., gmail → google) */
export function getOAuthProviderId(integrationId: string): string {
  const provider = getProvider(integrationId)
  return provider?.oauthProvider ?? integrationId
}
