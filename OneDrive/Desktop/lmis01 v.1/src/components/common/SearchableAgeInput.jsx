import { useState, useRef, useEffect, useMemo } from "react";
import { Icon } from "../icons";

export const DEFAULT_AGE_SUGGESTIONS = [
  "3 months",
  "6 months",
  "8 months",
  "10 months",
  "12 months",
  "1 year",
  "1 year and 6 months",
  "18 months",
  "2 years",
  "2 years and 6 months",
  "3 years",
  "4 years",
  "5 years",
];

/**
 * Validates a typed or selected livestock age string.
 * Supports: "3 months", "6 months", "1 year", "2 years", "1 year and 6 months", "18 months", etc.
 * Returns null if valid, or an error message string if invalid.
 */
export const validateAgeInput = (ageStr) => {
  if (!ageStr || typeof ageStr !== "string" || !ageStr.trim()) {
    return "Please enter animal age.";
  }
  const clean = ageStr.trim();

  // Negative numbers check
  if (/-\s*\d+/.test(clean)) {
    return "Age cannot be negative.";
  }

  // Bare number without unit check
  if (/^\d+$/.test(clean)) {
    const n = parseInt(clean, 10);
    return `Please specify an age unit (e.g. ${clean} ${n === 1 ? "month" : "months"} or ${clean} ${n === 1 ? "year" : "years"}).`;
  }

  // Check if no numbers at all
  if (!/\d/.test(clean)) {
    return "Please enter a valid age with a number and unit (e.g. 6 months, 1 year).";
  }

  // Check for zero age
  if (/^0\s*(months?|mos?|years?|yrs?|days?|weeks?)/i.test(clean) || /^0$/.test(clean)) {
    return "Age must be greater than 0.";
  }

  // Check for valid unit presence
  const hasUnit = /(months?|mos?|years?|yrs?|weeks?|wks?|days?)/i.test(clean);
  if (!hasUnit) {
    return "Please include an age unit (e.g. months, years, or year and months).";
  }

  return null;
};

/**
 * Extracts structured age components for Supabase persistence
 * (age_months, age_value, age_unit) while preserving the exact original user string.
 */
export const extractAgeComponents = (ageStr) => {
  if (!ageStr || typeof ageStr !== "string") {
    return { age_months: "", age_value: null, age_unit: null };
  }
  const clean = ageStr.trim();
  if (!clean) {
    return { age_months: "", age_value: null, age_unit: null };
  }

  // Check for multi-part: e.g. "1 year and 6 months" or "2 years 3 mos"
  const multiPart = clean.match(/(\d+)\s*(?:years?|yrs?)\s*(?:and)?\s*(\d+)\s*(?:months?|mos?)/i);
  if (multiPart) {
    const years = parseInt(multiPart[1], 10) || 0;
    const months = parseInt(multiPart[2], 10) || 0;
    const totalMonths = years * 12 + months;
    return {
      age_months: clean,
      age_value: totalMonths,
      age_unit: "Months",
    };
  }

  // Check for years: e.g. "2 years", "1 year", "3 yrs"
  const yearMatch = clean.match(/(\d+)\s*(?:years?|yrs?)/i);
  if (yearMatch) {
    const val = parseInt(yearMatch[1], 10);
    return {
      age_months: clean,
      age_value: val,
      age_unit: val === 1 ? "Year" : "Years",
    };
  }

  // Check for months: e.g. "6 months", "18 months", "1 month"
  const monthMatch = clean.match(/(\d+)\s*(?:months?|mos?)/i);
  if (monthMatch) {
    const val = parseInt(monthMatch[1], 10);
    return {
      age_months: clean,
      age_value: val,
      age_unit: val === 1 ? "Month" : "Months",
    };
  }

  // Check for bare number fallback
  const numMatch = clean.match(/(\d+)/);
  if (numMatch) {
    const val = parseInt(numMatch[1], 10);
    return {
      age_months: clean,
      age_value: val,
      age_unit: "Months",
    };
  }

  return {
    age_months: clean,
    age_value: null,
    age_unit: null,
  };
};

/**
 * Searchable Age Dropdown Component with Manual Text Input.
 * - Allows selecting from suggested ages
 * - Allows typing any custom age manually (e.g. "1 year and 6 months", "18 months")
 * - Filters suggestions in real-time
 * - Responsive on desktop and mobile
 */
