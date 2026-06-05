# Dropbox Fetcher

The **Dropbox Fetcher** helps you grab shareable links for files in Dropbox.
Pick a folder, choose a file type, and Ship Queue gathers a link for every
matching file so you can copy or export them all at once.

![The Dropbox Fetcher page: choose a folder, choose a file type, and the results panel](/screenshots/dropbox-fetcher.png)

Anyone signed in can use the Dropbox Fetcher — there's no special permission
needed. You just need to connect Dropbox first.

## Step 1: Connect Dropbox

If Dropbox isn't connected yet, you'll see a **Connect Dropbox to get started**
message.

1. Click **Connect in Settings**.
2. On the Settings page, click **Connect Dropbox** and approve access.
3. Come back to the Dropbox Fetcher.

(See [Settings](/guide/settings) for more on connecting Dropbox.)

## Step 2: Choose a folder

- Use the **folder list** to click into folders.
- The **breadcrumb** at the top (starting with **Dropbox**) shows where you are —
  click any part to jump back.
- The folder you're currently in is shown as the **Selected folder**.

You can extract files from any folder, even one with no sub-folders.

![Step 1, Choose a folder, highlighted with the folder breadcrumb and selected folder](/screenshots/dropbox-step1-folder.png)

## Step 3: Choose a file type and extract

1. Pick a **File type** from the dropdown — for example *PDF (.pdf)*,
   *CSV (.csv)*, *Images*, or **All files**.
2. Optionally tick **Include files in sub-folders** to also search folders inside
   the one you selected.
3. Click **Extract links**.

A progress bar shows the work as links are created.

![The File type dropdown and the Extract links button highlighted](/screenshots/dropbox-step2-extract.png)

## Step 4: Copy or export the links

When it's done, the matching files appear in the **Links** panel. For each file
you'll see its name, size, and link.

![The Links results panel listing a matching file with its link, plus Copy all and Export .txt buttons](/screenshots/dropbox-results.png)

- **Copy all** — copies every link to your clipboard.
- **Export .txt** — downloads the links as a text file.
- The small copy icon next to a file copies just that one link.

::: tip Link format
Copy and export both use one line per file, in the form `filename,link`.
:::

## If something goes wrong

- **"Your Dropbox connection was revoked or expired"** — click **Reconnect in
  Settings** and approve access again.
- **"No matching files found in this folder"** — try a different file type, tick
  **Include files in sub-folders**, or pick another folder.
- Some files may be **skipped** if a link couldn't be created for them; the
  others still come through fine.

## What's next?

- Manage your Dropbox connection in [Settings](/guide/settings).
