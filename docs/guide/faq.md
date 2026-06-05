# FAQ & Troubleshooting

Quick answers to common questions. If your question isn't here, check the
[About](/about) page for who to contact.

## Signing in

### I get an "Access denied" message when I sign in
You're probably using a personal Google account. Sign in with your **company
Google account** (for example `@outdoorequipped.com` or
`@channelprecision.com`).

### Do I need a password?
No. Ship Queue uses your Google account, so there's no separate password.

## Permissions and access

### A button is missing or greyed out
This usually means you don't have permission for that action. The most common
cases:

- **No "Sync Orders" or "Create + Print Labels" button** — you have view-only
  access. An admin can grant you label-creation permission in
  [User Management](/guide/user-management).
- **Auto-sync settings are greyed out** — only admins can change those.
- **User Management shows "Admins only"** — that page is for admins.

### What's the difference between a "User" and an "Admin"?
An **Admin** can manage people, change auto-sync, and always create labels. A
**User** is a standard account whose ability to create labels is controlled by a
separate permission. See the full table below.

## Creating labels

### Why can't I draft or create labels?
Two things are required:

1. **Label-creation permission** (ask an admin if you don't have it).
2. **Google Drive connected** in [Settings](/guide/settings).

If either is missing, you'll see a reminder at the top of the
[Create Shipping Label](/guide/create-label) page.

### My spreadsheet won't upload or drafts an empty batch
Make sure your CSV has **PO#** and **Order#** columns and at least one row of
data. The easiest path is to click **Download template** and fill that in.

### An item says "Not found"
That order isn't in the orders list yet. Sync orders (see
[Viewing Orders](/guide/orders)), then open the batch and click
**Re-check orders**.

### A label says "Failed"
Hover the info icon to see why. Fix the **Property** (Residential vs Commercial)
if needed, then click **Recreate** to try again.

### Can I delete a batch someone else made?
No — only the person who created a batch can delete it.

## Google Drive & Dropbox

### It says my connection "expired" or was "revoked"
Open [Settings](/guide/settings) and click **Reconnect** (Drive) or
**Connect Dropbox** again, then approve access.

### Where do my label PDFs go?
To your Google Drive — by default the top level, or a folder you choose in
Settings.

## Orders

### How often do orders update?
Automatically, on a schedule set by an admin (shown as an **Auto-sync** badge on
the Orders page). If you have permission, you can also click **Sync Orders** to
update right away.

## Who can do what

| Action | View-only user | Label creator | Admin |
| --- | --- | --- | --- |
| View orders and batches | Yes | Yes | Yes |
| Sync orders manually | No | Yes | Yes |
| Upload CSV & draft a batch | No | Yes* | Yes* |
| Create / print labels | No | Yes* | Yes* |
| Export CSV / ZIP, download PDFs | Yes | Yes | Yes |
| Delete a batch | Owner only | Owner only | Owner only |
| Dropbox Fetcher | Yes** | Yes** | Yes** |
| Connect Drive / Dropbox | Yes | Yes | Yes |
| Change auto-sync settings | View only | View only | Yes |
| User Management | No | No | Yes |

\* Requires Google Drive to be connected.  
\** Requires Dropbox to be connected.

## Still stuck?

See the [About](/about) page for how to reach the person who maintains Ship
Queue.