export const SearchableAgeInput = ({
  id,
  value = "",
  onChange,
  error = null,
  placeholder = "e.g. 6 months, 1 year, 1 year and 6 months",
  disabled = false,
  className = "",
  style = {},
  suggestions = DEFAULT_AGE_SUGGESTIONS,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  // Filter suggestions based on typed input
  const filteredSuggestions = useMemo(() => {
    const query = String(value || "").trim().toLowerCase();
    if (!query) return suggestions;
    return suggestions.filter((item) => item.toLowerCase().includes(query));
  }, [value, suggestions]);

  // Check if current value exactly matches an existing suggestion
  const exactMatch = useMemo(() => {
    const query = String(value || "").trim().toLowerCase();
    if (!query) return false;
    return suggestions.some((item) => item.toLowerCase() === query);
  }, [value, suggestions]);

  const handleSelectOption = (selectedVal) => {
    onChange(selectedVal);
    setIsOpen(false);
    setHighlightedIndex(-1);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (disabled) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(0);
      } else {
        setHighlightedIndex((prev) =>
          prev < filteredSuggestions.length - 1 ? prev + 1 : 0
        );
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(filteredSuggestions.length - 1);
      } else {
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredSuggestions.length - 1
        );
      }
    } else if (e.key === "Enter") {
      if (isOpen && highlightedIndex >= 0 && highlightedIndex < filteredSuggestions.length) {
        e.preventDefault();
        handleSelectOption(filteredSuggestions[highlightedIndex]);
      } else {
        setIsOpen(false);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll("[data-age-option]");
      if (items[highlightedIndex]) {
        items[highlightedIndex].scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex, isOpen]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        ...style,
      }}
    >
      <div style={{ position: "relative", display: "flex", alignItems: "center", width: "100%" }}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          className={`form-control ${className}`}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            if (!isOpen) setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          style={{
            width: "100%",
            height: 44,
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            background: "var(--color-bg)",
            color: "var(--color-text)",
            borderColor: error ? "#ef4444" : "var(--color-border)",
            paddingRight: 40,
            transition: "border-color 0.15s ease, box-shadow 0.15s ease",
          }}
        />

        {/* Dropdown Chevron Toggle Button */}
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => {
            if (isOpen) {
              setIsOpen(false);
            } else {
              setIsOpen(true);
              if (inputRef.current) inputRef.current.focus();
            }
          }}
          aria-label="Toggle age suggestions"
          style={{
            position: "absolute",
            right: 6,
            width: 32,
            height: 32,
            border: "none",
            background: "transparent",
            color: "var(--color-text-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: disabled ? "not-allowed" : "pointer",
            borderRadius: 6,
            transition: "transform 0.18s ease, color 0.15s ease",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            padding: 0,
          }}
        >
          <Icon.ChevronDown size={17} />
        </button>
      </div>

      {/* Floating Dropdown Suggestions */}
      {isOpen && !disabled && (
        <div
          ref={listRef}
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            maxHeight: 230,
            overflowY: "auto",
            background: "var(--color-surface, #ffffff)",
            border: "1.5px solid var(--color-border, #cbd5e1)",
            borderRadius: 8,
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
            zIndex: 100,
            padding: "4px",
          }}
        >
          {/* Header pill */}
          <div
            style={{
              padding: "4px 10px 6px",
              fontSize: 10.5,
              fontWeight: 800,
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              borderBottom: "1px solid var(--color-border)",
              marginBottom: 4,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>Suggested Ages</span>
            <span style={{ fontSize: 9.5, opacity: 0.8 }}>Click or type freely</span>
          </div>

          {filteredSuggestions.length > 0 ? (
            filteredSuggestions.map((item, index) => {
              const isSelected = String(value || "").trim().toLowerCase() === item.toLowerCase();
              const isHighlighted = highlightedIndex === index;

              return (
                <div
                  key={item}
                  data-age-option
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(e) => {
                    // Prevent input blur before click registers
                    e.preventDefault();
                    handleSelectOption(item);
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: isSelected ? 700 : 500,
                    color: isSelected
                      ? "var(--color-primary, #10b981)"
                      : "var(--color-text)",
                    background: isHighlighted
                      ? "var(--color-bg)"
                      : isSelected
                      ? "rgba(16, 185, 129, 0.08)"
                      : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                    transition: "background 0.12s ease",
                  }}
                >
                  <span>{item}</span>
                  {isSelected && <Icon.Check size={14} color="var(--color-primary, #10b981)" />}
                </div>
              );
            })
          ) : (
            <div
              style={{
                padding: "10px 12px",
                fontSize: 12,
                color: "var(--color-text-muted)",
                textAlign: "center",
                fontStyle: "italic",
              }}
            >
              No preset matches &ldquo;{value}&rdquo; — your custom age will be used.
            </div>
          )}

          {/* If user typed a custom age not in the suggestions, show custom option shortcut */}
          {String(value || "").trim() && !exactMatch && (
            <div
              data-age-option
              onMouseDown={(e) => {
                e.preventDefault();
                setIsOpen(false);
              }}
              style={{
                marginTop: 4,
                padding: "8px 12px",
                borderTop: "1px dashed var(--color-border)",
                fontSize: 12,
                color: "var(--color-text)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "rgba(2, 132, 199, 0.06)",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              <span>
                Use custom: <strong>&ldquo;{String(value || "").trim()}&rdquo;</strong>
              </span>
              <span style={{ fontSize: 10.5, color: "#0284c7", fontWeight: 700 }}>Custom</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
