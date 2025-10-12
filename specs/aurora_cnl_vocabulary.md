# Aurora CNL Vocabulary Catalog

> Drafted 2025-10-12 (Stage 0 English Edition) — Enumerates controlled natural language tokens for the CNL→`.aur` translator. Chinese lexemes are deferred to a future bilingual release.

## 1. Lexical Categories

| Category | Description |
|----------|-------------|
| Keyword | Reserved words defining syntax templates. |
| Structural | Punctuation / delimiters marking clause boundaries. |
| Literal | Numeric or string payloads. |
| Identifier | User-defined symbols (functions, variables, modules). |
| Qualifier | Ownership and mutability hints. |
| Control | Flow-control guards and operators. |
| Service | System interaction verbs mapped to `svc` semantics. |

## 2. Keyword Table

| Canonical Intent | Lexeme (Stage 0) | Notes |
|------------------|-------------------|-------|
| Module Decl | `module` | Declares compilation unit. |
| Function Decl | `define function` | Maps to `fn`. |
| Parameter Intro | `with parameters` | Introduces parameter list. |
| Return Type | `returns` | Lowers to `->`. |
| Block Begin | `begin` | Emits `{`. |
| Block End | `end` | Emits `}`. |
| Let Binding | `let` | Variable declaration. |
| Assignment | `set` | Emits `=`. |
| Return | `return` | Emits `return`. |

## 3. Structural Tokens

| Symbol | Purpose | Notes |
|--------|---------|-------|
| `。` / `.` | Clause terminator | Normalized to `.` before lexing. |
| `，` / `,` | Argument separator | Collapses contiguous separators. |
| `：` / `:` | Type annotation introducer | Maintains adjacent spacing. |
| `（` `）` / `(` `)` | Parameter delimiters | Normalized to ASCII pair. |
| `->` | Return arrow | Inserted during lowering, but lexer recognizes if author includes. |

## 4. Qualifiers

| Intent | Lexeme(s) | `.aur` Annotation |
|--------|-----------|-------------------|
| Mutable | `mutable` | `mut` |
| Immutable | `constant` | default (no marker) |
| Borrowed | `shared` | `borrow` (future scope) |

## 5. Control Flow Markers

| Intent | Lexeme | `.aur` Construct |
|--------|--------|------------------|
| Conditional | `if` | `if` |
| Else Branch | `otherwise` | `else` |
| Loop | `while` | `while` |
| Break | `break` | `break` |

## 6. Service Calls

| Intent | Lexeme(s) | `.aur` Hint |
|--------|-----------|-------------|
| Syscall Emit | `request service` | `svc` opcode with immediate |
| Console Output | `print` | helper lowering to `svc` 0x01 |

## 7. Literals

- **Integers**: Arabic digits `0-9`, optional sign.
- **Strings**: Quoted text using `""` or `“”`; lexer strips quotes and records encoding (UTF-8 only).
- **Booleans**: `true` / `false` / `真` / `假` mapped to `.aur` boolean literals.

## 8. Identifier Rules

- Allow ASCII letters, digits, `_` (Stage 0 scope). Future bilingual expansion may introduce identifier transliteration rules.
- Preserve original lexeme in metadata for diagnostics while storing canonical slug for `.aur` emission.

## 9. Normalization Pipeline

1. Unicode NFKC normalization.
2. Full-width punctuation mapped to ASCII equivalents.
3. Lexeme lookup against tables above; fall back to identifier/literal detection.
4. Record locale metadata (default `en`; placeholder for future bilingual support).

## 10. Open Items

- Expand qualifier list once ownership semantics broaden.
- Validate numeral normalization for large numbers.
- Consider idiom library for common service invocations beyond console I/O.
- Design bilingual extensions without affecting English-first canonical flow (tracked separately).
