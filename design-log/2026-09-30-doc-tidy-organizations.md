# Doc Tidy — Organizations Layer

**Date:** 2026-09-30
**Status:** accepted
**Author:** collaborative

## Context

Workspaces in the Invoice Audit tab are currently team-wide (flat, visible to
everyone). Teams need an additional grouping and access-control layer so that
different groups of users only see the workspaces relevant to them. An
"organization" fills this role: it is a named container for workspaces and
carries a member list. Admins can also move existing workspaces into any
organization.

Extends the workspace design from
[2026-09-18-invoice-audit-workspaces.md](./2026-09-18-invoice-audit-workspaces.md).

## Decision

### Data model — `DocTidyOrganization`

```
{
  name: string
  memberUserIds: string[]   // user IDs who can view this org's workspaces
  createdByUserId?: string
  createdByName?: string
  timestamps (createdAt, updatedAt)
}
```

### Data model — `DocTidyWorkspace` update

Add an optional `organizationId?: string` field. Workspaces with no
`organizationId` are "unassigned" and remain visible to all authenticated users
(backward compatibility with existing workspaces).

### Access rules

| Actor  | Sees |
|--------|------|
| Admin  | All organizations and all workspaces |
| User   | Organizations where their userId is in `memberUserIds`, plus all unassigned workspaces |

### Backend — new endpoints

| Endpoint | Auth | Description |
|---|---|---|
| `GET /doc-tidy/organizations` | any auth | List (admin: all; user: accessible only) |
| `POST /doc-tidy/organizations` | admin | Create |
| `PUT /doc-tidy/organizations/:id` | admin | Rename or update member list |
| `DELETE /doc-tidy/organizations/:id` | admin | Delete; workspaces are unassigned (not deleted) |
| `GET /doc-tidy/organizations/users` | admin | List all users for the member picker |

### Backend — workspace changes

`GET /doc-tidy/workspaces` now applies access filtering for non-admin users:
returns workspaces in their accessible organizations plus unassigned workspaces.

`PUT /doc-tidy/workspaces/:id` now accepts `organizationId` (admin only) so
workspaces can be moved between organizations.

### Frontend — navigation hierarchy

```
Invoice Audit tab
├── Organizations landing (default view)
│   ├── [Admin: New Organization button]
│   ├── Org cards grid (name, member count, workspace count)
│   │   ├── Admin: Edit, Delete buttons per card
│   │   └── Click card → Workspaces view for that org
│   └── Unassigned workspaces section (no org assigned)
│       └── Click card → workspace detail directly
└── Workspaces view (inside an org)
    ├── Breadcrumb: [← Organizations] / [Org Name]
    ├── [Admin: Edit Org] [New Workspace]
    ├── Workspace cards
    │   ├── Admin: Move to org button
    │   └── Click → workspace detail
    └── Empty state
└── Workspace detail (unchanged)
    ├── Breadcrumb: [← Organizations] / [Org Name] / [Workspace]
    │             OR [← Organizations] / Unassigned / [Workspace]
    └── All existing tabs (Invoice Audit, Emails, Rules, Vendors, PDF Imports)
```

### `OrganizationEditorDialog` (admin only)

A centred modal with:
- **Name** — free-text input
- **Members** — scrollable checkbox list of all users; checked = can view this org's workspaces

### `MoveWorkspaceDialog` (admin only)

Radio-button list of organizations plus "Unassigned (no organization)" option.
Calls `PUT /doc-tidy/workspaces/:id` with `{ organizationId }`.

## Alternatives Considered

- **Per-workspace access lists** — more granular but much higher management
  overhead; org-level membership matches how teams actually organize.
- **Hard-delete workspaces on org delete** — rejected; deleting an org should
  not cascade-delete invoices, rules, and jobs.
- **Require every workspace to belong to an org** — rejected for backward
  compatibility; existing workspaces remain accessible without migration.

## Consequences

- Existing workspaces with no `organizationId` continue to work for all users.
- Non-admin users will only see the Invoice Audit tab content relevant to their
  org memberships, reducing noise.
- Admin must assign users to organizations before those users can see org-scoped
  workspaces.
- A user removed from an org immediately loses visibility of that org's
  workspaces on their next page load.
