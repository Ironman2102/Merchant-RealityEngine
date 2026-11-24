# Judge questions

Every member should be able to answer all of these without notes.

**What is your accuracy?**
Unknown on real data. On synthetic data: 0/919 honest merchants wrongly opened, 33/81 fronts opened, 67/81 opened or questioned.
Our first version claimed 90% recall and a perfect model. We found label leakage in our own data and withdrew both.

**How is this different from a rules engine?**
Rules score the merchant and fire on change. We score each QR, separate "changed" from "misconduct", and give the merchant a
verified way to update what is expected. Monitoring against the profile is RBI's requirement, so we don't claim that as our idea.

**What if betting is only 10% of the shop?**
It depends on payment count and repeat payers, not only share. On its own link in a busy shop (about 900 payments a month), 10%
is usually a question and 20% is usually a case. In a small shop, where that link has under 50 payments or few returning payers,
even 20-30% is usually a question. Mixed into the same QR at 10% we often miss it. We say so.

**Can a fraudster get a fake passport?**
It is possible. A passport covers one QR, one at a time, for at most 180 days, 12 hours a day, a 10x price band and 10 states (or a
declared national business). A named person records it and a different person verifies it: a service key cannot do either. If any
conduct signal fires, passports are switched off and the score is exactly the one without them. An answered question stays on the
record, and a reviewer can revoke the passport, which brings the question back on every case it answered.
The limit: payment data cannot show that a document is forged. When we searched for the best forged passport on every QR, it
answered the question for at least 244 of 2,400 synthetic fronts, none of which had a conduct signal. No case moved.

**Do you ever accuse an honest merchant?**
Yes. On fresh synthetic seeds, 5 of 10,800 honest merchants opened a case, all bakeries taking catering advances from a few
regulars. A fix that counted people instead of payments removed 3 of them and lost 80 of 3,112 caught fronts, so we did not adopt
it. Two people can clear such a case, and later cases show that decision. A passport cannot clear it.

**Why not just use a rule?**
Fair challenge. A one-line rule (over 25% of a busy QR is round payments from people who paid that way 4+ times) caught 601 of
1,000 synthetic fronts with no false alarm. We caught 653 with payer location and 328 without it, so without location that rule
is better at opening cases. What we add: a question before a penalty, side betting mixed into the same QR when location is known,
evidence other than round amounts, and an explanation for each decision. Both are easy to evade by avoiding round amounts.

**Is the audit tamper-proof?**
No. It is tamper-evident: rows are sealed with a server key, so an edit or deletion made in the database without that key is
detected, and writes and exports then stop. A trigger planted in the database, and one old row put back with its old seal, are detected too. Someone with the key can forge it. An old copy of the whole database can only be
noticed against a checkpoint kept elsewhere (`mre verify-db`).

**Can't they pick a looser category?**
The category picks what is normal, so looking normal earns little credit, and conduct tests ignore the category. Without payer
location a camouflaged front gets a question, not a case. That is a real gap.

**What if they avoid round amounts?**
That avoids a case most of the time in our red team (92/98). All 98 were still questioned. Doing several evasions at once can avoid both.

**What data do you need from PayU?**
Amount, time, payer token, QR or link id, refunds, settlements, MCC, onboarding date. Payer state helps and is optional. We do
not assume you can see post-settlement payouts.

**What happens if the merchant ignores the question?**
The proposed process is a follow-up after 7 days. The prototype has no timer, message or reply channel. Silence never restricts money automatically.

**What if you are wrong about an honest shop?**
We ask before we restrict, only an identified link can be restricted, a different person approves, and the draft letter names an appeal route (there is no appeal workflow yet).

**Do you tip off the fraudster?**
The letter is identical for every merchant and names no signal. [RBI's KYC Direction](https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=11566) requires the reasons to stay confidential.

**Where is the AI, and why not deep learning?**
A small logistic model gives a second opinion. It cannot see age, category or which feeds exist. With no real labels, a bigger
model would learn our generator. It already did that once.

**Why is the trained model's recall higher than the engine's?**
78% against 47% on its test suite, because it needs no independence or conduct gate. Both see only synthetic fronts. We keep the
gate until real labels show the model's extra flags are right.

**How does it learn?**
Ten or more labelled merchants can propose a calibration. It must pass a holdout and be approved by someone other than the requester.

**Does it scale?**
About 17 ms for a small merchant on a laptop core (`reports/perf.md`). Daily batch is enough. The cost is analyst time, not compute.

**Did AI build this?**
AI tools wrote much of the code, and we disclose it in `AI_USAGE.md`. Then give your own three decisions and why you made them.

**What changed since your submission?**
Answer truthfully: an audit found leakage, false alarms and security holes, and we fixed them (`docs/AUDIT_FIX_REPORT.md`).
