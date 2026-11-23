(function (global) {
  "use strict";

  /**
   * Embedded Contextual Monaco Editor for V3 Model-Driven Hook Functions:
   *  - Renders the complete composed `src/states/<state>.rs` file so the user
   *    sees exact context (doc comments, signature, surrounding functions)
   *  - Strictly locks every line outside `[editableStartLine, editableEndLine]`
   *    with visual dimming + keystroke & model-change guards (read-only surrounding file)
   *  - Live WebGME IntelliSense (`globals.<field>` + event `payload`, zero `StateId`/`Outcome`/`Event`)
   *  - Sub-ms edit-time diagnostics via `RustyAnalyzer.analyzeHookBody` aligned to file lines
   *  - Graceful fallback to body `<textarea>` if Monaco fails to load
   */
  class MonacoStateEditor {
    constructor(hostEl, opts = {}) {
      this.hostEl = hostEl;
      this.onChange = opts.onChange || (() => {});
      this.onDiagnostics = opts.onDiagnostics || (() => {});
      this.onSaveShortcut = opts.onSaveShortcut || (() => {});
      this.onReadOnlyBlocked = opts.onReadOnlyBlocked || (() => {});

      this.monaco = null;
      this.editor = null;
      this.fallbackTextarea = null;
      this.currentModel = null;
      this.currentState = null;
      this.currentStateId = null;

      this._contextualLocked = false;
      this._editableStartLine = 1;
      this._editableEndLine = 1;
      this._lastValidEndLine = 1;
      this._lastValidCode = "";
      this._hookContext = { kind: "entry", payloadType: "" };

      this._decorations = [];
      this._suppressChange = false;
      this._reverting = false;
      this._analyzeTimer = null;
      this._pendingValue = "";
      this._readyPromise = null;
      this._lastAnalysis = { diagnostics: [], durationMs: 0, stats: { errors: 0, warnings: 0, total: 0 } };
    }

    init() {
      if (this._readyPromise) return this._readyPromise;

      this._readyPromise = new Promise((resolve) => {
        if (global.monaco && global.monaco.editor) {
          this._mountMonaco(global.monaco);
          resolve(true);
          return;
        }

        const script = document.createElement("script");
        script.src = "/routers/studio/vendor/monaco/vs/loader.js";
        script.async = true;
        script.onload = () => {
          if (typeof global.require !== "function" || !global.require.config) {
            this._mountFallback();
            resolve(false);
            return;
          }
          global.require.config({
            paths: { vs: "/routers/studio/vendor/monaco/vs" },
          });
          global.require(["vs/editor/editor.main"], () => {
            if (global.monaco && global.monaco.editor) {
              this._mountMonaco(global.monaco);
              resolve(true);
            } else {
              this._mountFallback();
              resolve(false);
            }
          });
        };
        script.onerror = () => {
          this._mountFallback();
          resolve(false);
        };
        document.head.appendChild(script);
      });

      return this._readyPromise;
    }

    _mountMonaco(monaco) {
      this.monaco = monaco;
      this.hostEl.innerHTML = "";

      if (!global.__rustyMonacoCompletionRegistered) {
        global.__rustyMonacoCompletionRegistered = true;
        monaco.languages.registerCompletionItemProvider("rust", {
          triggerCharacters: ["."],
          provideCompletionItems: (textModel, position) => {
            const ctx = global.__rustyActiveEditorContext;
            if (!ctx || !ctx.model) return { suggestions: [] };

            const lineUntil = textModel.getLineContent(position.lineNumber).slice(0, position.column - 1);
            const word = textModel.getWordUntilPosition(position);
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            };

            const suggestions = [];
            const { toSnakeCase } = global.RustyContract;

            if (/globals\.[a-zA-Z0-9_]*$/.test(lineUntil)) {
              for (const g of ctx.model.globals || []) {
                const key = toSnakeCase(g.name);
                suggestions.push({
                  label: key,
                  kind: monaco.languages.CompletionItemKind.Field,
                  detail: `${g.rustType} (default: ${g.initialValue})`,
                  documentation: g.description || `WebGME GlobalVar \`${key}: ${g.rustType}\``,
                  insertText: key,
                  range,
                });
              }
              return { suggestions };
            }

            if (ctx.hookContext && ctx.hookContext.kind === "transition" && ctx.hookContext.payloadType) {
              suggestions.push({
                label: "payload",
                kind: monaco.languages.CompletionItemKind.Variable,
                detail: `${ctx.hookContext.payloadType} (trigger event payload)`,
                insertText: "payload",
                range,
              });
            }

            suggestions.push({
              label: "globals",
              kind: monaco.languages.CompletionItemKind.Variable,
              detail: "&mut Globals (shared machine state)",
              insertText: "globals.",
              range,
            });

            return { suggestions };
          },
        });
      }

      this.editor = monaco.editor.create(this.hostEl, {
        value: this._pendingValue || "",
        language: "rust",
        theme: "vs-dark",
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 12.5,
        lineNumbersMinChars: 3,
        scrollBeyondLastLine: false,
        renderWhitespace: "selection",
        tabSize: 4,
        padding: { top: 6, bottom: 6 },
        quickSuggestions: true,
        glyphMargin: true,
      });

      // Keep global active context fresh on focus
      this.editor.onDidFocusEditorText(() => {
        global.__rustyActiveEditorContext = {
          model: this.currentModel,
          state: this.currentState,
          hookContext: this._hookContext,
        };
      });

      // Cmd/Ctrl+A selects strictly the editable hook body when locked
      this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyA, () => {
        const textModel = this.editor.getModel();
        if (!textModel) return;
        if (!this._contextualLocked) {
          this.editor.setSelection(textModel.getFullModelRange());
          return;
        }
        const maxCol = textModel.getLineMaxColumn(this._editableEndLine);
        this.editor.setSelection({
          startLineNumber: this._editableStartLine,
          startColumn: 1,
          endLineNumber: this._editableEndLine,
          endColumn: maxCol,
        });
      });

      // Cmd+S / Ctrl+S -> Save hook body
      this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        this.onSaveShortcut(this.getEditableBody());
      });

      // Layer 1 Keydown Guard: block mutating keys touching read-only lines
      this.editor.onKeyDown((e) => {
        if (!this._contextualLocked) return;
        const textModel = this.editor.getModel();
        if (!textModel) return;

        // Allow pure navigation / clipboard copy / search / save shortcut
        const kc = e.keyCode;
        const KeyCode = monaco.KeyCode;
        const isModifierOnly =
          kc === KeyCode.Shift || kc === KeyCode.Ctrl || kc === KeyCode.Alt || kc === KeyCode.Meta;
        const isNav =
          kc === KeyCode.LeftArrow ||
          kc === KeyCode.RightArrow ||
          kc === KeyCode.UpArrow ||
          kc === KeyCode.DownArrow ||
          kc === KeyCode.Home ||
          kc === KeyCode.End ||
          kc === KeyCode.PageUp ||
          kc === KeyCode.PageDown ||
          kc === KeyCode.Escape;
        const isReadCmd =
          (e.metaKey || e.ctrlKey) &&
          (kc === KeyCode.KeyC || kc === KeyCode.KeyF || kc === KeyCode.KeyA || kc === KeyCode.KeyS);

        if (isModifierOnly || isNav || isReadCmd) return;

        const sels = this.editor.getSelections() || [];
        for (const sel of sels) {
          const sLine = sel.startLineNumber;
          const eLine = sel.endLineNumber;
          if (sLine < this._editableStartLine || eLine > this._editableEndLine) {
            e.preventDefault();
            e.stopPropagation();
            this.onReadOnlyBlocked();
            return;
          }
          if (sel.isEmpty()) {
            if (kc === KeyCode.Backspace && sLine === this._editableStartLine && sel.startColumn <= 1) {
              e.preventDefault();
              e.stopPropagation();
              this.onReadOnlyBlocked();
              return;
            }
            if (
              kc === KeyCode.Delete &&
              eLine === this._editableEndLine &&
              sel.endColumn >= textModel.getLineMaxColumn(this._editableEndLine)
            ) {
              e.preventDefault();
              e.stopPropagation();
              this.onReadOnlyBlocked();
              return;
            }
          }
        }
      });

      // Layer 2 Invariant Guard on model content change
      this.editor.onDidChangeModelContent((event) => {
        if (this._suppressChange || this._reverting) return;
        const textModel = this.editor.getModel();
        if (!textModel) return;

        if (this._contextualLocked) {
          const validLines = this._lastValidCode.split("\n");
          const expectedHeader = validLines.slice(0, this._editableStartLine - 1);
          const expectedFooter = validLines.slice(this._lastValidEndLine);

          let netDelta = 0;
          let crossedBoundary = false;

          for (const ch of event.changes || []) {
            if (
              ch.range.startLineNumber < this._editableStartLine ||
              ch.range.endLineNumber > this._lastValidEndLine
            ) {
              crossedBoundary = true;
              break;
            }
            const removedLines = ch.range.endLineNumber - ch.range.startLineNumber;
            const addedLines = (String(ch.text || "").match(/\n/g) || []).length;
            netDelta += addedLines - removedLines;
          }

          const candidateEndLine = this._lastValidEndLine + netDelta;
          const newCode = textModel.getValue();
          const newLines = newCode.split("\n");

          if (
            crossedBoundary ||
            candidateEndLine < this._editableStartLine ||
            newLines.length < this._editableStartLine + expectedFooter.length
          ) {
            this._revertToLastValid(textModel, event);
            return;
          }

          // Verify header & footer match bit-for-bit
          const actualHeader = newLines.slice(0, this._editableStartLine - 1);
          const actualFooter = newLines.slice(candidateEndLine);
          const headerSame =
            actualHeader.length === expectedHeader.length &&
            actualHeader.every((l, idx) => l === expectedHeader[idx]);
          const footerSame =
            actualFooter.length === expectedFooter.length &&
            actualFooter.every((l, idx) => l === expectedFooter[idx]);

          if (!headerSame || !footerSame) {
            this._revertToLastValid(textModel, event);
            return;
          }

          this._editableEndLine = candidateEndLine;
          this._lastValidEndLine = candidateEndLine;
          this._lastValidCode = newCode;
          this._applyLineDecorations();
          this.onChange(this.getEditableBody(), newCode);
          this.scheduleAnalyze(45);
          return;
        }

        const val = textModel.getValue();
        this._lastValidCode = val;
        this.onChange(val, val);
        this.scheduleAnalyze(45);
      });

      if (this._contextualLocked) {
        this._applyLineDecorations();
        this.revealEditableRegion();
      }
      this.scheduleAnalyze(10);
    }

    _revertToLastValid(textModel) {
      this._reverting = true;
      const restore = this._lastValidCode;
      const restoreEnd = this._lastValidEndLine;
      const startLine = this._editableStartLine;
      queueMicrotask(() => {
        try {
          if (textModel && !textModel.isDisposed()) {
            textModel.setValue(restore);
          }
          this._editableEndLine = restoreEnd;
          this._lastValidEndLine = restoreEnd;
          this._applyLineDecorations();
          if (this.editor) {
            this.editor.setPosition({ lineNumber: startLine, column: 5 });
          }
          this.onReadOnlyBlocked();
        } finally {
          this._reverting = false;
        }
      });
    }

    _applyLineDecorations() {
      if (!this.monaco || !this.editor) return;
      const textModel = this.editor.getModel();
      if (!textModel) return;

      if (!this._contextualLocked) {
        this._decorations = this.editor.deltaDecorations(this._decorations, []);
        return;
      }

      const lineCount = textModel.getLineCount();
      const nextDecs = [];

      if (this._editableStartLine > 1) {
        nextDecs.push({
          range: new this.monaco.Range(1, 1, this._editableStartLine - 1, 1),
          options: {
            isWholeLine: true,
            className: "monaco-readonly-line",
            linesDecorationsClassName: "monaco-readonly-gutter",
          },
        });
      }

      if (this._editableEndLine >= this._editableStartLine) {
        nextDecs.push({
          range: new this.monaco.Range(this._editableStartLine, 1, this._editableEndLine, 1),
          options: {
            isWholeLine: true,
            className: "monaco-editable-line",
            linesDecorationsClassName: "monaco-editable-gutter",
          },
        });
      }

      if (this._editableEndLine < lineCount) {
        nextDecs.push({
          range: new this.monaco.Range(this._editableEndLine + 1, 1, lineCount, 1),
          options: {
            isWholeLine: true,
            className: "monaco-readonly-line",
            linesDecorationsClassName: "monaco-readonly-gutter",
          },
        });
      }

      this._decorations = this.editor.deltaDecorations(this._decorations, nextDecs);
    }

    _mountFallback() {
      this.hostEl.innerHTML = "";
      const ta = document.createElement("textarea");
      ta.className = "code-editor";
      ta.spellcheck = false;
      ta.value = this._extractFallbackBody();
      ta.addEventListener("input", () => {
        if (this._suppressChange) return;
        this.onChange(ta.value, ta.value);
        this.scheduleAnalyze(45);
      });
      ta.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          this.onSaveShortcut(ta.value);
        }
      });
      this.hostEl.appendChild(ta);
      this.fallbackTextarea = ta;
      this.scheduleAnalyze(10);
    }

    _extractFallbackBody() {
      if (!this._contextualLocked) return this._pendingValue || "";
      const lines = (this._pendingValue || "").split("\n");
      return lines
        .slice(this._editableStartLine - 1, this._editableEndLine)
        .map((l) => (l.startsWith("    ") ? l.slice(4) : l))
        .join("\n")
        .replace(/^\n+|\s+$/g, "");
    }

    setContext(model, stateObj, hookContext) {
      this.currentModel = model;
      this.currentState = stateObj;
      if (hookContext) this._hookContext = hookContext;
      global.__rustyActiveEditorContext = {
        model,
        state: stateObj,
        hookContext: this._hookContext,
      };
      this.scheduleAnalyze(10);
    }

    /**
     * Load a complete composed `.rs` file into Monaco with strict read-only locks
     * outside `[editableStartLine, editableEndLine]`.
     */
    setContextualFile({ code, editableStartLine, editableEndLine, hookContext, stateId, reveal = true }) {
      const text = String(code || "");
      this.currentStateId = stateId || this.currentStateId;
      this._hookContext = hookContext || { kind: "entry", payloadType: "" };
      this._contextualLocked = true;
      this._editableStartLine = Math.max(1, Number(editableStartLine || 1));
      this._editableEndLine = Math.max(this._editableStartLine, Number(editableEndLine || this._editableStartLine));
      this._lastValidEndLine = this._editableEndLine;
      this._lastValidCode = text;
      this._pendingValue = text;

      global.__rustyActiveEditorContext = {
        model: this.currentModel,
        state: this.currentState,
        hookContext: this._hookContext,
      };

      this._suppressChange = true;
      try {
        if (this.editor) {
          if (this.editor.getValue() !== text) {
            this.editor.setValue(text);
          }
          this._applyLineDecorations();
          if (reveal) this.revealEditableRegion();
        } else if (this.fallbackTextarea) {
          this.fallbackTextarea.value = this._extractFallbackBody();
        }
      } finally {
        this._suppressChange = false;
      }

      this.clearRustcMarkers();
      this.scheduleAnalyze(10);
    }

    setValue(code, stateId) {
      this._contextualLocked = false;
      this._pendingValue = String(code || "");
      this._lastValidCode = this._pendingValue;
      this.currentStateId = stateId || this.currentStateId;
      this._suppressChange = true;
      try {
        if (this.editor) {
          if (this.editor.getValue() !== this._pendingValue) {
            this.editor.setValue(this._pendingValue);
          }
          this._applyLineDecorations();
        } else if (this.fallbackTextarea) {
          this.fallbackTextarea.value = this._pendingValue;
        }
      } finally {
        this._suppressChange = false;
      }
      this.clearRustcMarkers();
      this.scheduleAnalyze(10);
    }

    revealEditableRegion() {
      if (!this.editor || !this._contextualLocked) return;
      const start = this._editableStartLine;
      const end = this._editableEndLine;
      this.editor.revealLinesInCenter(start, end);
      const textModel = this.editor.getModel();
      const lineLen = textModel ? textModel.getLineContent(start).length : 0;
      const col = lineLen >= 4 ? 5 : 1;
      this.editor.setPosition({ lineNumber: start, column: col });
    }

    getValue() {
      if (this.editor) return this.editor.getValue();
      return this._pendingValue;
    }

    getEditableBody() {
      if (!this._contextualLocked) return this.getValue();
      if (this.fallbackTextarea && !this.editor) {
        return this.fallbackTextarea.value.replace(/^\n+|\s+$/g, "");
      }
      const lines = this.getValue().split("\n");
      const slice = lines.slice(this._editableStartLine - 1, this._editableEndLine);
      const nonEmpty = slice.filter((l) => l.trim().length > 0);
      if (nonEmpty.length === 0) return "";
      let minIndent = Infinity;
      for (const l of nonEmpty) {
        const m = /^([ \t]*)/.exec(l);
        const len = m ? m[1].length : 0;
        if (len < minIndent) minIndent = len;
      }
      const strip = Math.min(minIndent === Infinity ? 0 : minIndent, 4);
      return slice
        .map((l) => (l.length >= strip && /^[ \t]+$/.test(l.slice(0, strip)) ? l.slice(strip) : l))
        .join("\n")
        .replace(/^\n+|\s+$/g, "");
    }

    getEditableLineRange() {
      return {
        startLine: this._editableStartLine,
        endLine: this._editableEndLine,
        locked: this._contextualLocked,
      };
    }

    scheduleAnalyze(delayMs = 45) {
      if (this._analyzeTimer) clearTimeout(this._analyzeTimer);
      this._analyzeTimer = setTimeout(() => {
        this.runInstantAnalysis();
      }, delayMs);
    }

    runInstantAnalysis() {
      if (!global.RustyAnalyzer || !this.currentModel) return this._lastAnalysis;
      let result;
      if (this._contextualLocked) {
        const body = this.getEditableBody();
        const lines = this.getValue().split("\n");
        const firstLine = lines[this._editableStartLine - 1] || "";
        const indentMatch = /^( *)/.exec(firstLine);
        const colOffset = Math.min(4, indentMatch ? indentMatch[1].length : 0);
        result = global.RustyAnalyzer.analyzeHookBody(body, this.currentModel, {
          ...this._hookContext,
          lineOffset: Math.max(0, this._editableStartLine - 1),
          colOffset,
        });
      } else {
        result = global.RustyAnalyzer.analyzeStateCode(
          this.getValue(),
          this.currentModel,
          this.currentState,
        );
      }
      this._lastAnalysis = result;

      if (this.monaco && this.editor) {
        const textModel = this.editor.getModel();
        if (textModel) {
          const markers = result.diagnostics.map((d) => ({
            severity:
              d.severity === "error"
                ? this.monaco.MarkerSeverity.Error
                : d.severity === "warning"
                  ? this.monaco.MarkerSeverity.Warning
                  : this.monaco.MarkerSeverity.Info,
            message: `[${d.code}] ${d.message}`,
            startLineNumber: d.startLine,
            startColumn: d.startColumn,
            endLineNumber: d.endLine,
            endColumn: d.endColumn,
          }));
          this.monaco.editor.setModelMarkers(textModel, "rusty-analyzer", markers);
        }
      }

      this.onDiagnostics(result);
      return result;
    }

    setRustcMarkers(diagnostics, stateFilePath) {
      if (!this.monaco || !this.editor) return;
      const textModel = this.editor.getModel();
      if (!textModel) return;
      const targetSuffix = stateFilePath ? stateFilePath.replace(/^\/+/, "") : "";
      const markers = (diagnostics || [])
        .filter((d) => d.file && (!targetSuffix || d.file.endsWith(targetSuffix)))
        .map((d) => ({
          severity:
            d.level === "error"
              ? this.monaco.MarkerSeverity.Error
              : this.monaco.MarkerSeverity.Warning,
          message: `[rustc${d.code ? ` ${d.code}` : ""}] ${d.message}`,
          startLineNumber: d.line || 1,
          startColumn: d.column || 1,
          endLineNumber: d.line || 1,
          endColumn: (d.column || 1) + 12,
        }));
      this.monaco.editor.setModelMarkers(textModel, "rustc", markers);
    }

    clearRustcMarkers() {
      if (!this.monaco || !this.editor) return;
      const textModel = this.editor.getModel();
      if (textModel) {
        this.monaco.editor.setModelMarkers(textModel, "rustc", []);
      }
    }

    revealPosition(line, column) {
      if (!this.editor) return;
      this.editor.revealLineInCenter(line);
      this.editor.setPosition({ lineNumber: line, column: column || 1 });
      this.editor.focus();
    }

    layout() {
      if (this.editor) this.editor.layout();
    }

    getLastAnalysis() {
      return this._lastAnalysis;
    }
  }

  global.MonacoStateEditor = MonacoStateEditor;
})(window);
