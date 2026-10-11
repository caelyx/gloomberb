// Detail views: a result's full record (Devices, Records, the Landscape's
// Enter) and an estimate's assumptions (Estimates), rendered the same way.
import { forwardRef } from "react";
import { DetailScrollBody, KeyValueRow, Section } from "gloomberb/components";
import { colors } from "gloomberb/theme";
import { Box, Text, type ScrollBoxRenderable } from "gloomberb/ui";
import type { ErrorFormat } from "../format";
import { resultDetailSections, type DetailSection } from "../model/detail";
import type { Dataset, Result } from "../schema";

// A qualifier longer than this wraps on its own line instead of being cut off.
const INLINE_DETAIL = 28;

export const DetailSections = forwardRef<ScrollBoxRenderable, {
  sections: DetailSection[];
  resetKey: string;
  width: number;
  /** The source `o` opens, marked in the Sources section. */
  sourceIndex: number;
}>(function DetailSections({ sections, resetKey, width, sourceIndex }, ref) {
  const rowWidth = Math.max(20, width - 2);
  return (
    <DetailScrollBody ref={ref} resetScrollKey={resetKey}>
      <Box flexDirection="column">
        {sections.map((section, s) => (
          <Section key={section.title} title={section.title} width={rowWidth} marginTop={s === 0 ? 0 : 1}>
            {section.rows.map((row) => {
              const marked = section.title === "Sources" && row.label === String(sourceIndex + 1);
              const labelWidth = Math.min(28, Math.floor(rowWidth * 0.32));
              // Long values (notes, caveats) wrap below the label instead of being cut off.
              const longValue = row.value.length > rowWidth - labelWidth - 1;
              const inline = !longValue && row.detail && row.detail.length <= INLINE_DETAIL ? row.detail : undefined;
              const wrapped = [longValue ? row.value : null, row.detail && !inline ? row.detail : null]
                .filter((text): text is string => !!text);
              return (
                <Box key={`${section.title}:${row.label}`} flexDirection="column">
                  <KeyValueRow
                    label={marked ? `› ${row.label}` : row.label}
                    value={longValue ? "" : row.value}
                    detail={inline}
                    width={rowWidth}
                    labelWidth={labelWidth}
                  />
                  {wrapped.map((text, i) => (
                    <Box key={i} paddingLeft={2} width={rowWidth}>
                      <Text fg={longValue && i === 0 ? colors.text : colors.textMuted} wrapText>{text}</Text>
                    </Box>
                  ))}
                </Box>
              );
            })}
          </Section>
        ))}
      </Box>
    </DetailScrollBody>
  );
});

export const ResultDetail = forwardRef<ScrollBoxRenderable, {
  result: Result;
  dataset: Dataset;
  errorFormat: ErrorFormat;
  width: number;
  sourceIndex: number;
}>(function ResultDetail({ result, dataset, errorFormat, width, sourceIndex }, ref) {
  const device = dataset.devices.find((d) => d.id === result.device);
  const vendor = dataset.vendors.find((v) => v.id === device?.vendor);
  return (
    <DetailSections
      ref={ref}
      sections={resultDetailSections(result, device, vendor, errorFormat)}
      resetKey={result.id}
      width={width}
      sourceIndex={sourceIndex}
    />
  );
});
