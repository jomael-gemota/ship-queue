# Doc Tidy — rule-driven email & attachment extraction

**Date:** 2026-09-10
**Status:** accepted
**Author:** collaborative

## Context

A new top-level menu, **Doc Tidy**, is needed to pull email messages and their
attachments out of a mailbox according to user-defined configuration, and to
present the results in a table with pagination, search and filtering.

Requested capabilities:

1. Extract email messages *with* their attachments, driven by configurable
   criteria (keywords and similar).
2. A configuration area where a user manages a **named list of rules**; a single
   entry bundles sender email, subject keywords, body keywords, date range, etc.
3. A results table with pagination, search and filtering.

Clarifications agreed with the developer:

- The mail to be processed lives in a **single shared group address**,
  `invoice@outdoorequipped.com` — not in each user's personal mailbox. The
  connection to that mailbox is configured **once, from the Settings page**.
- Extracted attachments are **uploaded to Google Drive**, into a destination
  drive/folder that an **admin selects in Settings** (explicitly a different
  drive/folder from the existing label-upload destination).
- Rules and extracted results are **shared team-wide**.
- The menu is available to **all signed-in users**; only the Settings-side
  connection and destination folder are admin-gated.

Relevant existing groundwork:

- Google OAuth already exists for login and Drive uploads. Tokens live on the
  `User` document, and `googleDrive.service.ts` shows the refresh-token-only
  pattern for building an authenticated `googleapis` client. Current scopes are
  `profile`, `email` and `drive` — **no Gmail scope**.
- `driveAuth.controller.ts` implements a "connect any Google account" flow using
  a JWT `state` to bind the callback to the initiating user. This is the
  template for connecting the invoice mailbox.
- `googleDrive.service.ts` already supports Shared Drives (`listSharedDrives`,
  `driveId` scoping, `supportsAllDrives`), so an alternate destination drive
  needs no new Drive plumbing.
- `SyncConfig.ts` establishes the singleton-config pattern (`key: 'global'` plus
  a `getSyncConfigDoc()` accessor) for app-wide settings.
- `getOrders` defines the house list contract: `?page&pageSize&search&status` in,
  `{ data, pagination: { page, pageSize, total, pages } }` out.
- The frontend has no shared table component; `Orders.tsx` is the reference for
  server-side pagination with 350ms-debounced search, and `labelUi.tsx` exports
  `Th`, `Td`, `HeaderLabel` and `Spinner`.

## Decision

### One shared, app-wide mailbox connection

Doc Tidy reads via the **Gmail API** (`googleapis`, already installed) using a
**singleton connection** stored on a new `DocTidyConfig` document, not on
`User`. An admin connects the mailbox once from Settings via an OAuth flow
modelled on `driveAuth.controller.ts` (`prompt: 'select_account consent'`, JWT
`state`), signing in as the invoice address.

That single connection requests **both** `gmail.readonly` **and** `drive`
scopes, so the same account that reads the mail also owns the Drive uploads.
This makes Doc Tidy self-contained: it never touches `User.googleRefreshToken`,
so connecting or revoking it cannot disturb per-user Drive label uploads, and
the destination folder picker naturally lists the drives that the invoice
account can see.

Read-only Gmail scope is deliberate — Doc Tidy can never modify or delete mail.

### Rules compile to Gmail search queries

Each rule is compiled into a Gmail `q` string (`from:`, `subject:`,
`has:attachment`, `after:`/`before:`, plus free-text body terms) so Gmail does
the matching server-side; this is dramatically faster and cheaper in quota than
downloading a mailbox and filtering in Node. A second pass in Node enforces what
Gmail's query language cannot express exactly: attachment extension
allow-lists, and strict `all` vs `any` keyword semantics.

### Data model — three new collections

`DocTidyConfig` (singleton, `key: 'global'`):

| Field | Purpose |
|-------|---------|
| `gmailRefreshToken` | Mailbox credential (`select: false`) |
| `gmailAccountEmail`, `gmailConnectedAt`, `gmailConnectedByName` | Connection metadata shown in Settings |
| `driveFolderId`, `driveFolderName`, `driveId` | Attachment destination (admin-selected, may be a Shared Drive) |

`DocTidyRule` (shared team-wide; `createdByUserId`/`createdByName` for
attribution only):

| Field | Purpose |
|-------|---------|
| `name` | User-supplied label for the entry |
| `enabled` | Toggle without deleting |
| `fromAddresses[]` | Sender email(s) |
| `subjectKeywords[]`, `bodyKeywords[]`, `excludeKeywords[]` | Term groups |
| `matchMode` | `any` \| `all` across keyword groups |
| `dateFrom` / `dateTo` / `lookbackDays` | Absolute range or rolling window |
| `requireAttachment`, `attachmentExtensions[]` | Attachment constraints |
| `lastRunAt`, `lastRunMatchCount`, `lastRunError` | Run feedback in the UI |

`DocTidyMessage` (shared; deduped by Gmail message id):

