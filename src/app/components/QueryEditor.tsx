/** @jsxImportSource @opentui/react */
import { useRef, forwardRef, useImperativeHandle, useEffect, useState, useCallback } from "react";
import { SyntaxStyle, parseColor } from "@opentui/core";
import { parseInlineMarkup } from "src/app/markup";
import { tokenizeSql, SQL_COLORS, type SQLTokenType } from "./sql-highlight";

export interface AutocompleteSuggestion {
  suggestion: string;
  suggestionStart: number;
}

// Unique ref counter for highlights
let hlRefCounter = 1;

// Trigger characters that auto-show completions (VSCode-like)
const TRIGGER_CHARS = new Set([".", "("]);

export interface QueryEditorRef {
  getText: () => string;
  triggerAutocomplete: () => void;
}

export interface QueryEditorProps {
  initialQuery: string;
  onSubmit: (query: string) => void;
  loading?: boolean;
  termHeight: number;
  getAutocompleteSuggestions?: (sql: string) => Promise<AutocompleteSuggestion[]>;
}

export const QueryEditor = forwardRef<QueryEditorRef, QueryEditorProps>(function QueryEditor({
  initialQuery,
  onSubmit,
  loading,
  termHeight,
  getAutocompleteSuggestions,
}, ref) {
  const textareaRef = useRef<any>(null);
  const syntaxStyleRef = useRef<SyntaxStyle | null>(null);
  const styleIdsRef = useRef<Map<SQLTokenType, number>>(new Map());
  const currentHlRefRef = useRef<number>(0);
  const lastTextRef = useRef<string>(initialQuery);

  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showAutocomplete, setShowAutocomplete] = useState(false);

  const status = loading ? " {yellow}Executing...{/yellow}" : "";

  // Initialize syntax style and register colors
  useEffect(() => {
    if (!textareaRef.current) return;

    const ta = textareaRef.current;

    const syntaxStyle = SyntaxStyle.create();
    syntaxStyleRef.current = syntaxStyle;

    for (const [tokenType, color] of Object.entries(SQL_COLORS)) {
      const styleId = syntaxStyle.registerStyle(tokenType, {
        fg: parseColor(color),
      });
      styleIdsRef.current.set(tokenType as SQLTokenType, styleId);
    }

    if (ta.editBuffer?.setSyntaxStyle) {
      ta.editBuffer.setSyntaxStyle(syntaxStyle);
    }

    return () => {
      syntaxStyle.destroy();
    };
  }, []);

  // Apply syntax highlighting
  const applyHighlighting = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta?.editBuffer || styleIdsRef.current.size === 0) return;

    const text = ta.plainText || "";

    if (currentHlRefRef.current > 0) {
      ta.editBuffer.removeHighlightsByRef(currentHlRefRef.current);
    }

    currentHlRefRef.current = hlRefCounter++;
    const hlRef = currentHlRefRef.current;

    const tokens = tokenizeSql(text);

    for (const token of tokens) {
      const styleId = styleIdsRef.current.get(token.type);
      if (styleId !== undefined) {
        ta.editBuffer.addHighlightByCharRange({
          start: token.start,
          end: token.end,
          styleId,
          priority: 1,
          hlRef,
        });
      }
    }
  }, []);

  // Fetch autocomplete suggestions
  const fetchSuggestions = useCallback(async () => {
    if (!getAutocompleteSuggestions) return;

    const ta = textareaRef.current;
    if (!ta) return;

    const text = ta.plainText || "";
    if (text.length < 1) {
      setSuggestions([]);
      setShowAutocomplete(false);
      return;
    }

    try {
      const results = await getAutocompleteSuggestions(text);
      setSuggestions(results);
      if (results.length > 0) {
        setShowAutocomplete(true);
        setSelectedIndex(0);
      } else {
        setShowAutocomplete(false);
      }
    } catch {
      setSuggestions([]);
      setShowAutocomplete(false);
    }
  }, [getAutocompleteSuggestions]);

  // Handle content changes - only highlighting, no auto-autocomplete
  const handleContentChange = useCallback(() => {
    applyHighlighting();

    const ta = textareaRef.current;
    if (!ta) return;

    const newText = ta.plainText || "";
    const oldText = lastTextRef.current;

    // Check if a trigger character was typed
    if (newText.length > oldText.length) {
      const addedChar = newText[newText.length - 1];
      if (TRIGGER_CHARS.has(addedChar)) {
        fetchSuggestions();
      } else {
        // Dismiss autocomplete when typing other characters
        setShowAutocomplete(false);
      }
    }

    lastTextRef.current = newText;
  }, [applyHighlighting, fetchSuggestions]);

  // Set up content change listener
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta?.editBuffer) return;

    ta.editBuffer.on("content-changed", handleContentChange);
    setTimeout(applyHighlighting, 0);

    return () => {
      ta.editBuffer.off("content-changed", handleContentChange);
    };
  }, [handleContentChange, applyHighlighting]);

  // Move cursor to end on mount
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta?.gotoBufferEnd) {
      ta.gotoBufferEnd();
    }
  }, []);

  // Handle autocomplete selection
  const handleAutocompleteSelect = useCallback((suggestion: string, suggestionStart: number) => {
    const ta = textareaRef.current;
    if (!ta) return;

    const text = ta.plainText || "";
    const newText = text.slice(0, suggestionStart) + suggestion;

    ta.setText(newText);
    ta.gotoBufferEnd();
    setShowAutocomplete(false);
    lastTextRef.current = newText;
  }, []);

  // Expose controls to parent
  const autocompleteControls = {
    isVisible: showAutocomplete,
    selectNext: () => setSelectedIndex(i => (i + 1) % Math.max(1, suggestions.length)),
    selectPrev: () => setSelectedIndex(i => (i - 1 + suggestions.length) % Math.max(1, suggestions.length)),
    confirm: () => {
      if (suggestions[selectedIndex]) {
        handleAutocompleteSelect(
          suggestions[selectedIndex].suggestion,
          suggestions[selectedIndex].suggestionStart
        );
      }
    },
    dismiss: () => setShowAutocomplete(false),
    trigger: fetchSuggestions,
  };

  useImperativeHandle(ref, () => ({
    getText: () => textareaRef.current?.plainText || "",
    triggerAutocomplete: fetchSuggestions,
    autocomplete: autocompleteControls,
  }), [autocompleteControls, fetchSuggestions]);

  const modalHeight = Math.min(20, Math.max(8, Math.floor(termHeight * 0.4)));

  // Position autocomplete menu: row 2 (below header), column based on cursor
  const menuRow = 2;
  const menuCol = 1;

  return (
    <box
      position="absolute"
      top={2}
      left={2}
      width="96%"
      height={modalHeight}
      backgroundColor="#0d1117"
      border={true}
      borderStyle="single"
      borderColor="#58a6ff"
      zIndex={100}
    >
      <box height={1} width="100%">
        <text content={parseInlineMarkup("{brightCyan}SQL Query{/brightCyan}{grey} (Enter run, Tab complete, Esc cancel){/grey}")} />
        <text content={parseInlineMarkup(status)} />
      </box>
      <textarea
        ref={textareaRef}
        focused={true}
        initialValue={initialQuery}
        flexGrow={1}
        backgroundColor="#161b22"
        textColor="#e6edf3"
        keyBindings={[
          { name: "return", action: "submit" },
          { name: "return", shift: true, action: "newline" },
        ]}
        onSubmit={() => {
          const text = textareaRef.current?.plainText || "";
          onSubmit(text);
        }}
      />
      {showAutocomplete && suggestions.length > 0 && (
        <box
          position="absolute"
          top={menuRow}
          left={menuCol}
          width={Math.min(40, Math.max(20, Math.max(...suggestions.slice(0, 8).map(s => s.suggestion.length)) + 4))}
          height={Math.min(8, suggestions.length) + 2}
          backgroundColor="#21262d"
          border={true}
          borderStyle="single"
          borderColor="#58a6ff"
          zIndex={300}
        >
          {suggestions.slice(0, 8).map((s, i) => {
            const isSelected = i === selectedIndex;
            return (
              <text
                key={i}
                top={i}
                left={1}
                content={s.suggestion}
                textColor={isSelected ? "#ffffff" : "#c9d1d9"}
                backgroundColor={isSelected ? "#388bfd" : "#21262d"}
              />
            );
          })}
          {suggestions.length > 8 && (
            <text
              top={8}
              left={1}
              content={`+${suggestions.length - 8} more`}
              textColor="#6e7681"
            />
          )}
        </box>
      )}
    </box>
  );
});
