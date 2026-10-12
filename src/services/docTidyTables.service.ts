/**
 * Conversions between the agent's JSON output and its display tables
 * (`tableOutput.tables`: `{ title, columns, rows }[]`).
 *
 * See design-log/2026-10-09-doc-tidy-tabular-corrections-as-json.md.
 */

export interface AgentTableLike {
  title?: string;
  columns: string[];
  rows: unknown[][];
}

type JsonObject = Record<string, unknown>;

/** Header names that mark the first column of a two-column table as a label. */
const LABEL_HEADERS = new Set(['field', 'label', 'key', 'name', 'attribute']);

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const isObject = (v: unknown): v is JsonObject =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

const isScalar = (v: unknown) => v === null || (typeof v !== 'object' && typeof v !== 'function');

export function isAgentTable(v: unknown): v is AgentTableLike {
  return isObject(v) && Array.isArray(v.columns) && Array.isArray(v.rows);
}

function isKeyValueTable(table: AgentTableLike): boolean {
  return table.columns.length === 2 && LABEL_HEADERS.has(norm(table.columns[0]));
}

/** `PO Number` → `poNumber`, `Unit of Measure` → `unitOfMeasure`. */
function camelCase(label: string): string {
  const words = label.trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
}

function keyFor(label: string, templateKeys: string[]): string {
  return templateKeys.find((k) => norm(k) === norm(label)) ?? (camelCase(label) || label);
}

/** Non-scalar fields of an original object, which a table cannot represent. */
function nestedFields(obj: unknown): JsonObject {
  if (!isObject(obj)) return {};
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => !isScalar(v)));
}

/**
 * Rebuild agent-shaped JSON from (corrected) display tables, using the job's
 * original JSON as the template for key names and nesting. Original keys with
 * no table counterpart are kept, so the result is the original with the
 * table edits applied. A `tables` key is never emitted.
 *
 * `originalTables` (the tables the user started editing from) identifies
 * top-level labels the user removed or renamed, so their old keys are dropped.
 */
export function tablesToAgentJson(
  tables: AgentTableLike[],
  original: unknown,
  originalTables?: unknown,
): JsonObject {
  const base: JsonObject = isObject(original) ? original : {};
  const out: JsonObject = { ...base };
  delete out.tables;
  const topKeys = Object.keys(base).filter((k) => k !== 'tables');

  if (Array.isArray(originalTables)) {
    const labels = (list: AgentTableLike[]) =>
      new Set(list.filter(isKeyValueTable).flatMap((t) => t.rows.map((r) => norm(r[0]))));
    const kept = labels(tables);
    for (const label of labels(originalTables.filter(isAgentTable))) {
      if (kept.has(label)) continue;
      const key = topKeys.find((k) => norm(k) === label);
      if (key && isScalar(base[key])) delete out[key];
    }
  }

  tables.forEach((table, index) => {
    const titleKey = table.title ? topKeys.find((k) => norm(k) === norm(table.title)) : undefined;

    if (isKeyValueTable(table)) {
      const target = titleKey && isObject(base[titleKey]) ? titleKey : undefined;
      const template = target ? Object.keys(base[target] as JsonObject) : topKeys;
      const fields: JsonObject = {};
      for (const row of table.rows) {
        const label = String(row[0] ?? '').trim();
        if (label) fields[keyFor(label, template)] = row[1] ?? null;
      }
      if (target) out[target] = { ...nestedFields(base[target]), ...fields };
      else Object.assign(out, fields);
      return;
    }

    const target = titleKey ?? (camelCase(table.title ?? '') || `table${index + 1}`);
    const originalItems = Array.isArray(base[target]) ? (base[target] as unknown[]) : [];
    const templateKeys = [...new Set(originalItems.filter(isObject).flatMap((o) => Object.keys(o)))];
    const byName = table.columns.map((c) => templateKeys.find((k) => norm(k) === norm(c)));
    // The formatter emits one column per item key, in order, but may relabel
    // it (`qty` → `Quantity`), so fall back to position when the counts agree.
    const positional = templateKeys.length === table.columns.length;
    const columnKeys = table.columns.map((c, i) => {
      if (byName[i]) return byName[i] as string;
      const atIndex = positional ? templateKeys[i] : undefined;
      if (atIndex && !byName.includes(atIndex)) return atIndex;
      return camelCase(c) || c;
    });

    out[target] = table.rows.map((row, ri) => ({
      ...nestedFields(originalItems[ri]),
      ...Object.fromEntries(columnKeys.map((k, ci) => [k, row[ci] ?? null])),
    }));
  });

  return out;
}

/**
 * Extra search scopes for field extraction when the agent put document fields
 * inside a `tables` array: one object of key/value-table labels → values, and
 * one of grid-table titles → row objects keyed by column header.
 */
export function tableSearchScopes(json: JsonObject): JsonObject[] {
  if (!Array.isArray(json.tables)) return [];
  const fields: JsonObject = {};
  const grids: JsonObject = {};
  for (const table of json.tables.filter(isAgentTable)) {
    if (isKeyValueTable(table)) {
      for (const row of table.rows) {
        const label = String(row[0] ?? '').trim();
        if (label && !(label in fields)) fields[label] = row[1];
      }
    } else if (table.title) {
      grids[table.title] = table.rows.map((row) =>
        Object.fromEntries(table.columns.map((c, i) => [c, row[i] ?? null]))
      );
    }
  }
  return [fields, grids];
}