| Field | Purpose |
|-------|---------|
| `ruleId`, `ruleName` | Provenance (denormalised name so results survive rule deletion) |
| `gmailMessageId` (unique), `threadId` | Dedupe + deep-link to Gmail |
| `from`, `fromName`, `to[]`, `subject`, `snippet`, `sentAt` | Table columns |
| `bodyText` | Full body, `select: false` (large) |
| `attachments[]` | `filename`, `mimeType`, `size`, `driveFileId`, `webViewLink` |
| `hasAttachments`, `extractedAt` | Filtering + audit |

Indexes: `{ sentAt: -1 }` for the default list, `{ ruleId: 1 }` for the rule
filter, and unique `gmailMessageId` so re-running a rule updates in place.

### API — `/api/doc-tidy`

All routes `requireAuth`; only mailbox/destination changes add `requireAdmin`.

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/rules` | List / create rules |
| PUT/DELETE | `/rules/:id` | Update / delete a rule |
| POST | `/rules/:id/run` | Extract for one rule |
| POST | `/run` | Extract for all enabled rules |
| GET | `/messages` | Paginated, searchable, filterable results |
| GET | `/messages/:id` | Detail incl. body + attachments |
| GET | `/config` | Mailbox + destination status |
| PUT | `/config` | Set destination folder (**admin**) |
| DELETE | `/config/mailbox` | Disconnect mailbox (**admin**) |
| GET | `/config/folders` | Drive folder picker for the invoice account (**admin**) |

`GET /messages` mirrors `getOrders`: `page`, `pageSize` (50/100/200/500),
`search` (escaped regex over subject/from/snippet/attachment filename), plus
`ruleId`, `dateFrom`, `dateTo` and `hasAttachments` filters.

### Frontend

- "Doc Tidy" entry in `Sidebar.tsx` `MENU_ITEMS`, plus `Navbar` title and
  `Layout` full-width handling.
- `/doc-tidy` — results table following the `Orders.tsx` pattern (server-side
  pagination, debounced search, filter bar, skeleton/empty/error states).
- `/doc-tidy/rules` — rule list with enable toggles, run buttons, and a
  hand-rolled editor modal using the existing overlay pattern with repeatable
  keyword chip inputs.
- Settings gains a **Doc Tidy** section: connect/disconnect the invoice mailbox
  and choose the Drive destination folder, reusing the existing folder-browser
  interaction.
- New `src/types/docTidy.ts` mirroring backend response shapes.

### Extraction trigger

**On-demand only** for v1 — a *Run* button per rule plus *Run all enabled*.
`syncScheduler.ts` shows how to add background scheduling later; keeping v1
manual avoids burning Gmail quota before the rules have proven themselves.

## Alternatives Considered

- **Per-user mailbox connections:** rejected once it was clarified that the mail
  lives in one shared group address; per-user connections would mean N consents
  to the same mailbox and N duplicate copies of every message.
- **Reusing `User.googleRefreshToken` for Gmail:** fewer fields, but adding a
  Gmail scope would force re-consent on every user's Drive connection and
  entangle two independent integrations; revoking one would break the other.
- **IMAP (`imapflow`) or Microsoft Graph:** provider-agnostic / Outlook support,
  but require stored mailbox passwords or an entirely new OAuth stack, and
  discard the existing Google plumbing.
- **Fetching all mail and filtering in Node:** simpler rule code, far more data
  transfer, much slower, and a quota risk.
- **Storing attachments in MongoDB/GridFS or on local disk:** self-contained,
  but the developer explicitly wants files in Drive, and Drive keeps the DB
  small and the files reachable by people outside the app.
- **Embedding rules on `User`** (like `dropboxFetcherPrefs`): fine for scalar
  prefs, wrong for a shared, named, individually-runnable list.
- **Client-side pagination** (like `AdminUsers.tsx`): extracted mail is
  unbounded, so server-side pagination is required.
- **Adding TanStack Table or a toast library:** would introduce new conventions
  into a deliberately minimal stack.

## Consequences

- Requires Google Cloud changes: enable the **Gmail API** and add
  `gmail.readonly` to the OAuth consent screen; add a `DOC_TIDY_CALLBACK_URL`
  redirect URI. An admin must run the connect flow once.
- **`invoice@outdoorequipped.com` must be a mailbox that can complete an OAuth
  sign-in.** If it is a true Google Group rather than a Workspace user account,
  it has no Gmail mailbox to authorise; the fallback is to connect an account
  that *receives* the group's mail (a member account) and scope rules with
  `to:invoice@outdoorequipped.com`. This is the main implementation risk and is
  verified at connect time by showing the connected address in Settings.
- Message bodies and attachment metadata are copied into MongoDB, so the
  mailbox's retention/privacy posture now extends to this database. Attachment
  bytes are not stored in Mongo — only Drive pointers.
- Because rules and results are shared, any user can edit or delete another
  user's rule; attribution is recorded but not enforced.
- Three new collections and ~12 endpoints. The results table duplicates much of
  the Orders table, which the codebase already tolerates (no shared table
  abstraction exists).
