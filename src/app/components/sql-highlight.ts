/**
 * Simple SQL syntax highlighter using regex patterns.
 * Returns highlight ranges that can be applied to OpenTUI's textarea via extmarks.
 */

export interface HighlightToken {
  start: number;
  end: number;
  type: SQLTokenType;
}

export type SQLTokenType =
  | "keyword"
  | "function"
  | "operator"
  | "string"
  | "number"
  | "comment"
  | "identifier"
  | "type"
  | "punctuation";

// DuckDB SQL keywords (comprehensive list)
const KEYWORDS = new Set([
  // DDL
  "CREATE", "ALTER", "DROP", "TRUNCATE", "RENAME", "ADD", "COLUMN",
  "TABLE", "VIEW", "INDEX", "SCHEMA", "DATABASE", "SEQUENCE", "TYPE",
  "FUNCTION", "MACRO", "PROCEDURE", "TRIGGER", "EXTENSION", "COPY",
  // DML
  "SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "UPSERT", "REPLACE",
  "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "FULL",
  "CROSS", "NATURAL", "ON", "USING", "GROUP", "BY", "HAVING", "ORDER",
  "ASC", "DESC", "NULLS", "FIRST", "LAST", "LIMIT", "OFFSET", "FETCH",
  "NEXT", "ROWS", "ONLY", "PERCENT", "WITH", "TIES", "UNION", "INTERSECT",
  "EXCEPT", "ALL", "DISTINCT", "AS", "INTO", "VALUES", "SET", "DEFAULT",
  // Clauses
  "CASE", "WHEN", "THEN", "ELSE", "END", "IF", "ELSIF", "LOOP", "WHILE",
  "FOR", "RETURN", "RETURNS", "BEGIN", "DECLARE", "EXCEPTION", "RAISE",
  // Operators
  "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN", "LIKE", "ILIKE", "SIMILAR",
  "IS", "NULL", "TRUE", "FALSE", "UNKNOWN", "ANY", "SOME", "EVERY",
  // Window functions
  "OVER", "PARTITION", "WINDOW", "ROWS", "RANGE", "UNBOUNDED", "PRECEDING",
  "FOLLOWING", "CURRENT", "ROW", "GROUPS", "EXCLUDE", "NO", "OTHERS",
  // CTE
  "RECURSIVE", "MATERIALIZED",
  // Transaction
  "COMMIT", "ROLLBACK", "SAVEPOINT", "TRANSACTION", "START", "BEGIN",
  // DuckDB specific
  "ATTACH", "DETACH", "EXPORT", "IMPORT", "SUMMARIZE", "DESCRIBE", "SHOW",
  "EXPLAIN", "ANALYZE", "PRAGMA", "CALL", "INSTALL", "LOAD", "FORCE",
  // Types
  "CAST", "TRY_CAST", "SAFE_CAST",
  // Constraints
  "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "UNIQUE", "CHECK", "CONSTRAINT",
  "DEFERRABLE", "INITIALLY", "DEFERRED", "IMMEDIATE", "CASCADE", "RESTRICT",
  // Misc
  "LATERAL", "UNNEST", "PIVOT", "UNPIVOT", "QUALIFY", "SAMPLE", "TABLESAMPLE",
  "PERCENT", "REPEATABLE", "SEED", "POSITIONAL", "STRUCT", "MAP", "LIST",
]);

// DuckDB types
const TYPES = new Set([
  "INT", "INTEGER", "BIGINT", "SMALLINT", "TINYINT", "HUGEINT", "UINTEGER",
  "UBIGINT", "USMALLINT", "UTINYINT", "UHUGEINT", "INT128", "UINT128",
  "FLOAT", "DOUBLE", "REAL", "DECIMAL", "NUMERIC", "DEC",
  "VARCHAR", "CHAR", "CHARACTER", "TEXT", "STRING", "BPCHAR", "NAME",
  "BLOB", "BYTEA", "BINARY", "VARBINARY",
  "BOOLEAN", "BOOL", "LOGICAL",
  "DATE", "TIME", "TIMESTAMP", "TIMESTAMPTZ", "DATETIME", "INTERVAL",
  "UUID", "JSON", "ENUM", "ARRAY", "STRUCT", "MAP", "LIST", "UNION",
  "BIT", "BITSTRING",
]);

