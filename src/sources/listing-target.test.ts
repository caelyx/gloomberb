import { expect, test } from "bun:test";
import { publicListingVenue } from "./listing-target";

test("a listing suffix names the home venue and outranks a saved one", () => {
  // A share-class dot is not a listing suffix.
  expect(publicListingVenue("BRK.B")).toEqual({ symbol: "BRK.B", exchange: "" });
  expect(publicListingVenue("BHP.AX", "NYSE")).toEqual({ symbol: "BHP", exchange: "ASX" });
  expect(publicListingVenue("BHP.AX:ASX")).toEqual({ symbol: "BHP", exchange: "ASX" });
  // A key that names a venue its suffix rules out is not a listing.
  expect(publicListingVenue("BHP.AX:NYSE")).toBeNull();
  expect(publicListingVenue("700.HK")).toEqual({ symbol: "0700", exchange: "HKEX" });
});
