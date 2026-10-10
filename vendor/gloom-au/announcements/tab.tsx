import { EmptyState } from "gloomberb/components";
import { usePaneTickerIdentity } from "gloomberb/react";
import type { TickerResearchTabProps } from "gloomberb/types/plugin";
import { asxCodeForTicker } from "../shared/asx";
import { CompanyAnnouncements } from "./company-view";

/** The Announcements tab of Ticker Research, for ASX listings. */
export function AnnouncementsTab({ width, height, focused }: TickerResearchTabProps) {
  const { symbol, ticker } = usePaneTickerIdentity();
  const code = asxCodeForTicker(ticker, symbol);
  if (!code) return <EmptyState title="Announcements are for ASX listings." />;
  return (
    <CompanyAnnouncements
      key={code}
      code={code}
      fallbackName={ticker?.metadata.name || null}
      registrationId="au-announcements-tab"
      width={width}
      height={height}
      focused={focused}
    />
  );
}
