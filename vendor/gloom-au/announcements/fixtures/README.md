# Fixtures

- `predictive-cba.json`, `announcements-cba-page0.json`: real captures from ASX's search and entity feed (29 September 2026), brought over from gloom-asx. CBA's ten newest items at the time; the two newest were lodged by CAR Group, which the other-issuer tests rely on.
- `sample-announcement.pdf`: a hand-made one-page PDF with the "For personal use only" watermark ASX PDFs carry.
- `compressed-announcement.pdf`: a hand-made PDF with a Flate-compressed content stream and a binary header comment, so, like a real ASX PDF, it does not survive being decoded as text on the way.
- `company-bhp.html`: rows from asx.com.au's company announcements page (8 October 2026).
- `market.json`: four price-sensitive items from the market-wide feed (8 October 2026), trimmed to the fields the parser reads.
