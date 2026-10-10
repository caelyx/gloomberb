# ASX options

ASX lists exchange-traded options on about a hundred large companies. This plugin feeds them into Gloomberb's own options views, so `OMON BHP`, the Options tab in Ticker Research and `gloomberb options BHP.AX` work for ASX shares the way they do for US ones. Gloomberb works out implied volatility and the greeks from the bid and ask, as it does for every chain.

- **Delay:** ASX shows options 20 minutes delayed, and the chain is labelled delayed.
- **Expiries:** every listed weekly and monthly expiry. The nearest monthly comes with the first request; others load when you pick them.
- **Contract style:** ASX lists many series in both American and European style; the European series sits a cent above the American strike (92 and 92.01). Gloomberb's chain has no style column, so the plugin shows the American series and uses European ones only for an expiry that has no American series at all.
- **Not covered:** index options (XJO), ASX 24 futures options and warrants. Funds such as VAS have no listed options.
- **Precedence:** if Gloom Cloud ever returns an ASX chain, Gloomberb uses it first; this plugin is only asked when the cloud has none.

The source is the options data behind asx.com.au company pages, under ASX's personal-use terms.
