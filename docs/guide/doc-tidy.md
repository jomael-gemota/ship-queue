# Doc Tidy

**Doc Tidy** watches a shared mailbox, files the attachments into Google Drive,
and lists everything it found in one searchable table. From that table you can
send any PDF to an AI agent that reads it and hands back structured data — and
when the agent gets something wrong, you correct it once and it remembers.

Anyone signed in can use Doc Tidy.

There are three tabs across the top:

- **Extracted Messages** — everything captured so far, and where you parse a file.
- **Extraction Rules** — what Doc Tidy looks for in the mailbox.
- **Vendors** — the suppliers the agent has learned, and their SKU formats.

## Parsing a document

Each PDF in the **Attachments** column has a **Parse** button beside it. Click it
and the document goes to the agent.

The button is replaced by a status chip that tells you where things are:

| Chip | Meaning |
| ---- | ------- |
| **Queued** | Sent to the agent, waiting to start |
| **Parsing** | The agent is reading it now |
| **Parsed** | Finished — click to see what it found |
| **Failed** | Something went wrong; click to read why |

Click any chip to open the document's panel.

::: tip Only PDFs
The Parse button only appears on PDFs. The agent can't read other file types, so
offering it elsewhere would just queue a job that was always going to fail.
:::

::: warning "The parsing worker is not connected"
The agent runs on a separate machine. If that machine is off or has lost its
connection, parsing is unavailable and you'll see this message. Nothing is lost —
try again once it's back.
:::

## Watching the agent work

The panel opens on **Reasoning**, which is the agent narrating what it is doing,
one step at a time: reading the file, working out who the vendor is, recalling
your past corrections, then pulling out the data.

Each step is a circle on the rail at the top. The step in progress pulses; click
any circle to read that step in full. While a document is still parsing the rail
follows along on its own, and stops following the moment you click a step —
so you can read step two without the view jumping to step six.

This transcript is kept. Open a document you parsed last month and you'll see
exactly the same reasoning, replayed from the beginning.

The other tabs hold the results:

- **JSON** — the structured data, exactly as the agent produced it.
- **Tables** — the same data laid out as a table. **Copy** puts it on the
  clipboard ready to paste into a spreadsheet.
- **Corrections** — where you fix it.

**Re-run** sends the same document through again. It's most useful right after
you've made a correction or registered a vendor, to see the agent apply what it
just learned.

## Correcting the agent

Open the **Corrections** tab. The agent's output is there as editable JSON —
change what's wrong and leave the rest alone. Changed fields are listed
underneath as you type, old value struck through beside the new one, so you can
check you've edited what you meant to.

Then fill in **What was wrong?**. This matters as much as the JSON edit:

> Qty comes from the Units column, not the case pack

Write it as an instruction, because that's how it's used. The agent is given your
note as a rule it has to follow on that vendor's future documents. Fixing a
number teaches it about one document; explaining the mistake teaches it about all
of them.

Click **Save correction**. From then on, when a similar document from the same
vendor comes in, the agent is shown your correction as a worked example before it
starts.

::: tip Corrections don't leak between vendors
A correction is tied to the vendor it came from. Teaching the agent how Acme
writes their SKUs never changes how it reads anyone else's paperwork.
:::

Everything corrected on a document stays listed under **History**, with who made
it and when.

## Vendors

Corrections are scoped by vendor, so the agent has to know who a document is
from. When it can't tell, the panel shows **This vendor is new** and asks you to
register them.

Give the vendor's name and, if you can, paste **one real SKU** from their
paperwork. That sample is a head start: the agent copies its shape on this
vendor's very first document, before you've corrected anything at all.

The **Vendors** tab lists everyone registered, their sample SKUs, and how many
corrections each has contributed. That last number is the useful one — it's the
difference between a vendor that merely exists and one that has actually taught
the agent something.

You can add more sample SKUs at any time; a vendor may legitimately use several
formats, and the agent matches each line against whichever one fits.

::: danger Deleting a vendor
Deleting a vendor also deletes every correction they taught the agent, and it
goes back to guessing their format. The confirmation tells you how many
corrections that is before you commit.
:::

## Why isn't everything parsed automatically?

Because parsing costs time and money per document, and most captured mail never
needs to be read — a rule with a wide lookback window would send hundreds of
files to the agent the first time it ran. Pressing Parse is what says "I actually
want this one".
