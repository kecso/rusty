(function (global) {
  "use strict";

  /**
   * Embedded Monaco Editor for Rust State Modules with:
   *  - Live WebGME-driven IntelliSense (globals., Event::, StateId::, Outcome::)
   *  - Sub-2ms instant edit-time semantic diagnostics via RustyAnalyzer (Monaco squiggles)
   *  - Optional rustc compiler marker overlay
   *  - Cmd/Ctrl+S shortcut wired to Commit & Push
   *  - Graceful fallback to textarea if Monaco fails to load
   */
  class MonacoStateEditor {
    constructor(hostEl, opts = {}) {
      this.hostEl = hostEl;
      this.onChange = opts.onChange || (() => {});
      this.onDiagnostics = opts.onDiagnostics || (() => {});
      this.onSaveShortcut = opts.onSaveShortcut || (() => {});

      this.monaco = null;
      this.editor = null;
      this.fallbackTextarea = null;
      this.currentModel = null;
      this.currentState = null;
      this.currentStateId = null;
      this._suppressChange = false;
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

      // Register live WebGME-aware Rust completion provider once
      if (!global.__rustyMonacoCompletionRegistered) {
        global.__rustyMonacoCompletionRegistered = true;
        monaco.languages.registerCompletionItemProvider("rust", {
          triggerCharacters: [".", ":"],
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
            const { toSnakeCase, toPascalCase } = global.RustyContract;

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

            if (/Event::[a-zA-Z0-9_]*$/.test(lineUntil)) {
              for (const ev of ctx.model.events || []) {
                const pascal = toPascalCase(ev.name);
                const hasPayload = Boolean((ev.payloadType || "").trim());
                suggestions.push({
                  label: hasPayload ? `${pascal}(${ev.payloadType})` : pascal,
                  kind: monaco.languages.CompletionItemKind.EnumMember,
                  detail: hasPayload ? `Event::${pascal}(${ev.payloadType})` : `Event::${pascal}`,
                  documentation: ev.description || "WebGME EventDef",
                  insertText: hasPayload ? `${pascal}(\${1:val})` : pascal,
                  insertTextRules: hasPayload
                    ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                    : undefined,
                  range,
                });
              }
              return { suggestions };
            }

            if (/StateId::[a-zA-Z0-9_]*$/.test(lineUntil)) {
              for (const st of ctx.model.states || []) {
                const pascal = toPascalCase(st.name);
                suggestions.push({
                  label: pascal,
                  kind: monaco.languages.CompletionItemKind.EnumMember,
                  detail: `StateId::${pascal}`,
                  documentation: st.description || `WebGME State (${st.gitPath || ""})`,
                  insertText: pascal,
                  range,
                });
              }
              return { suggestions };
            }

            if (/Outcome::[a-zA-Z0-9_]*$/.test(lineUntil)) {
              suggestions.push(
                {
                  label: "Stay",
                  kind: monaco.languages.CompletionItemKind.EnumMember,
                  detail: "Outcome::Stay",
                  insertText: "Stay",
                  range,
                },
                {
                  label: "Transition(StateId::...)",
                  kind: monaco.languages.CompletionItemKind.EnumMember,
                  detail: "Transition to another State",
                  insertText: "Transition(StateId::${1:State})",
                  insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range,
                },
                {
                  label: "Emit(Event::...)",
                  kind: monaco.languages.CompletionItemKind.EnumMember,
                  detail: "Emit an Event back into the state machine",
                  insertText: "Emit(Event::${1:Event})",
                  insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range,
                },
              );
              return { suggestions };
            }

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
        padding: { top: 8, bottom: 8 },
        quickSuggestions: true,
      });

      this.editor.onDidChangeModelContent(() => {
        if (this._suppressChange) return;
        const val = this.editor.getValue();
        this.onChange(val);
        this.scheduleAnalyze(55);
      });

      // Cmd+S / Ctrl+S -> Save & Commit+Push
      this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        this.onSaveShortcut(this.getValue());
      });

      this.scheduleAnalyze(10);
    }

    _mountFallback() {
      this.hostEl.innerHTML = "";
      const ta = document.createElement("textarea");
      ta.className = "code-editor";
      ta.spellcheck = false;
      ta.value = this._pendingValue || "";
      ta.addEventListener("input", () => {
        if (this._suppressChange) return;
        this.onChange(ta.value);
        this.scheduleAnalyze(55);
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

    setContext(model, stateObj) {
      this.currentModel = model;
      this.currentState = stateObj;
      global.__rustyActiveEditorContext = { model, state: stateObj };
      this.scheduleAnalyze(10);
    }

    setValue(code, stateId) {
      this._pendingValue = String(code || "");
      this.currentStateId = stateId || this.currentStateId;
      this._suppressChange = true;
      try {
        if (this.editor) {
          if (this.editor.getValue() !== this._pendingValue) {
            this.editor.setValue(this._pendingValue);
          }
        } else if (this.fallbackTextarea) {
          this.fallbackTextarea.value = this._pendingValue;
        }
      } finally {
        this._suppressChange = false;
      }
      this.clearRustcMarkers();
      this.scheduleAnalyze(10);
    }

    getValue() {
      if (this.editor) return this.editor.getValue();
      if (this.fallbackTextarea) return this.fallbackTextarea.value;
      return this._pendingValue;
    }

    scheduleAnalyze(delayMs = 55) {
      if (this._analyzeTimer) clearTimeout(this._analyzeTimer);
      this._analyzeTimer = setTimeout(() => {
        this.runInstantAnalysis();
      }, delayMs);
    }

    runInstantAnalysis() {
      if (!global.RustyAnalyzer || !this.currentModel) return this._lastAnalysis;
      const code = this.getValue();
      const result = global.RustyAnalyzer.analyzeStateCode(
        code,
        this.currentModel,
        this.currentState,
      );
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
