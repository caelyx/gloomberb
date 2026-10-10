# NEM electricity

`NEM` shows wholesale electricity prices across the National Electricity Market (Queensland, New South Wales, Victoria, South Australia and Tasmania), useful context for generators and retailers such as AGL and Origin, and for energy-intensive industry. (`NEM` is also Newmont's ASX code: the command bar offers this pane first for it; open Newmont as `NEM.AX` or through search.)

- **Prices:** a map of Australia with each NEM state coloured by its current spot price and labelled with it, above a table of each region's spot price for the latest five-minute dispatch interval, its average, low and high over the last 24 hours of actual intervals, the share of those intervals at or below $0, and current demand. Prices are in A$ per megawatt-hour. Western Australia and the Northern Territory are not part of the NEM; the map shows them dim, without a price.
- **Generation:** the generation mix for the latest dispatch interval, for the region picked in the query bar (or the whole NEM): total MW, renewable share, battery discharge and the spot price, a stacked bar per fuel for the region and for the NEM beside it, and a table of each fuel's MW and share, with the NEM's figures alongside.
- **Mix history:** the mix over time for the selected region, `48h` (hourly), `3M` (daily) or `12M` (weekly), and `24h` (batteries at 5 minutes) with an OpenElectricity key (below). The upper chart draws each fuel's average MW; the lower one draws battery discharge with the hourly average spot price on its right axis (48h only, one region), so you can see batteries discharging into the evening price peak. Figures: the price the batteries' discharge earned on average (discharge-weighted) against the plain average spot price, the battery peak and its hour, and the renewable share of energy. The table gives each fuel's average, peak and low MW and share of energy over the window. The legend names every series with its latest value (or the value under the cursor), in compact form with the units on the axes; in a pane too narrow for both, the values give way and the names stay. The chart's time axis is labelled "Brisbane": Brisbane keeps AEST all year, so it is the same NEM time as the rest of the pane.
- **FCAS:** the latest interval's frequency control ancillary service prices ($/MW/h) for regulation and each contingency service, raise and lower, by region.
- **Notices:** AEMO's latest market notices (contingency reclassifications, price reviews, non-conformance).

Times are NEM market time, Australian Eastern Standard Time all year (no daylight saving). The pane refreshes every five minutes, in step with dispatch; the footer of the Prices, FCAS and Notices tabs names the current interval (Generation names it in its query bar, and Mix history shows an older window). `gloomberb fn NEM` prints the prices (with each region's price band in a Conditions column), the generation mix by region and fuel, the 48-hour mix and battery response for one region (`--region sa1`, or `nsw`, `qld`, `vic`, `tas`; default the whole NEM), FCAS prices and the notices.

### Generation mix: what the data covers

AEMO's dashboard reports generation by region and fuel type: black coal, brown coal, gas (not split into CCGT and OCGT), liquid fuel, hydro, biomass, wind, solar and battery. Its limits:

- **Solar is utility-scale only.** Rooftop PV is not in the report, so solar's share of what is actually used is understated, by a lot around midday. The pane labels it "Utility solar".
- **Battery is discharge only.** Charging is not reported, so batteries never appear as load, and their net position cannot be worked out. The pane labels it "Battery discharge". Charging data needs OpenElectricity (an optional API key, below) or AEMO's NEMweb files, which this plugin does not use.
- **The NEM total is the five regions summed.** There is no Western Australia.
- **History lags.** The hourly 48h window covers the last two complete trading days (04:00 to 04:00), so it ends about a day and a half before now; it is not rolling. The 3M window is daily and the 12M window weekly (each week from the date shown). History is in average MW (MWh in the period divided by its hours), so the windows compare. Hourly figures are labelled by the hour's end, as AEMO does; the hourly spot price is the mean of that hour's twelve 5-minute dispatch prices.
- **Renewable share** counts hydro, biomass, wind and utility solar against total generation; battery discharge counts in the total but not as renewable (it is stored energy).

Without an OpenElectricity key, the Generation and Mix history footers carry a quiet `no rooftop PV or charging` note: it is a standing limit of AEMO's data, not a failure, so it is not a warning.

### Rooftop solar and battery charging (optional OpenElectricity key)

[OpenElectricity](https://openelectricity.org.au) (formerly OpenNEM) publishes what AEMO's dashboard leaves out. Its API needs a key: sign up free at [platform.openelectricity.org.au](https://platform.openelectricity.org.au), then paste the key into the plugin's settings (command bar: "Set up Australian Markets", or `s` on the plugin in the Plugins pane, field **OpenElectricity API key**). The key is stored with your other Gloomberb settings, masked in the form, sent only to `api.openelectricity.org.au` in the `Authorization` header, and never printed in the pane, in `gloomberb fn` output or in error messages (which give only the HTTP status, never the server's text). Without a key the plugin makes no request to OpenElectricity at all.

**Removing the key.** Blanking the field in the settings form does not remove it (the form leaves an empty optional field as it was). Use the command bar's **Clear OpenElectricity API key** (listed only while a key is set): the pane, its chart series and `gloomberb fn NEM` go back to AEMO's figures alone. Failing that, with the app closed, delete `"openElectricityApiKey"` from the `"au-markets"` entry under `"pluginConfig"` in Gloomberb's `config.json` (in `~/.gloomberb`, or `$XDG_CONFIG_HOME/gloomberb`, or the folder `GLOOMBERB_HOME` names).

With a key:

- **Generation** adds **Rooftop solar** (beside utility solar) and **Battery charging** (beside discharge, as negative MW) to the region's and the NEM's mix, and a Charging figure. Rooftop PV is AEMO's half-hourly estimate and runs about an hour and a half behind dispatch, and charging can trail by an interval or two, so the query bar names the interval each comes from (`16:30 AEST, rooftop 14:25, charging 16:15`). Charging is a load, so it has no share and is not in the generation total; rooftop counts as renewable, so the renewable share rises (often a lot at midday).
- **Mix history** (`48h`, `3M`, `12M`) adds the same two series over AEMO's window: rooftop in the upper chart, charging below zero in the battery chart. In the 48h window a **Charged at** figure (the charging-weighted hourly spot price) sits beside **Battery sold at**. OpenElectricity labels an hour by its start and AEMO by its end, so hours are matched start + 1 h (within one 5-minute interval of AEMO's hour); 12M weeks are the mean of OpenElectricity's days in each of AEMO's weeks.
- **Mix history `24h`** (new range) shows the last 24 hours of grid batteries at 5-minute resolution: charging below zero and discharge above it, with the region's 5-minute spot price beneath (no price line for the NEM as a whole). Figures: **Spread** (sold at minus charged at), **Sold at** (discharge-weighted spot price), **Charged at** (charge-weighted) and the plain spot average. For the NEM that average is the simple mean of the regions' prices, labelled "regions' mean" (AEMO's price report carries no demand to weight them by), while each region's batteries are weighed against their own region's price. The table gives rooftop solar, discharge, charging and net with their average, peak (with its day and time, since the window crosses midnight) and the price their MW was weighted to. The spot prices refresh every five minutes with the view open.
- **`gloomberb fn NEM`** adds the two rows to the fuel matrix and the 48-hour mix, the charge-weighted hourly price, and a section on batteries against the 5-minute price over the last 24 hours (sold at, charged at, spread, MWh each way, peaks). It reads the key from the profile's settings.
- **Custom charts** gain `nem:<region>:rooftop` and `nem:<region>:battery-net` (discharge minus charging, negative while charging), 24 hours at 5 minutes, for each region and `NEM`, listed only once a key is set.

Where the figures come from: every coal, gas, hydro, wind, utility solar and battery discharge figure is AEMO's; rooftop solar, battery charging, the 24h view's discharge and net, and the battery chart series are OpenElectricity's (it splits AEMO's bidirectional battery units into a charging and a discharging part, per unit, so a region can show both in one interval); spot prices are always AEMO's. The footer credits OpenElectricity (`rooftop, charging OpenElectricity`) whenever its figures are on screen.

**Credits.** Each request costs credits (the free Community plan has 500 a day, 2 requests a second). The plugin asks for every region in one request and only when a view needs it: the last 24 hours at 5 minutes (shared by Generation, the 24h view and the chart series) at most every 10 minutes, and each history window once per 12 hours. Both are kept on disk (see [caching](caching.md)), `r` does not re-ask inside those windows, failed requests are not retried, and a closed pane asks for nothing. A day of the pane open all day uses about 150 credits; `gloomberb fn NEM` uses two per run (no disk cache there).

**Refusals.** A refusal that would only repeat is not asked again, since each try costs a credit: after a 401 (key refused) or 403 (request refused, for example by the plan) the plugin stops asking until the key in settings changes; after a 429 (rate limit or the day's credits) it waits for the server's `Retry-After`, and at least an hour. The notice says so and when it will ask again. This is remembered while the app runs; a restart tries once more. When a refresh fails and an earlier copy is on hand, Generation and Mix history keep using it and say how old it is (`Rooftop solar and battery charging are from 10 Oct 09:00 AEST (refresh failed): …`); an answer with no rooftop or battery rows for the window also gets a notice.

**Terms.** OpenElectricity's API documentation: "Unless stated otherwise, the data provided by the OpenElectricity API is licensed under the CC BY 4.0 license. Proper attribution to OpenElectricity at openelectricity.org.au as the source is required." Its plan table lists the free Community plan's licence as "Non-commercial use". The pane's footer credit and the `fn` note carry the attribution; use your own key, for your own non-commercial use.

Fuel colours come from the theme, so they keep their contrast in every theme: black coal grey (dim text), brown coal brown (amber and red toward muted), gas orange (amber and red), liquid fuel red (negative), hydro blue (the accent), biomass olive (green toward muted), wind green (positive), utility solar yellow (warning), rooftop solar pale yellow (warning toward bright text), battery purple (accent and red) and battery charging a duller purple, the spot price bright text. Fuels are listed in that order everywhere.

### Price conditions

The map, its legend and the table's price colours use the same bands:

| Band | Spot price ($/MWh) | Colour |
|---|---|---|
| Negative | below $0 | green |
| Low | $0 to $50 | pale green |
| Normal | $50 to $150 | grey (plain text in the table) |
| High | $150 to $300 | amber |
| Very high | $300 to $5,000 | orange |
| Extreme | $5,000 to 90% of the market price cap | red |
| At cap | from 90% of the market price cap | dark red |

Negative prices mean generators pay to keep running, usually with surplus solar or wind. The market price cap for 2026-27 is $23,200/MWh and the cumulative price threshold $2,225,900 (AEMC schedule of reliability settings for 2026-27, 27 February 2026, indexed each 1 July), so "At cap" starts at $20,880. The market floor is -$1,000/MWh. AEMO's own dashboard report of price limits still shows the 2025-26 figures ($20,300), so the plugin keeps the AEMC's figures in code and they are updated each July. During an administered price period AEMO caps prices at the administered price cap, $600/MWh, which falls in the Very high band. Colours follow the app theme; the price is always printed beside the colour. The legend highlights the bands in use.

The map takes the rows the table does not need, beside its legend in a wide pane. In a short pane it gives way to the table, and on a narrow map each state shows only its price. In the terminal the map is drawn in half-block cells, with neighbouring states in slightly different shades of their band colour so a shared band does not merge them; the desktop and web draw the outlines as vector shapes.

### In custom charts

Each region's spot price and demand are also in Gloomberb's chart catalogue as "Australian statistics" series, so they can be drawn in a custom chart (`G`) or found in the data catalogue (`CAT`): search for "electricity" or a state name, or add `CAP:au-markets:nem:SA1:price` (`NSW1`, `QLD1`, `VIC1`, `SA1`, `TAS1`; `:price` or `:demand`).

- **Price** (`nem:<region>:price`): the 5-minute dispatch price in $/MWh over the **last 7 days**, the longest history AEMO's public dashboard serves.
- **Demand** (`nem:<region>:demand`): 5-minute operational demand in MW over the **last 48 hours**.

Only actual dispatch intervals are charted, not AEMO's pre-dispatch forecast. The time axis and cursor read in NEM market time (AEST, UTC+10 all year; the axis labels it Brisbane, which keeps AEST), so during daylight saving the chart is an hour behind Sydney and Melbourne clocks. Use the chart's 1D or 1W range; longer ranges squeeze the week against the right edge. The series are fetched when a chart opens and kept in memory for a minute, not on disk (see [caching](caching.md)). If AEMO stops answering, the last copy (up to a day old) is shown with a warning naming its latest interval.

- **Generation by fuel** (`nem:<region>:fuel:<fuel>`): daily average MW over the last 3 months, for each region and `NEM` (the regions summed). Fuels: `black-coal`, `brown-coal`, `gas`, `liquid`, `hydro`, `biomass`, `wind`, `solar` (utility-scale only), `battery` (discharge only). Example: `CAP:au-markets:nem:SA1:fuel:wind`.
- **Battery discharge, hourly** (`nem:<region>:battery`): average MW per hour over the 48-hour window (ending about 1.5 days back), to set against the price series in one chart.

There are 60 generation series, more than the catalogue's first page lists; search for them by any words, such as "battery", "wind victoria" or "NEM gas". The 3-month, 12-month and 48-hour reports are kept on disk for three hours (see [caching](caching.md)).

Longer history (AEMO's monthly price and demand files on aemo.com.au, or NEMweb archives) would need hosts this plugin does not use.

## Source

AEMO's NEM data dashboard (visualisations.aemo.com.au), the data behind aemo.com.au's live prices. AEMO material is copyright AEMO and may be used for personal, non-commercial purposes with attribution. Optionally, rooftop solar and battery charging from OpenElectricity (api.openelectricity.org.au, CC BY 4.0, free plan for non-commercial use), with your own API key.
