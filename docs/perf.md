# Performance Architecture: Tablens vs. Csvlens

The transition from a naive rendering approach to an optimized, window-based system is what allows xlens to handle large datasets without the "lag" typically associated with terminal-based table views.

## 1. The "Big Data" Bottleneck

In early versions, the table attempted to:

- Calculate widths for every single row in the file.
- Re-render the entire table string on every keystroke.
- Use recursive or multi-pass loops to determine viewport offsets.

This resulted in `O(NM)` complexity (Rows \* Columns) on every frame, which is unsustainable for files with thousands of rows.

## 2. The Csvlens Philosophy (The "Game Changer")

By studying `csvlens`, we adopted a "Visible-First" architecture. This is a game changer for several reasons:

### A. Windowed Dimension Sampling

Instead of scanning 100,000 rows to find the "perfect" column width, we sample a **Sliding Window** (e.g., 10-20 rows around the current viewport).

- **Performance Impact:** Reduces width calculation from `O(Total Rows)` to `O(Viewport Rows)`.
- **Result:** Immediate responsiveness regardless of file size.

### B. Single-Pass Viewport Logic

`csvlens` calculates exactly what needs to be on screen in one pass. Our optimized `renderTable` now:

- Clamps the cursor.
- Direct-calculates the `rowsOffset` if the cursor is out of bounds (eliminating expensive `while` loops that shift offsets line-by-line).
- Only computes row heights for the rows that can actually fit on the screen.

### C. Decoupled Cursor Rendering

One of the biggest lag sources was full-screen string reconstruction to "highlight" a cell.

- **The Old Way:** Re-generate the entire ANSI string for the table, injecting `{bold}` tags into the specific cell.
- **The New Way:** Use an **Absolute Positioned Overlay** (`BoxRenderable`). The table text is rendered once as a background layer, and the cursor is just a lightweight box moving over it.
- **Performance Impact:** The terminal only needs to update the position of one small box rather than parsing and re-printing a massive ANSI string with complex styling tags.

### D. Efficient String Joins

By using `flatMap` and `join('')` instead of iterative string concatenation (`+=`), we reduce memory allocations. V8 (and Bun's JavaScript engine) can optimize these operations much better, preventing garbage collection pauses during fast scrolling.

## 3. Why this matters for User Experience

When you move the arrow key in a tool like `csvlens`, the latency is sub-16ms (allowing for 60fps). By adopting these patterns:

- **Instant Feedback:** The cursor moves immediately.
- **Low CPU Overhead:** The app doesn't spike CPU usage while idle or during simple navigation.
- **Scalability:** You can open a 1GB CSV file and the navigation remains as fluid as a 1KB file.

This implementation brings xlens closer to the performance profile of native Rust tools like `csvlens`, ensuring that the TypeScript/OpenTUI stack remains competitive for high-performance CLI data tools.
