# User Role Management & User Table Enhancements

**Date:** 2026-06-05
**Status:** accepted
**Author:** collaborative

## Context

The User Management page (`frontend/src/pages/AdminUsers.tsx`) lets admins grant or
revoke `canCreateLabels`, but roles (Admin/User) were read-only badges set only via
Google OAuth (`ADMIN_EMAILS`). Admins requested the ability to upgrade a user to
Admin or downgrade an Admin to User directly from the UI. The same pass adds three
table refinements: show the time (not just the date) in the Joined column, apply
alternating row colors (zebra striping, matching the Orders/Batches convention),
and add pagination to the users table.

Affected files:
- `src/controllers/admin.controller.ts` (new `updateUserRole` handler)
- `src/routes/admin.routes.ts` (new `PATCH /users/:id/role` route)
- `frontend/src/pages/AdminUsers.tsx` (role dropdown + confirm, Joined time, zebra, pagination)

## Decision

### Backend — role update endpoint
- New `PATCH /api/admin/users/:id/role` (admin-only, behind `requireAuth` + `requireAdmin`).
- Body `{ role: 'admin' | 'user' }`, validated against the enum.
- **Self-protection:** an admin cannot change their own role (prevents self-lockout).
- **Protected super-admin:** the hardcoded `ADMIN_EMAILS` account cannot be demoted,
  since `passport.ts` re-promotes it on next login anyway — demoting it is misleading.
- Promoting to `admin` also sets `canCreateLabels = true` (admins always have access),
  matching the OAuth bootstrap logic.
- Returns the full user shape (`_id`, `email`, `name`, `avatar`, `role`,
  `canCreateLabels`, `createdAt`) so the frontend merges cleanly by `_id`.

### Frontend — role change UI
- The Role cell keeps the existing badge but adds a small "change role" control.
  Selecting the opposite role opens a confirmation modal (role changes are sensitive),
  which then calls the API with a loading state and optimistic list update.
- The control is hidden/disabled for the current logged-in user and the protected
  super-admin, mirroring the backend rules.

### Frontend — table refinements
- **Joined column:** show date on the first line and time (`h:mm A`) on a second,
  smaller line via `toLocaleString`.
- **Alternating rows:** index-based `rowIndex % 2` striping with `--bg-100` / `--bg-200`,
  consistent with `Orders.tsx` and the Label Batches table.
- **Pagination:** client-side (page + rows-per-page) over the filtered list, reusing
  the CreateShippingLabel pagination bar pattern; page resets on search change.

## Alternatives Considered

- **Inline `<select>` without confirmation** — faster but risky for an Admin promotion;
  a confirm modal prevents accidental privilege escalation/demotion.
- **Server-side pagination** (like Orders) — unnecessary here; the user list is small
  and already fetched in full, so client-side paging keeps it simple.
- **Tailwind `odd:`/`even:` utilities** — the codebase consistently uses the
  index-based JS approach, so we follow suit for maintainability.

## Consequences

- Admins can now self-grant the ability to promote any user to Admin; the protected
  super-admin and self-demotion guards limit the worst-case lockout scenarios.
- `updateUserPermissions` still returns `id` (not `_id`); only `updateUserRole`
  returns the full `_id` shape. Left as-is to avoid scope creep.
