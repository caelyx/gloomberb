# AusTender contracts

`AUTN` lists Australian Government (Commonwealth) contracts as AusTender publishes them: every contract notice of A$10,000 or more that a Commonwealth entity awards, usually within 42 days of signing. The date shown is when AusTender published the notice (Sydney time): the feed carries no separate signing date.

- **Window:** contracts published over the last 1, 3 or 7 days. The largest come first; any column sorts.
- **ASX-listed suppliers:** the ASX column names the listed company that a supplier appears to be, and the ASX toggle shows only those rows. Enter on a marked row opens the company.
- **Search:** narrows by supplier, agency, description, ASX code or contract id.

## How suppliers are matched

AusTender identifies suppliers by ABN; the ASX company list does not include ABNs. So the plugin compares names after dropping corporate words (Pty, Ltd, Limited, Group, Holdings, Australia and similar):

1. The whole name, as in "Telstra Limited" → Telstra Group (TLS).
2. Failing that, its leading words, so a subsidiary such as "ResMed Asia Pacific" matches ResMed (RMD).

Guards against false matches:

- Names of three characters or fewer, and names two listed companies share, are never matched.
- A leading-words match needs at least five characters and cannot rest on one generic word such as "Environmental" or "Global".

Expect a few misses (a subsidiary with a different name) and the occasional wrong match; check the supplier before relying on one.

Each window's list is kept on disk, so the pane opens with it at once and asks AusTender again after 30 minutes; the footer says how old it is ([caching](caching.md)).

`gloomberb fn AUTN [--window 1D|3D|7D] [--asx] [--top N]` prints the list.

## Source

AusTender OCDS API (api.tenders.gov.au), Department of Finance, CC BY 3.0 AU. Contract amounts are in Australian dollars and include GST where the notice does.
