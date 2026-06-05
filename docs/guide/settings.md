# Settings

The **Settings** page is where you connect the services Ship Queue uses and
choose a few preferences. It has three sections: **Google Drive**, **Dropbox**,
and **Automatic order syncing**.

Everyone can connect their own Google Drive and Dropbox. Only admins can change
the automatic syncing settings.

![The Settings page with Google Drive, Dropbox, and Automatic order syncing sections](/screenshots/settings.png)

## Google Drive

When you create shipping labels, the PDFs are saved to Google Drive
automatically (named by PO number). So Drive must be connected before you can
create labels.

### Connect Google Drive

1. In the **Google Drive** section, click **Connect Google Drive**.
2. Approve access in the Google window.
3. You'll see a *"Google Drive connected successfully"* message and a
   **Connected** badge.

![The Google Drive section showing the connected account and destination folder](/screenshots/settings-drive.png)

### Choose where labels are saved

By default, labels go to the top level of your Drive (**My Drive (root)**). To
pick a specific folder:

1. Click **Browse folders**.
2. Navigate to the folder you want.
3. Click **Use this folder**.

![The Browse folders picker open, listing Drive folders with a Use this folder button](/screenshots/settings-browse-folders.png)

You can also paste a Drive folder link or ID into the box and click **Save**.
To go back to the top level, click **Reset to root**.

### Switch or disconnect

- **Switch account** — connect a different Google account.
- **Disconnect** — remove the connection. Confirm with **Disconnect Drive?** →
  **Confirm**. You can reconnect anytime.

::: warning "Access revoked or expired"
If you see a banner saying Drive access was revoked or expired, just click
**Reconnect** and approve again.
:::

## Dropbox

Connecting Dropbox lets you use the [Dropbox Fetcher](/guide/dropbox-fetcher).

1. In the **Dropbox** section, click **Connect Dropbox**.
2. Approve access in Dropbox.
3. You'll see a *"Dropbox connected successfully"* message.

You can **Switch account** or **Disconnect** here too.

## Automatic order syncing

This controls whether Ship Queue pulls new ShipStation orders on its own, on a
schedule — even when no one has the app open.

- **Background auto-sync** — turns automatic syncing on or off.
- **Sync interval** — how often it runs, in minutes (between 1 and 1440).

Admins click **Save changes** to apply.

![The Automatic order syncing section with the auto-sync toggle, sync interval, and Save changes button](/screenshots/settings-autosync.png)

::: info Read-only for most users
Everyone can see these settings, but only **admins** can change them. If you're
not an admin, the controls are greyed out and you'll see a note that only an
admin can change them.
:::

## What's next?

- Connect Drive, then head to [Creating Shipping Labels](/guide/create-label).
- Admins managing people can visit [User Management](/guide/user-management).
