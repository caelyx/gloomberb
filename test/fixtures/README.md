# Test fixtures

`predictive-cba.json` and `announcements-cba-page0.json` are **real captures**
from the live Markit Digital endpoints behind asx.com.au, taken on
29 September 2026 with `bun run probe CBA --pdf` and copied unchanged from
`docs/research/samples/`. The `.meta.json` files beside the originals record
the request URL, status and headers.

The announcements page holds the ten newest items in CBA's feed at that time.
The two newest are notices lodged by another issuer (CAR Group's becoming- and
ceasing-to-be-a-substantial-holder notices naming CBA), which the parser and
view-model tests rely on.

`sample-announcement.pdf` is a hand-made one-page PDF that mimics the
"For personal use only" watermark ASX PDFs carry. Real PDFs are not committed.

`compressed-announcement.pdf` is a hand-made one-page PDF whose content
stream is Flate-compressed and whose header carries the usual binary comment,
so, like a real ASX PDF, it does not survive being decoded as UTF-8 text on
the way. The extract tests use it to show a damaged download is refused
rather than read as an empty document.
