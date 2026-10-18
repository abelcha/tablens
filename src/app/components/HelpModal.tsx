export function HelpModal() {
  const helpText = `
┌─ NAVIGATION ─────────────────────────────────────────┐
│ ↑/k/K        Move up / sort asc                      │
│ ↓/j/J        Move down / sort desc                   │
│ ←/h          Move left                               │
│ ←/h at first column  Open parent directory           │
│ →/l          Move right                              │
│ PgUp/PgDn    Page up / page down                     │
│ Tab          Cycle selection mode                    │
│ m / Space    Mark or unmark current row              │
│ Enter        Mark current row and move to next       │
│ Shift+I      Open column manager                     │
│ Shift+←/→    Move current column in column mode      │
├─ SEARCH & FILTER ────────────────────────────────────┤
│ /            Enter search mode                       │
│ f            Column value filter                     │
│ c            Cycle column widths                     │
├─ UI ─────────────────────────────────────────────────┤
│ H or ?       Show/hide this help                     │
│ t            Toggle column type display              │
│ i            Toggle inline column stats              │
│ Shift+↑/↓    Reorder selected column in modal        │
│ v            Inspect pane: row = record, cell = value│
│              column = struct fields / list items     │
│ V            Full screen; in column mode the column  │
│              opens as its own table (Esc/← back)     │
│ Enter        Full-screen inspect (cell mode)         │
│ o            Open inspected value in jless           │
│ . or >       Resize column wider                     │
│ , or <       Resize column narrower                  │
├─ SORTING ────────────────────────────────────────────┤
│ Shift+↑/K or [   Sort ascending (toggle off)         │
│ Shift+↓/J or ]   Sort descending (toggle off)        │
└───────────────────────────────────────────────────────┘
  Press any key to close
  `;

  return (
    <box
      position="absolute"
      top={3}
      left={4}
      width={74}
      height={helpText.split("\n").length + 1}
      style={{
        borderStyle: "single" as any,
      }}
      backgroundColor="#1a1a1a"
      borderColor="#00AAAA"
    >
      <text
        content={helpText}
        fg="#c0c0c0"
        marginLeft={1}
        marginTop={0}
      />
    </box>
  );
}
