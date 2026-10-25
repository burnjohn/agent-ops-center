# shared Gotchas

Known traps for this module. Short, curated, one heading per trap.

## Imports are restricted to `zod`

`shared/src/**` may import only `zod` and relative paths (ADR-0010). Anything else breaks one of the consumers.
