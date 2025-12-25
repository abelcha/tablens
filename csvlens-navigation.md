# CSVLens UI Navigation Guide

This document describes the user interface, navigation modes, and keybindings for `csvlens`.

## Core Concept: Modes
`csvlens` operates using a modal interface. You are primarily in **Default Mode**, where single keys perform navigation and actions. Specific keys switch the application into **Input Modes** (like Search, Filter, or Goto) where you type commands or queries.

---

## 1. Default Mode (Navigation)
These bindings apply when browsing the CSV data.

### 📍 Movement
| Key Combination | Action |
|----------------|--------|
| `←`, `↓`, `↑`, `→` | Scroll Left, Down, Up, Right |
| `Ctrl` + `f` / `PageDown` | Scroll one window down |
| `Ctrl` + `b` / `PageUp` | Scroll one window up |
| `Ctrl` + `d` / `d` | Scroll half window down |
| `Ctrl` + `u` / `u` | Scroll half window up |
| `Ctrl` + `←` | Scroll one window left (or to first col if Ctrl+Arrow) |
| `Ctrl` + `→` | Scroll one window right (or to last col if Ctrl+Arrow) |
| `g` / `Home` | Go to top |
| `G` / `End` | Go to bottom |

### 🔍 Search & Filter Actions
| Key | Action |
|-----|--------|
| `/` | Enter **Find Mode** (Regex search) |
| `&` | Enter **Filter Rows Mode** (Regex filter) |
| `*` | Enter **Filter Columns Mode** (Regex filter) |
| `n` | Jump to next search result |
| `N` (Shift+n) | Jump to previous search result |
| `#` | **Find Like Cell**: Search for rows matching the currently selected cell |
| `@` | **Filter Like Cell**: Filter to show only rows matching the currently selected cell |
| `r` | **Reset**: Clear all filters, searches, and column freezes |

### 📊 Data Manipulation & View
| Key | Action |
|-----|--------|
| `Tab` | **Cycle Selection Mode**: Row ↔ Column ↔ Cell |
| `Enter` | **Select**: Print selected cell/row to stdout and exit (Cell Mode) |
| `>` / `<` | Increase / Decrease width of the selected column |
| `Shift` + `J` | **Sort**: Toggle Sort (Auto-detect Numeric vs Lexicographic) |
| `Ctrl` + `j` | **Natural Sort**: Sort using natural order (e.g., "file2" < "file10") |
| `f` | Enter **Freeze Columns Mode** |
| `m` | Toggle **Visual Mark** on selected row |
| `Shift` + `M` | Clear all row marks |

### ⚙️ Options & Help
| Key | Action |
|-----|--------|
| `-` | Enter **Option Mode** (See below) |
| `?` / `H` | Toggle Help Menu |
| `q` | Quit Application |
| `y` | Copy selection to clipboard |

---

## 2. Input Modes
Triggered by specific keys in Default Mode. Invalid keys or `Esc` usually return to Default Mode.

### Goto Line Mode
*   **Trigger**: Type any number `0`-`9`.
*   **Action**: Input accumulates numbers.
*   **Confirm**: Press `Enter`, `g`, or `G` to jump to that line.

### Find Mode (`/`)
*   **Trigger**: Press `/`.
*   **Action**: Type a Regex pattern to highlight matches.
*   **History**: `↑` / `↓` key cycles through search history.
*   **Confirm**: `Enter` executes search.

### Filter Rows Mode (`&`)
*   **Trigger**: Press `&`.
*   **Action**: Type a Regex pattern. Only rows matching the pattern will be displayed.
*   **Confirm**: `Enter` applies filter.

### Filter Columns Mode (`*`)
*   **Trigger**: Press `*`.
*   **Action**: Type a Regex pattern. Only columns (headers) matching the pattern will be displayed.
*   **Confirm**: `Enter` applies filter.

### Freeze Columns Mode (`f`)
*   **Trigger**: Press `f`.
*   **Action**: Type a number.
*   **Confirm**: The input number is immediately applied as the number of columns to freeze from the left.

---

## 3. Option Mode (`-`)
Triggered by pressing `-`. This is a single-keystroke mode (no need to press Enter).

| Key | Action |
|-----|--------|
| `S` | Toggle **Soft Wrap** (wrap by characters) |
| `W` / `w` | Toggle **Word Wrap** (wrap by words) |
| `Esc` / `Enter` | Cancel / Exit Option Mode |

---

## 4. Selection Modes
Toggled via `TAB`. The active selection mode fundamentally changes how navigation keys work and what actions are available.

### 1. Row Mode (Default)
*   **Visual**: Highlights the entire row.
*   **Vertical Nav (`↓`/`↑`)**: Moves the selected row up/down. Scroll follows the selection.
*   **Horizontal Nav (`←`/`→`)**: **Scrolls the view** left/right. The selection "bar" stays on the same row and does not move horizontally (since it selects the whole row).
*   **Actions**:
    *   `y`: Copies the entire row content (tab-separated).
    *   `Enter`: Does nothing by default (unless `echo_column` is configured).
    *   `Sort`: Using `Ctrl+J` / `Shift+J` in this mode behaves ambiguously or defaults to the last selected column, as no column is explicitly selected. **It is recommended to use Column Mode for sorting.**

### 2. Column Mode
*   **Visual**: Highlights the entire column (header + all visible cells).
*   **Vertical Nav (`↓`/`↑`)**: **Scrolls the view** up/down. The selection "bar" stays on the same column and does not move vertically.
*   **Horizontal Nav (`←`/`→`)**: Moves the selected column left/right. Scroll follows the selection.
*   **Actions**:
    *   `J` / `Shift+J`: Sorts by the currently selected column.
    *   `y`: Does nothing (cannot copy a whole column to clipboard).

### 3. Cell Mode
*   **Visual**: Highlights a single cell (intersection of row & col).
*   **Vertical Nav (`↓`/`↑`)**: Moves the cell cursor up/down. Scrubbing occurs if moving past edges.
*   **Horizontal Nav (`←`/`→`)**: Moves the cell cursor left/right. Scrubbing occurs if moving past edges.
*   **Actions**:
    *   `y`: Copies the content of the single selected cell.
    *   `Enter`: Prints the content of the selected cell to stdout and exits.
    *   `#` / `@`: Search (`#`) or Filter (`@`) using the content of the selected cell.
    *   `Sort`: Sorts by the column of the selected cell.
