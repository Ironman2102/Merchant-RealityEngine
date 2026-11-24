# How AI tools were used

The challenge allows AI tools and asks that the team's own insight and judgement lead. This is the record.

- AI coding assistants wrote a substantial share of the code and planning documents. Their working notes are kept, unedited,
  in `docs/history/` and `audit/`.
- On 22 November 2026, after the Round 1 deadline, an AI assistant (Claude) audited the project at a team member's request and
  implemented the fixes listed in `docs/AUDIT_FIX_REPORT.md`, including the per-QR scoring and the Context Passport enforcement.
  Both build on ideas already in the project (surgical link restriction; the Context Passport pattern S4).
- No generative LLM makes a decision inside the product. Stage 2 ML (`ml/serve.py`) and an optional lazy zero-shot text encoder (`valhalla/distilbart-mnli-12-1`) provide non-decisional second opinions only and never open cases or override the Bayesian conduct gate.

## For the team to complete, in its own words, before the finale

- The decisions each member made, and why (three each).
- What each member checked by hand.
- Which AI suggestions the team rejected.