// DuckDB aggregate and scalar functions
const FUNCTIONS = new Set([
  // Aggregate
  "COUNT", "SUM", "AVG", "MIN", "MAX", "FIRST", "LAST", "ANY_VALUE",
  "STDDEV", "STDDEV_SAMP", "STDDEV_POP", "VARIANCE", "VAR_SAMP", "VAR_POP",
  "COVAR_SAMP", "COVAR_POP", "CORR", "REGR_SLOPE", "REGR_INTERCEPT",
  "STRING_AGG", "LISTAGG", "GROUP_CONCAT", "ARRAY_AGG", "LIST",
  "HISTOGRAM", "MODE", "QUANTILE", "MEDIAN", "PERCENTILE_CONT", "PERCENTILE_DISC",
  "APPROX_COUNT_DISTINCT", "APPROX_QUANTILE", "RESERVOIR_QUANTILE",
  "BIT_AND", "BIT_OR", "BIT_XOR", "BOOL_AND", "BOOL_OR",
  "ARG_MIN", "ARG_MAX", "MIN_BY", "MAX_BY",
  "PRODUCT", "FSUM", "KAHAN_SUM", "ENTROPY",
  // Window
  "ROW_NUMBER", "RANK", "DENSE_RANK", "PERCENT_RANK", "CUME_DIST",
  "NTILE", "LAG", "LEAD", "FIRST_VALUE", "LAST_VALUE", "NTH_VALUE",
  // String
  "CONCAT", "CONCAT_WS", "LENGTH", "LOWER", "UPPER", "TRIM", "LTRIM", "RTRIM",
  "SUBSTR", "SUBSTRING", "LEFT", "RIGHT", "LPAD", "RPAD", "REPEAT", "REVERSE",
  "REPLACE", "REGEXP_REPLACE", "REGEXP_MATCHES", "REGEXP_EXTRACT", "REGEXP_FULL_MATCH",
  "SPLIT", "SPLIT_PART", "STRPOS", "POSITION", "INSTR", "CONTAINS", "STARTS_WITH",
  "PREFIX", "SUFFIX", "ENDS_WITH", "ASCII", "CHR", "ORD", "UNICODE", "UNISTR",
  "FORMAT", "PRINTF", "MD5", "SHA256", "HASH", "ENCODE", "DECODE",
  "LEVENSHTEIN", "JARO_WINKLER_SIMILARITY", "HAMMING", "JACCARD",
  // Numeric
  "ABS", "CEIL", "CEILING", "FLOOR", "ROUND", "TRUNC", "TRUNCATE",
  "MOD", "POWER", "POW", "SQRT", "CBRT", "EXP", "LN", "LOG", "LOG2", "LOG10",
  "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN", "ATAN2", "COT",
  "SINH", "COSH", "TANH", "ASINH", "ACOSH", "ATANH",
  "DEGREES", "RADIANS", "PI", "SIGN", "GREATEST", "LEAST",
  "RANDOM", "SETSEED", "GCD", "LCM", "FACTORIAL", "GAMMA", "LGAMMA",
  "EVEN", "ODD", "BIT_COUNT", "ISNAN", "ISINF", "ISFINITE",
  // Date/Time
  "NOW", "CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP", "TODAY",
  "DATE_PART", "DATEPART", "EXTRACT", "DATE_TRUNC", "DATETRUNC",
  "DATE_DIFF", "DATEDIFF", "DATE_ADD", "DATEADD", "DATE_SUB",
  "AGE", "MAKE_DATE", "MAKE_TIME", "MAKE_TIMESTAMP", "MAKE_TIMESTAMPTZ",
  "STRFTIME", "STRPTIME", "TO_TIMESTAMP", "EPOCH", "EPOCH_MS", "EPOCH_US", "EPOCH_NS",
  "YEAR", "MONTH", "DAY", "HOUR", "MINUTE", "SECOND", "MILLISECOND", "MICROSECOND",
  "DAYOFWEEK", "DAYOFYEAR", "DAYOFMONTH", "WEEKOFYEAR", "WEEK", "QUARTER",
  "LAST_DAY", "MONTHNAME", "DAYNAME", "TIMEZONE", "TIMEZONE_HOUR", "TIMEZONE_MINUTE",
  // NULL handling
  "COALESCE", "NULLIF", "IFNULL", "NVL", "NVL2",
  // Conditional
  "IF", "IIF", "CASE", "WHEN", "NULLIF", "GREATEST", "LEAST",
  // Type conversion
  "CAST", "TRY_CAST", "TYPEOF", "COLUMNS",
  // List/Array
  "ARRAY_LENGTH", "LEN", "LIST_SORT", "LIST_REVERSE", "LIST_DISTINCT",
  "LIST_UNIQUE", "LIST_CONTAINS", "LIST_POSITION", "LIST_SLICE",
  "LIST_FILTER", "LIST_TRANSFORM", "LIST_REDUCE", "LIST_AGGREGATE",
  "FLATTEN", "UNNEST", "GENERATE_SERIES", "RANGE", "GENERATE_SUBSCRIPTS",
  // Struct/Map
  "STRUCT_PACK", "STRUCT_INSERT", "STRUCT_EXTRACT", "ROW",
  "MAP_KEYS", "MAP_VALUES", "MAP_ENTRIES", "MAP_FROM_ENTRIES", "ELEMENT_AT",
  "CARDINALITY",
  // JSON
  "JSON_EXTRACT", "JSON_EXTRACT_STRING", "JSON_EXTRACT_PATH", "JSON_EXTRACT_PATH_TEXT",
  "JSON_ARRAY", "JSON_OBJECT", "JSON_MERGE_PATCH", "JSON_VALID", "JSON_TYPE",
  "JSON_KEYS", "JSON_STRUCTURE", "JSON_ARRAY_LENGTH", "JSON_CONTAINS",
  "TO_JSON", "FROM_JSON", "READ_JSON", "READ_JSON_AUTO", "READ_JSON_OBJECTS",
  // File/Table functions
  "READ_CSV", "READ_CSV_AUTO", "READ_PARQUET", "PARQUET_SCAN", "PARQUET_METADATA",
  "READ_JSON", "READ_JSON_AUTO", "GLOB", "READ_BLOB",
  "SCAN_ICEBERG", "ICEBERG_SCAN", "DELTA_SCAN",
  // Utility
  "VERSION", "CURRENT_CATALOG", "CURRENT_SCHEMA", "CURRENT_USER", "SESSION_USER",
  "ALIAS", "CHECKPOINT", "ENABLE_PROGRESS_BAR", "ENABLE_PROFILING",
  "RANGE", "GENERATE_SERIES",
]);

