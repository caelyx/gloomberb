/** RFC 4180 fields: quoted, with doubled quotes inside. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quoted) {
      if (char === "\"" && line[index + 1] === "\"") { current += "\""; index += 1; }
      else if (char === "\"") quoted = false;
      else current += char;
    } else if (char === "\"") quoted = true;
    else if (char === ",") { fields.push(current); current = ""; }
    else current += char;
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}
