export function HelpModal() {
  const helpText = `
┌─ NAVIGATION ─────────────────────────────────────────┐
│ ↑/k/K        Move up / sort asc                      │
│ ↓/j/J        Move down / sort desc                   │
│ ←/h          Move left                               │
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
      height={28}
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
