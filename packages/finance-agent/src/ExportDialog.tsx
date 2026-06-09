import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ExportFormat } from "./types";

interface Props {
  sessionPath: string;
  onClose: () => void;
}

export default function ExportDialog({ sessionPath, onClose }: Props) {
  const [format, setFormat] = useState<ExportFormat>("md");
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!sessionPath) return;
    setExporting(true);
    try {
      const content = await invoke<string>("export_session", { path: sessionPath, format });
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chat-export.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Export failed: ${e}`);
    } finally {
      setExporting(false);
      onClose();
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 360, width: "90%", fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Export Chat</h3>
        <div style={{ marginBottom: 16 }}>
          {(["md", "txt", "html"] as ExportFormat[]).map((f) => (
            <label key={f} style={{ display: "block", marginBottom: 8, fontSize: 14, cursor: "pointer" }}>
              <input type="radio" checked={format === f} onChange={() => setFormat(f)} style={{ marginRight: 8 }} />
              {f === "md" ? "Markdown (.md)" : f === "txt" ? "Plain Text (.txt)" : "HTML (.html)"}
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #ccc", background: "#fff", cursor: "pointer", fontSize: 13 }}>Cancel</button>
          <button onClick={handleExport} disabled={exporting || !sessionPath} style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: "#1976d2", color: "#fff", cursor: "pointer", fontSize: 13 }}>{exporting ? "Exporting…" : "Export"}</button>
        </div>
      </div>
    </div>
  );
}
