# Fixtures

- `tradingview-xjo.json`: a real capture of TradingView's S&P/ASX 200 scan (`POST scanner.tradingview.com/australia/scan`, group `ASX:XJO`), taken on 2 October 2026 after the close and brought over from gloom-asx. All 199 rows; each row's `indexes` list is cut down to the XJO and XFL tags plus one foreign index, so the parser is shown to ignore the rest. 50 rows carry `ASX:XFL` (the ASX 50).
