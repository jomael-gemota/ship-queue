# Viewing Orders

The **ShipStation Orders** page (the first page you see after signing in) shows
all the orders that have been pulled in from ShipStation. This is your master
list of what's coming in.

![The ShipStation Orders page with the orders table, filters, and sync button](/screenshots/orders.png)

## What you'll see

The orders are shown in a table. Each row is one order, with columns for:

- **Order #** — the order number
- **Order Date** — when the order was placed
- **Customer** — who it's going to
- **Ship To** — the delivery address
- **Property Type** — Residential or Commercial
- **Status** — for example *Awaiting Shipment* or *Shipped*
- **Items** — how many items are in the order
- **Order Total** — the order value

## Seeing the items in an order

Click any order row (or the small arrow at the start of the row) to **expand**
it. A panel opens underneath showing each item — its picture, title, SKU, UPC,
quantity, weight, price, and tax. Click again to close it.

![An expanded order row showing the item's picture, title, SKU, UPC, quantity, and weight](/screenshots/orders-expanded.png)

## Finding a specific order

At the top of the table you have two tools.

**Status dropdown** — show only orders with a certain status (for example, only
*Awaiting Shipment*). Choose **All Statuses** to see everything again.

![The Status dropdown highlighted above the orders table](/screenshots/orders-status-filter.png)

**Search box** — type an order number, customer name, or ship-to address to
narrow the list. The count on the right updates to show how many orders match.

![The search box highlighted with a partial order number typed in, narrowing the list](/screenshots/orders-search.png)

## Moving through the list

If there are lots of orders, they're split into pages.

- Use the **arrow buttons** to go to the first, previous, next, or last page.
- Use **Rows per page** to show 50, 100, 200, or 500 orders at a time.

## Keeping orders up to date (syncing)

"Syncing" means fetching the newest orders from ShipStation.

- **Automatic syncing:** Ship Queue can sync on its own in the background, even
  when no one has the app open. Near the top of the page you'll see a small badge
  like **Auto-sync: every 15 min** (or **Auto-sync: off**). When new orders come
  in automatically, the table refreshes by itself and briefly shows
  **Auto-synced**.
- **Manual syncing:** If you have label-creation permission, you'll see a **Sync
  Orders** button. Click it to pull in the latest orders right away. A progress
  bar shows how it's going, and the table fills in as orders arrive.

![The Sync Orders button highlighted, with the auto-sync badge shown near the page title](/screenshots/orders-sync.png)

::: tip "Last synced" time
Just under the page title, **Last synced** tells you when the order list was
most recently updated.
:::

::: info No Sync button?
If you don't see the **Sync Orders** button, you have view-only access. You can
still browse everything; an admin can grant label-creation permission if you
need it. The background auto-sync still keeps your list fresh.
:::

## What's next?

When your orders are ready, head to
[Creating Shipping Labels](/guide/create-label).
