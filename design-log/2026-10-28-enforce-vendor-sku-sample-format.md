# Enforce the vendor's sample SKU format on every run

**Date:** 2026-10-28
**Status:** accepted
**Author:** collaborative

## Context

Orvis workspace, invoice 500971: the user registered "THE ORVIS COMPANY, INC."
with sample SKU `ORV-2P920911`, then clicked Re-run Agent. The run came back with
`3JN80920` instead of `ORV-3JN80920`.

The vendor was detected (its name is printed on the invoice) and the sample was
sent to the model as a separate system message (the "VENDOR SKU FORMAT" anchor
in `worker/tidy_agent.py`).
The model simply ignored it about half the time: re-runs of 500970 and 501011
after registration came back `ORV-…`, while 500971 and 496053 did not. The base
prompt made it worse by telling the model to "assemble a reasonable SKU" when no
reference *correction* exists — which is exactly the state right after a vendor
is registered with only a sample.

Separately, samples and corrections were only looked up for the vendor found in
the raw text. The vendor bound to the job from the setup card was used only to
label the result, so a vendor whose registered name isn't printed verbatim got
no guidance at all.

## Decision

- **Prompt:** the base prompt names the VENDOR SKU FORMAT as authoritative
  alongside reference corrections, and the final user turn restates the
  sample(s) right before the document text.
- **Verify, then conform once:** after extraction, each line item's SKU is
  compared to the samples' shape (separator sequence, plus the leading
  alphabetic prefix when the sample has one, e.g. `ORV`). If any row doesn't
  fit, one SKU-only call rewrites the `sku` values (returned as an ordered list
  and applied in place, so no other field can drift). The result is accepted
  only when the count matches; failures are logged and the original SKUs kept.
- **Vendor fallback:** when no vendor is detected in the text, the job's
  confirmed `vendorName` is resolved in the workspace and used for samples and
  correction retrieval.
- **Visibility:** the reasoning panel says when a vendor's sample format is
  being applied and when SKUs were reformatted to match it.

## Alternatives Considered

- **Deterministic SKU assembly from the sample:** contradicts the standing
  decision that Tidy builds SKUs itself, learned per vendor; one sample can't say which parts are literal and which are row values.
- **Re-run the whole extraction on mismatch:** doubles cost and can change
  fields that were already right.

## Consequences

- One extra small model call on runs where SKUs don't fit the sample shape;
  none otherwise. Billed under the `extraction` usage purpose.
- The shape check is a heuristic. A vendor whose sample's leading letters are
  row data rather than a literal prefix will trigger the conform pass needlessly;
  the model is told to keep SKUs that already fit, so the output is unchanged.
- Existing jobs are not touched; re-running a job applies the fix.
