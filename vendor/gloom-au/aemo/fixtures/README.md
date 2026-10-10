# Fixtures

- `openelectricity-5m.json`: OpenElectricity `GET /v4/data/network/NEM?metrics=power&interval=5m&date_start=2026-10-09T16:00:00&primary_grouping=network_region&fueltech=solar_rooftop&fueltech=battery_charging&fueltech=battery_discharging` (10 October 2026, about 16:18 AEST), trimmed to NSW1, SA1 and TAS1 and the last 24 rows of each series. Rooftop ends at 14:25, batteries at 16:05.
- `openelectricity-1h.json`: the same at `interval=1h` for AEMO's 48-hour window (`date_start=2026-10-07T04:00:00`, `date_end=2026-10-09T04:00:00`), trimmed to SA1 and TAS1 and the first 12 hours.