/**
 * Tokenize SQL string into highlight tokens
 */
export function tokenizeSql(sql: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  let i = 0;

  while (i < sql.length) {
    // Skip whitespace
    if (/\s/.test(sql[i])) {
      i++;
      continue;
    }

    // Single-line comment
    if (sql[i] === "-" && sql[i + 1] === "-") {
      const start = i;
      while (i < sql.length && sql[i] !== "\n") i++;
      tokens.push({ start, end: i, type: "comment" });
      continue;
    }

    // Multi-line comment
    if (sql[i] === "/" && sql[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < sql.length - 1 && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      tokens.push({ start, end: i, type: "comment" });
      continue;
    }

    // String (single quotes)
    if (sql[i] === "'") {
      const start = i;
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2; // escaped quote
        } else if (sql[i] === "'") {
          i++;
          break;
        } else {
          i++;
        }
      }
      tokens.push({ start, end: i, type: "string" });
      continue;
    }

    // String (double quotes - identifiers in DuckDB)
    if (sql[i] === '"') {
      const start = i;
      i++;
      while (i < sql.length && sql[i] !== '"') i++;
      if (i < sql.length) i++;
      tokens.push({ start, end: i, type: "identifier" });
      continue;
    }

    // Dollar-quoted strings
    if (sql[i] === "$") {
      const start = i;
      let tagEnd = i + 1;
      while (tagEnd < sql.length && /[a-zA-Z0-9_]/.test(sql[tagEnd])) tagEnd++;
      if (sql[tagEnd] === "$") {
        const tag = sql.slice(i, tagEnd + 1);
        i = tagEnd + 1;
        const closeIdx = sql.indexOf(tag, i);
        if (closeIdx !== -1) {
          i = closeIdx + tag.length;
          tokens.push({ start, end: i, type: "string" });
          continue;
        }
      }
      // Not a dollar-quoted string, treat as operator
      tokens.push({ start: i, end: i + 1, type: "operator" });
      i++;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(sql[i]) || (sql[i] === "." && /[0-9]/.test(sql[i + 1]))) {
      const start = i;
      // Integer or decimal part
      while (i < sql.length && /[0-9]/.test(sql[i])) i++;
      if (sql[i] === "." && /[0-9]/.test(sql[i + 1])) {
        i++;
        while (i < sql.length && /[0-9]/.test(sql[i])) i++;
      }
      // Scientific notation
      if ((sql[i] === "e" || sql[i] === "E") && /[0-9+-]/.test(sql[i + 1])) {
        i++;
        if (sql[i] === "+" || sql[i] === "-") i++;
        while (i < sql.length && /[0-9]/.test(sql[i])) i++;
      }
      tokens.push({ start, end: i, type: "number" });
      continue;
    }

    // Operators and punctuation
    if (/[+\-*/%<>=!&|^~@#?:]/.test(sql[i])) {
      const start = i;
      // Multi-character operators
      const twoChar = sql.slice(i, i + 2);
      const threeChar = sql.slice(i, i + 3);
      if (["<=>", "<>", "!=", "<=", ">=", "||", "&&", "->", "->>", "::"].includes(twoChar)) {
        i += 2;
      } else if (["<->"].includes(threeChar)) {
        i += 3;
      } else {
        i++;
      }
      tokens.push({ start, end: i, type: "operator" });
      continue;
    }

    // Punctuation
    if (/[(),;.\[\]{}]/.test(sql[i])) {
      tokens.push({ start: i, end: i + 1, type: "punctuation" });
      i++;
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(sql[i])) {
      const start = i;
      while (i < sql.length && /[a-zA-Z0-9_]/.test(sql[i])) i++;
      const word = sql.slice(start, i).toUpperCase();

      // Check if it's followed by an opening paren (function call)
      let nextNonSpace = i;
      while (nextNonSpace < sql.length && /\s/.test(sql[nextNonSpace])) nextNonSpace++;
      const isFunction = sql[nextNonSpace] === "(";

      if (KEYWORDS.has(word)) {
        tokens.push({ start, end: i, type: "keyword" });
      } else if (TYPES.has(word)) {
        tokens.push({ start, end: i, type: "type" });
      } else if (FUNCTIONS.has(word) || isFunction) {
        tokens.push({ start, end: i, type: "function" });
      } else {
        tokens.push({ start, end: i, type: "identifier" });
      }
      continue;
    }

    // Unknown character, skip
    i++;
  }

  return tokens;
}

// Color scheme for SQL highlighting (matching dark mode)
export const SQL_COLORS: Record<SQLTokenType, string> = {
  keyword: "#ff79c6",      // Pink/magenta for keywords
  function: "#50fa7b",     // Green for functions
  operator: "#ff79c6",     // Pink for operators
  string: "#f1fa8c",       // Yellow for strings
  number: "#bd93f9",       // Purple for numbers
  comment: "#6272a4",      // Gray for comments
  identifier: "#f8f8f2",   // White for identifiers
  type: "#8be9fd",         // Cyan for types
  punctuation: "#f8f8f2",  // White for punctuation
};
