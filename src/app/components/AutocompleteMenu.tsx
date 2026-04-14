/** @jsxImportSource @opentui/react */
import { parseInlineMarkup } from "src/app/markup";

export interface AutocompleteSuggestion {
  suggestion: string;
  suggestionStart: number;
}

export function AutocompleteMenu({
  suggestions,
  selectedIndex,
  visible,
  top,
  left,
}: {
  suggestions: AutocompleteSuggestion[];
  selectedIndex: number;
  visible: boolean;
  top: number;
  left: number;
}) {
  if (!visible || suggestions.length === 0) return null;

  const maxVisible = 8;
  const displaySuggestions = suggestions.slice(0, maxVisible);
  const menuWidth = Math.max(20, Math.max(...displaySuggestions.map(s => s.suggestion.length)) + 4);

  return (
    <box
      position="absolute"
      top={top}
      left={left}
      width={menuWidth}
      height={displaySuggestions.length + 2}
      backgroundColor="#21262d"
      border={true}
      borderStyle="single"
      borderColor="#30363d"
      zIndex={200}
    >
      {displaySuggestions.map((s, i) => {
        const isSelected = i === selectedIndex;
        const bg = isSelected ? "#388bfd" : "#21262d";
        const fg = isSelected ? "#ffffff" : "#c9d1d9";
        return (
          <box
            key={s.suggestion}
            top={i}
            left={0}
            width="100%"
            height={1}
            backgroundColor={bg}
          >
            <text
              content={parseInlineMarkup(` ${s.suggestion.padEnd(menuWidth - 3)} `)}
              textColor={fg}
            />
          </box>
        );
      })}
      {suggestions.length > maxVisible && (
        <text
          top={displaySuggestions.length}
          left={1}
          content={parseInlineMarkup(`{grey}+${suggestions.length - maxVisible} more{/grey}`)}
        />
      )}
    </box>
  );
}
