/**
 * Fetches the live RBA F16 file and prints the curve the pane would show,
 * beside the RBA's own interpolated F2 yields for the same session.
 */
import { fetchSnapshot, USER_AGENT } from "../src/rba/client";
import { rbaDate } from "../src/rba/f16";

const snapshot = await fetchSnapshot();
console.log(`published ${snapshot.published}, session ${snapshot.latest.date}`);
for (const [id, session] of Object.entries(snapshot.lookbacks)) console.log(`  ${id} look-back: ${session.date}`);

const f2 = await (await fetch("https://www.rba.gov.au/statistics/tables/csv/f2-data.csv", { headers: { "User-Agent": USER_AGENT } })).text();
const row = f2.split("\n").find((line) => rbaDate(line.split(",")[0] ?? "") === snapshot.latest.date)?.split(",");
const published: Record<string, string | undefined> = { "2Y": row?.[1], "3Y": row?.[2], "5Y": row?.[3], "10Y": row?.[4] };

for (const point of snapshot.latest.points) {
  const f2Value = published[point.tenor];
  console.log(`${point.tenor.padStart(4)}  ${point.yield == null ? "   --" : point.yield.toFixed(3)}${f2Value ? `   F2 ${f2Value}` : ""}`);
}
