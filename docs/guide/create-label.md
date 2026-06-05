# Creating Shipping Labels

This is where you turn orders into printed shipping labels. The idea is simple:

1. Upload a small spreadsheet of orders.
2. Review the details in a "batch".
3. Create and print the labels — all at once.

![The Create Shipping Label page with the Import & Draft area and the Label Batches table](/screenshots/create-label.png)

::: warning Before you start
Two things must be in place to create labels:

1. **Label-creation permission.** If you see a note saying *"You have view-only
   access"*, an admin needs to grant you permission first. You can still view
   batches and download files.
2. **Google Drive connected.** Labels are saved to Google Drive automatically,
   so Drive must be connected in [Settings](/guide/settings) first. If it isn't,
   you'll see a reminder with a link.
:::

## Step 1: Prepare your spreadsheet

You need a simple **CSV** file with two columns: **PO#** and **Order#**.

1. In the **Import & Draft** section, click **Download template**.
2. Open the downloaded `shipping-label-template.csv` in Excel or Google Sheets.
3. Fill in one row per order, with the PO number and the order number.
4. Save it as a `.csv` file.

![The Download template button highlighted in the Import & Draft section](/screenshots/create-label-template.png)

## Step 2: Upload and draft the batch

1. Click the **Choose File** picker and select your CSV file.
2. Ship Queue shows the file name and how many rows it found.
3. Click **Draft for Review** (this button appears once a file is selected).

![The Choose File picker highlighted in the Import & Draft section](/screenshots/create-label-choose-file.png)

This creates a **batch** — a group of orders you can review together before any
labels (or charges) happen. Nothing is purchased yet.

::: tip What's a "batch"?
A batch is just a named group of orders (for example `B-ABC123`) bundled
together so you can review and process them in one go.
:::

## Step 3: Review the batch

Your new batch appears in the **Label Batches** table with the status
**Drafted for Review**. The table shows the Batch ID, when it was created, who
uploaded it, its status, and how many items it has.

Click **View items** to open the batch and check the details. See the
[Reviewing a Batch](#reviewing-a-batch) section below for what you can do there.

![The Label Batches table with the View items link highlighted on a batch row](/screenshots/create-label-view-items.png)

## Step 4: Create and print the labels

When the details look right, click **Create + Print Labels** (either on the
batch row or inside the batch).

1. A confirmation window opens showing the ship-from address, insurance, and how
   many labels will be created.
2. Review it, then confirm by clicking **Create … label(s)**.
3. The labels are purchased, the PDFs open to print, and copies are saved to your
   Google Drive automatically.

The batch status updates to **Labels Created** (or **Partially Created** if some
couldn't be made).

## Reviewing a batch

Opening a batch with **View items** shows every order in it. There are two tabs:

- **Shipping Details** — addresses, package, service, ship date, quantities,
  weight, and insurance.
- **Tracking & Labels** — tracking numbers, cost, and a link to download each
  label PDF (available after labels are created).

![The batch detail page on the Shipping Details tab, showing addresses, service, ship date, and status](/screenshots/batch-shipping-details.png)

Use the tabs at the top of the batch to switch between **Shipping Details** and
**Tracking & Labels**.

![The Shipping Details and Tracking & Labels tabs highlighted at the top of the batch](/screenshots/batch-tabs.png)

Things you can do here (if you own the batch and have permission):

- **Set the Ship Date** — pick the date with the date selector. It applies to all
  items that don't have a label yet. A ship date is **required** before creating
  labels.
- **Fix the Property type** — switch an address between **Residential** and
  **Commercial**. This affects the shipping service used.
- **Re-check orders** — if an item shows **Not found**, it means that order isn't
  in the orders list yet. Sync orders first (see [Viewing Orders](/guide/orders)),
  then click **Re-check orders**.
- **Recreate a failed label** — if an item shows **Failed**, fix the property if
  needed and click **Recreate** to try again. (This buys a new label.)

### What the item statuses mean

| Status | Meaning |
| --- | --- |
| **Drafted** | Reviewed but no label bought yet. |
| **Created** | Label purchased and ready to download. |
| **Failed** | Something went wrong — hover the info icon for details, then retry. |
| **Not found** | The order isn't in the orders list yet — sync, then re-check. |

## Downloading your labels

![The Tracking & Labels tab showing tracking numbers, cost, and Download / Drive links](/screenshots/batch-tracking.png)

You can download labels at any time after they're created:

- **Download** (on a row in the Tracking & Labels tab) — saves one label PDF.
- **Export label PDFs (.zip)** (the ZIP icon) — downloads every label in the
  batch as one ZIP file.
- **Export as CSV** (the CSV icon) — downloads a spreadsheet of the batch details.

![The per-label Download link highlighted on a row in the Tracking & Labels tab](/screenshots/batch-download.png)

## Deleting a batch

Only the person who created a batch can delete it. Click the trash icon, then
confirm with **Delete batch**.

## Who can do what

| Action | Who can do it |
| --- | --- |
| View batches and items | Everyone |
| Upload CSV and draft a batch | Users with label permission (Drive connected) |
| Create / print labels | The batch owner, with label permission (Drive connected) |
| Edit ship date / property | The batch owner, with label permission |
| Export CSV / ZIP, download PDFs | Everyone |
| Delete a batch | The batch owner |

## What's next?

- Set up Google Drive in [Settings](/guide/settings).
- Stuck on something? See [FAQ & Troubleshooting](/guide/faq).
