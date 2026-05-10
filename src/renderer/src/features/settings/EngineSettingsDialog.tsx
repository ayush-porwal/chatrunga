import { useState } from "react";
import type { CSSProperties } from "react";
import { Check, FolderOpen, Trash2 } from "lucide-react";
import {
  useCreateEngineMutation,
  useDeleteEngineMutation,
  useEnginesQuery,
  useSettingsQuery,
  useUpdateSettingMutation,
  useUpdateEngineMutation
} from "../../queries/api";
import { defaultSettings, type AppSettings, type BoardTheme, type PieceStyle } from "../../../../shared/types/settings";

const boardThemes: Array<{ id: BoardTheme; label: string; light: string; dark: string }> = [
  { id: "brown", label: "Brown", light: "#f0d9b5", dark: "#b58863" },
  { id: "green", label: "Green", light: "#eeeed2", dark: "#769656" },
  { id: "blue", label: "Blue", light: "#d7e8f7", dark: "#5f8fbf" },
  { id: "purple", label: "Purple", light: "#e8ddf5", dark: "#8364a2" },
  { id: "gray", label: "Gray", light: "#d9d9d9", dark: "#8f8f8f" },
  { id: "newspaper", label: "Paper", light: "#f6f0df", dark: "#9b927d" },
  { id: "wood", label: "Wood", light: "#e4bf83", dark: "#9c6235" },
  { id: "walnut", label: "Walnut", light: "#d0a56f", dark: "#6f452c" },
  { id: "slate", label: "Slate", light: "#c9d1d9", dark: "#59636f" }
];

const pieceStyles: Array<{ id: PieceStyle; label: string; sample: string }> = [
  { id: "chaturanga", label: "Chaturanga", sample: "♞" },
  { id: "staunton", label: "Staunton", sample: "♘" },
  { id: "neo", label: "Neo", sample: "♜" },
  { id: "minimal", label: "Minimal", sample: "♙" }
];

export function EngineSettingsDialog({ onClose }: { onClose: () => void }) {
  const engines = useEnginesQuery();
  const settings = useSettingsQuery();
  const updateSetting = useUpdateSettingMutation();
  const createEngine = useCreateEngineMutation();
  const updateEngine = useUpdateEngineMutation();
  const deleteEngine = useDeleteEngineMutation();
  const [name, setName] = useState("Stockfish");
  const [path, setPath] = useState("");
  const [args, setArgs] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const appearance = settings.data ?? defaultSettings;

  function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    updateSetting.mutate({ key, value });
  }

  async function pickExecutable() {
    const selected = await window.chaturanga.files.selectExecutable();
    if (selected) setPath(selected);
  }

  async function addEngine() {
    const engine = await createEngine.mutateAsync({
      name,
      executablePath: path,
      args: args.split(/\s+/).filter(Boolean)
    });
    setPath("");
    setArgs("");
    setTestResult(`Saved ${engine.name}`);
  }

  async function testEngine(id?: string) {
    const result = id
      ? await window.chaturanga.engines.test(id)
      : await window.chaturanga.engines.test({
          name,
          executablePath: path,
          args: args.split(/\s+/).filter(Boolean)
        });
    setTestResult(result.ok ? `OK: ${result.name || "UCI engine"}` : result.error || "Engine failed");
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2>Settings</h2>
          <button onClick={onClose}>Close</button>
        </div>

        <section className="settings-section">
          <h3>Board appearance</h3>
          <div className="theme-grid">
            {boardThemes.map((theme) => (
              <button
                key={theme.id}
                className={`theme-choice ${appearance.boardTheme === theme.id ? "selected" : ""}`}
                onClick={() => setSetting("boardTheme", theme.id)}
              >
                <span
                  className="theme-swatch"
                  style={{ "--light": theme.light, "--dark": theme.dark } as CSSProperties}
                />
                <span>{theme.label}</span>
                {appearance.boardTheme === theme.id ? <Check size={15} /> : null}
              </button>
            ))}
          </div>

          <h3>Pieces</h3>
          <div className="piece-style-grid">
            {pieceStyles.map((style) => (
              <button
                key={style.id}
                className={`piece-style-choice ${appearance.pieceStyle === style.id ? "selected" : ""}`}
                onClick={() => setSetting("pieceStyle", style.id)}
              >
                <span>{style.sample}</span>
                {style.label}
              </button>
            ))}
          </div>

          <div className="toggle-grid">
            <label>
              <input
                type="checkbox"
                checked={appearance.showCoordinates}
                onChange={(event) => setSetting("showCoordinates", event.target.checked)}
              />
              Coordinates
            </label>
            <label>
              <input
                type="checkbox"
                checked={appearance.showLegalMoves}
                onChange={(event) => setSetting("showLegalMoves", event.target.checked)}
              />
              Legal move dots
            </label>
            <label>
              <input
                type="checkbox"
                checked={appearance.boardAnimation}
                onChange={(event) => setSetting("boardAnimation", event.target.checked)}
              />
              Move animation
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h3>Engines</h3>
        <div className="settings-grid">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Executable
            <div className="input-with-button">
              <input value={path} onChange={(event) => setPath(event.target.value)} />
              <button onClick={pickExecutable}><FolderOpen size={16} /></button>
            </div>
          </label>
          <label>
            Args
            <input value={args} onChange={(event) => setArgs(event.target.value)} placeholder="Optional" />
          </label>
        </div>

        {testResult ? <p className="muted">{testResult}</p> : null}
        <div className="dialog-actions">
          <button onClick={() => testEngine()} disabled={!path.trim()}>Test</button>
          <button className="primary" onClick={addEngine} disabled={!path.trim()}>Add engine</button>
        </div>

        <div className="engine-list">
          {engines.data?.map((engine) => (
            <div className="engine-row" key={engine.id}>
              <div>
                <strong>{engine.name}</strong>
                <span>{engine.executablePath}</span>
              </div>
              <button onClick={() => testEngine(engine.id)}>Test</button>
              <button
                onClick={() =>
                  updateEngine.mutate({ id: engine.id, patch: { isDefault: !engine.isDefault } })
                }
              >
                {engine.isDefault ? "Default" : "Set default"}
              </button>
              <button onClick={() => deleteEngine.mutate(engine.id)} title="Delete">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        </section>
      </div>
    </div>
  );
}
