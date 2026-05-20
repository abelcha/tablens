export function HelpModal() {
  const helpText = `
┌─ NAVIGATION ─────────────────────────────────────┐
│ ↑/k/K    Move up / Sort ascending               │
│ ↓/j/J    Move down / Sort descending             │
│ ←/h      Move left (cursor)                      │
│ →/l      Move right (cursor)                     │
│ PgUp/PgDn Scroll page up/down                    │
│ Tab      Cycle selection mode (row/col/cell)    │
├─ SEARCH & FILTER ────────────────────────────────┤
│ /        Enter search mode                       │
│ f        Column value filter (in column mode)    │
│ c        Toggle column compaction (header text)  │
├─ UI ─────────────────────────────────────────────┤
│ H or ?   Show/hide this help                     │
│ t        Toggle column type display              │
│ i        Toggle column stats display             │
│ . or >   Resize column wider                     │
│ , or <   Resize column narrower                  │
├─ SORTING ────────────────────────────────────────┤
│ Shift+↑/K or [   Sort ascending (toggle off)    │
│ Shift+↓/J or ]   Sort descending (toggle off)    │
└─────────────────────────────────────────────────────┘
  Press any key to close
  `;

  return (
    <box
      position="absolute"
      top={6}
      left={10}
      width={56}
      height={24}
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
