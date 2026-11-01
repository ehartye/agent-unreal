import { readFileSync } from 'node:fs';

export const documentSchema = JSON.parse(readFileSync(new URL('./schemas/document-v1.schema.json', import.meta.url), 'utf8'));
export const receiptSchema = JSON.parse(readFileSync(new URL('./schemas/receipt-v1.schema.json', import.meta.url), 'utf8'));
export const sourceSchema = JSON.parse(readFileSync(new URL('./schemas/source-v1.schema.json', import.meta.url), 'utf8'));

/** Evaluates the deliberately small JSON Schema vocabulary used by these contracts. */
export function validateSchema(value, schema, path = '$', root = schema) {
  const issues = [];
  const issue = (code, message) => issues.push({ code, path, message });
  if (schema.$ref) {
    const target = schema.$ref.split('/').slice(1).reduce((node, key) => node[key], root);
    return validateSchema(value, target, path, root);
  }
  if (schema.oneOf) {
    if (schema.oneOf.filter((candidate) => validateSchema(value, candidate, path, root).length === 0).length !== 1) issue('schema.union', 'must match exactly one documented variant');
    return issues;
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const match = (type) => type === undefined || (type === 'null' ? value === null : type === 'array' ? Array.isArray(value) : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : type === 'integer' ? Number.isSafeInteger(value) : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type);
  if (!types.some(match)) { issue('schema.type', `expected ${types.join(' or ')}`); return issues; }
  if (schema.const !== undefined && value !== schema.const) issue('schema.const', `expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) issue('schema.enum', 'value is not in the documented enumeration');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) issue('schema.finite', 'number must be finite');
    if (schema.minimum !== undefined && value < schema.minimum) issue('schema.minimum', `must be at least ${schema.minimum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) issue('schema.minimum', `must exceed ${schema.exclusiveMinimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) issue('schema.maximum', `must be at most ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) issue('schema.length', 'string is too short');
    if (schema.maxLength !== undefined && value.length > schema.maxLength) issue('schema.length', 'string is too long');
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) issue('schema.pattern', 'string does not match the documented pattern');
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) issue('schema.count', 'too few items');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issue('schema.count', 'too many items');
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) issue('schema.unique', 'duplicate items');
    value.forEach((item, index) => issues.push(...validateSchema(item, schema.items ?? {}, `${path}[${index}]`, root)));
  } else if (value !== null && typeof value === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) issues.push({ code: 'schema.required', path: `${path}.${key}`, message: 'required field is missing' });
    for (const [key, item] of Object.entries(value)) {
      const child = schema.properties?.[key];
      if (child) issues.push(...validateSchema(item, child, `${path}.${key}`, root));
      else if (schema.additionalProperties === false) issues.push({ code: 'schema.unknown', path: `${path}.${key}`, message: 'unknown field' });
      else if (typeof schema.additionalProperties === 'object') issues.push(...validateSchema(item, schema.additionalProperties, `${path}.${key}`, root));
      if (schema.propertyNames) issues.push(...validateSchema(key, schema.propertyNames, `${path}.${key}`, root));
    }
  }
  return issues;
}
