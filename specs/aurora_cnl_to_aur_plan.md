# Aurora CNL → `.aur` Translator Plan

> Drafted 2025-10-12 — Strategy for implementing the Stage 0 natural-language compiler front-end.

## 1. Goals
- Accept controlled natural language (CNL) documents and emit canonical `.aur` modules.
- Preserve round-trip traceability (CNL sentence ↔ `.aur` span) for diagnostics.
- Produce structured intermediate graph (SIG) as a reusable artifact for later tooling.
- Align emitted `.aur` syntax with `specs/aurora_language_standard.md` and minimal ISA lowering requirements.

## 2. Milestones
1. **M0 — Grammar Skeleton (ETA 2025-10-15)**
   - Define CNL token catalog (bilingual keywords, literals, punctuation).
   - Implement tokenizer with position tracking.
   - Author sample corpus covering function declarations and constants.

2. **M1 — SIG Builder (ETA 2025-10-20)**
   - Construct AST-like node definitions (`FunctionDecl`, `Parameter`, `Literal`, `Invoke`).
   - Map parsed clauses to SIG nodes with GUID anchors.
   - Serialize SIG to JSON5 snapshots for tests.

3. **M2 — Lowering Engine (ETA 2025-10-27)**
   - Translate SIG into `.aur` syntax using deterministic pretty printer.
   - Enforce naming conventions and ownership annotations.
   - Generate `.aur` fixtures and validate against language standard examples.

4. **M3 — Seed DSL Bridge (ETA 2025-11-03)**
   - Feed `.aur` output into Stage 0 parser to obtain AST.
   - Emit `.aurs` manifests using minimal ISA emitters.
   - Execute via `aurseed` interpreter and compare with hand-authored manifests.

## 3. Components
- **`aurora-cnl-lexer`**: converts UTF-8 text into token stream with bilingual normalization.
- **`aurora-cnl-parser`**: deterministic clause parser generating draft AST.
- **`sig-builder`**: enriches AST with semantic metadata (types, ownership hints).
- **`aur-writer`**: renders `.aur` code, preserving traceability comments/sidebar metadata.
- **`translator-cli`**: command-line driver orchestrating the pipeline, emitting SIG and `.aur` artifacts.

### 3.1 Lexer Algorithm Sketch
```
tokens = []
cursor = 0
while cursor < text.length:
   ch = text[cursor]
   if is_whitespace(ch):
      cursor += 1; continue
   lexeme, span = read_next_grapheme_cluster(text, cursor)
   norm = normalize(lexeme)
   if keyword := lookup_keyword(norm):
      tokens.append(Token(KEYWORD, keyword, span))
   elif punct := lookup_structural(norm):
      tokens.append(Token(STRUCTURAL, punct, span))
   elif literal := match_literal(norm, text, cursor):
      tokens.append(literal)
      cursor = literal.span.end; continue
   elif ident := match_identifier(norm):
      tokens.append(Token(IDENT, ident.slug, span, meta={"lexeme": lexeme}))
   else:
      raise LexError(span, "unknown lexeme")
   cursor = span.end
```
> `normalize` applies Unicode NFKC, punctuation folding, and locale tagging as defined in `specs/aurora_cnl_vocabulary.md`.

## 4. Data Formats
- **Tokens**: `{ kind, lexeme, locale, span, guidelineRef }`.
- **SIG Nodes**: typed records with child ids; GUID anchors for original sentences.
- **`.aur` Output**: UTF-8, deterministic formatting, includes inline `//@cnl:<guid>` markers to preserve mapping.

## 5. Algorithms
- **Clause Parsing**: Pratt-style operator handling for expressions, using the Stage 0 English keyword table.
- **Type Inference**: default to explicit typing; literals carry type tags; future work may add inference.
- **Ownership Mapping**: interpret CNL qualifiers (`mutable`, `shared`) to `mut`, `borrow` markers in `.aur` syntax.

## 6. Validation Strategy
- Round-trip tests: CNL → SIG → `.aur` → parser → AST → pretty print; assert canonical form.
- Locale coverage: ensure English lexemes normalize consistently; bilingual parity tests are deferred backlog items.
- Integration: run generated `.aur` through minimal ISA lowering to produce `.aurs`, then execute smoke programs.

## 7. Risks & Mitigations
- **Ambiguous Grammar**: restrict Stage 0 CNL to deterministic templates; reject unsupported patterns with actionable diagnostics.
- **Traceability Gaps**: embed GUID markers early and propagate through every intermediate representation.
- **Schedule Creep**: lock scope to imperative subset (functions, calls, arithmetic, conditionals) before expanding.

## 8. Next Actions
- Validate token catalog in `specs/aurora_cnl_vocabulary.md` against existing language examples.
- Refine lexer pseudo-code into testable reference implementation notes (edge cases: punctuation clusters, mixed numerals).
- Identify 3–5 Stage 0 smoke tests (e.g., factorial, IO echo, conditional branch) and capture expected `.aur` output.
