# Doc Tidy — Extraction Rules: row-click interaction model

**Date:** 2026-09-17
**Status:** accepted
**Author:** collaborative

## Context

Follows [Rules and Vendors UI polish](./2026-09-16-doc-tidy-rules-and-vendors-ui-polish.md) and
[Vendor editor modal](./2026-09-17-doc-tidy-vendor-editor-modal-and-delete-consistency.md).

The Extraction Rules list previously exposed three per-row actions: a toggle
switch (enable/disable), a Run button, and Edit + Delete icon buttons. This made
every row a small control panel, which:

- Scattered focus across six interactive elements per row before the user had
  even read the rule.
- Duplicated the enabled/disabled state as both a visible indicator and an
  actionable toggle on the same row.
- Kept the Run action prominent even though running a single rule is an
  infrequent, deliberate operation.

## Decision

### Row becomes the primary interaction target

Clicking anywhere on a rule row opens the `RuleEditor` modal — the same modal
previously reached through the Edit icon button. The row gets `cursor-pointer`
and `group` so descendant elements can react to the hover.

### Edit icon button removed

The Edit button is redundant once the row itself is clickable.

### Run button removed from the list

Running a rule is an intentional, occasional action that does not belong on the
browsable list. Users who need to run a rule open it for editing first, which
gives them a moment to confirm the criteria before triggering an extraction.
The run functionality remains available via the backend and can be surfaced in
the editor modal in a future pass if needed.

### ToggleSwitch replaced by a status badge

The inline toggle was the only interactive element that modified server state
without entering the editor. It also duplicated the left accent stripe as a
status indicator. Replacing it with a read-only pill (`Active` / `Disabled`,
emerald / grey) removes the duplication and makes the interaction model
consistent: the only way to change a rule's enabled state is through the editor.
The pill uses the same ring-inset badge pattern as the document type badges and
the vendor correction pill established in the previous polish pass.

### Subtle hover chevron

A right-pointing chevron (`›`) with `opacity-0 group-hover:opacity-60` appears
at the far right of each row on hover. It gives the user a visual cue that the
row is interactive without cluttering the default view.

### Delete remains, isolated from the row click

The Delete icon button is retained on the row because it is a destructive action
that should not require entering the editor. It is wrapped in a `<div
onClick={(e) => e.stopPropagation()}>` so clicking it does not trigger the
row's onClick and open the editor behind the confirmation dialog.

### Status filter labels updated

The filter dropdown options change from "Enabled" / "Disabled" to "Active" /
"Disabled" to match the new badge labels.

## Dead code removed

- `runningId` state
- `togglingId` state
- `handleRun` function
- `handleToggle` function
- `ToggleSwitch` import from `docTidyUi`
- `RunRuleResult` type import from `docTidy`
- `ICONS.run` and `ICONS.edit` path constants

## Alternatives Considered

- **Keep Run in the editor modal.** Viable future enhancement; deferred to avoid
  scope creep and because the mailbox-connected guard logic belongs on a page
  that has access to `config`, not inside a generic form component.
- **Show the toggle inside the editor and also on the row.** Two controls for
  the same field in the same UI would still be confusing; the badge is read-only
  by design.
- **Expand the row on click (accordion) instead of a modal.** Accordions on
  lists with long content cause the page to jump and make it hard to compare
  rules. The modal is consistent with how vendors are edited.
