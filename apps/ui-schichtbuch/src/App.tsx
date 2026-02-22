import React, { useEffect, useMemo, useRef, useState } from "react";

type ViewMode = "create" | "history";

type Entry = {
  entry_id: number;
  subject: string;
  body: string;
  author_name: string;
  status: string;
  editable_until: string;
  created_at?: string;
};

type EntryAttachment = {
  attachment_id: number;
  filename_original: string;
  mime: string;
  size_bytes: number;
  kind: string;
};

type EntryDetail = {
  entry_id: number;
  plant_id: number;
  author_name: string;
  subject: string;
  body: string;
  status: string;
  editable_until: string;
  attachments: EntryAttachment[];
};

type Draft = {
  author: string;
  subject: string;
  body: string;
};

type PendingAttachment = {
  id: string;
  file: File;
  kind: "FILE" | "SCREENSHOT";
  preview: string | null;
};

type ImageModal = {
  src: string;
  title: string;
  downloadUrl: string;
};

function plantSlugFromPath(): string {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p.toLowerCase() === "schichtbuch");
  return idx >= 0 && parts[idx + 1] ? decodeURIComponent(parts[idx + 1]) : "MS_DEMO_ANLAGE_01";
}

function makeAttachmentId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function releasePreview(preview: string | null): void {
  if (preview && preview.startsWith("blob:")) {
    URL.revokeObjectURL(preview);
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Screenshot konnte nicht erstellt werden."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function formatTs(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("de-DE");
}

function formatBytes(value: number | null | undefined): string {
  const size = Number(value || 0);
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let current = size;
  let idx = 0;
  while (current >= 1024 && idx < units.length - 1) {
    current /= 1024;
    idx += 1;
  }
  return `${current.toFixed(current >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function isImageMime(mime: string | null | undefined): boolean {
  return String(mime || "").toLowerCase().startsWith("image/");
}

export function App() {
  const plantSlug = useMemo(() => plantSlugFromPath(), []);
  const queueKey = `queue:${plantSlug}`;
  const draftKey = `draft:${plantSlug}`;

  const [viewMode, setViewMode] = useState<ViewMode>("create");

  const [author, setAuthor] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [statusText, setStatusText] = useState("");
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [showAnnotateChoice, setShowAnnotateChoice] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [brushSize, setBrushSize] = useState(8);
  const [brushColor, setBrushColor] = useState("#e11d48");
  const annotateCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const pendingRef = useRef<PendingAttachment[]>([]);

  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailMessage, setDetailMessage] = useState("");
  const [detailEditMode, setDetailEditMode] = useState(false);
  const [detailSubject, setDetailSubject] = useState("");
  const [detailBody, setDetailBody] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<EntryDetail | null>(null);
  const [imageModal, setImageModal] = useState<ImageModal | null>(null);

  useEffect(() => {
    pendingRef.current = pendingAttachments;
  }, [pendingAttachments]);

  useEffect(() => {
    return () => {
      for (const item of pendingRef.current) {
        releasePreview(item.preview);
      }
    };
  }, []);

  function attachmentUrl(entryId: number, attachmentId: number, download = false): string {
    return `/api/entries/${entryId}/attachments/${attachmentId}${download ? "?download=1" : ""}`;
  }

  function isEntryEditable(entry: EntryDetail | null): boolean {
    if (!entry) return false;
    if (entry.status === "DELETED") return false;
    const until = new Date(entry.editable_until).getTime();
    if (Number.isNaN(until)) return false;
    return Date.now() <= until;
  }

  function getAuthorToken(): string {
    const raw = String(localStorage.getItem("author_token") || "").trim();
    if (raw.length >= 8) return raw;
    return `fallback-${crypto.randomUUID()}`;
  }

  async function loadEntries(options: { silent?: boolean } = {}) {
    if (!options.silent) setHistoryLoading(true);
    try {
      const r = await fetch(`/api/plants/${plantSlug}/entries`);
      if (!r.ok) {
        setHistoryError(`Eintraege konnten nicht geladen werden (${r.status}).`);
        return;
      }
      const payload = (await r.json()) as Entry[];
      setEntries(payload);
      setHistoryError("");
    } catch (e) {
      setHistoryError(`Eintraege konnten nicht geladen werden: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (!options.silent) setHistoryLoading(false);
    }
  }

  async function fetchEntryDetail(entryId: number): Promise<EntryDetail> {
    const r = await fetch(`/api/entries/${entryId}`);
    if (!r.ok) {
      throw new Error(`Details konnten nicht geladen werden (${r.status}).`);
    }
    return (await r.json()) as EntryDetail;
  }

  async function openEntryDetail(entryId: number) {
    setShowDetailModal(true);
    setDetailLoading(true);
    setDetailBusy(false);
    setDetailError("");
    setDetailMessage("");
    setDetailEditMode(false);
    setDetailSubject("");
    setDetailBody("");
    setSelectedEntry(null);
    try {
      const detail = await fetchEntryDetail(entryId);
      setSelectedEntry(detail);
      setDetailSubject(detail.subject);
      setDetailBody(detail.body);
    } catch (e) {
      setDetailError(`Details konnten nicht geladen werden: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveDetailChanges() {
    if (!selectedEntry) return;
    if (!isEntryEditable(selectedEntry)) return;
    const authorToken = getAuthorToken();
    if (!detailSubject.trim() || !detailBody.trim()) {
      setDetailMessage("Betreff und Text duerfen nicht leer sein.");
      return;
    }

    setDetailBusy(true);
    setDetailError("");
    setDetailMessage("");
    try {
      const r = await fetch(`/api/entries/${selectedEntry.entry_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_request_id: crypto.randomUUID(),
          author_token: authorToken,
          author_name: selectedEntry.author_name,
          subject: detailSubject,
          body: detailBody,
        }),
      });
      if (!r.ok) {
        const text = (await r.text()).slice(0, 180);
        setDetailMessage(`Speichern fehlgeschlagen (${r.status})${text ? `: ${text}` : ""}`);
        return;
      }
      const refreshed = await fetchEntryDetail(selectedEntry.entry_id);
      setSelectedEntry(refreshed);
      setDetailSubject(refreshed.subject);
      setDetailBody(refreshed.body);
      setDetailEditMode(false);
      setDetailMessage("Eintrag wurde gespeichert.");
      await loadEntries({ silent: true });
    } catch (e) {
      setDetailMessage(`Speichern fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDetailBusy(false);
    }
  }

  async function deleteSelectedEntry() {
    if (!selectedEntry) return;
    if (!isEntryEditable(selectedEntry)) return;
    const authorToken = getAuthorToken();
    const confirmed = window.confirm("Eintrag wirklich loeschen?");
    if (!confirmed) return;

    setDetailBusy(true);
    setDetailError("");
    setDetailMessage("");
    try {
      const r = await fetch(`/api/entries/${selectedEntry.entry_id}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_request_id: crypto.randomUUID(),
          author_token: authorToken,
          author_name: selectedEntry.author_name,
        }),
      });
      if (!r.ok) {
        const text = (await r.text()).slice(0, 180);
        setDetailMessage(`Loeschen fehlgeschlagen (${r.status})${text ? `: ${text}` : ""}`);
        return;
      }
      setShowDetailModal(false);
      setDetailEditMode(false);
      setSelectedEntry(null);
      setStatusText("Eintrag wurde geloescht.");
      await loadEntries({ silent: true });
    } catch (e) {
      setDetailMessage(`Loeschen fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDetailBusy(false);
    }
  }

  function saveDraft() {
    const payload: Draft = { author, subject, body };
    localStorage.setItem(draftKey, JSON.stringify(payload));
    setStatusText("Draft gespeichert");
  }

  function loadDraft() {
    const raw = localStorage.getItem(draftKey);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as Draft;
      setAuthor(draft.author || "");
      setSubject(draft.subject || "");
      setBody(draft.body || "");
      setStatusText("Draft wiederhergestellt");
    } catch {
      // ignore malformed drafts
    }
  }

  function pushQueue(item: Record<string, string>) {
    const queue = JSON.parse(localStorage.getItem(queueKey) || "[]") as Record<string, string>[];
    queue.push(item);
    localStorage.setItem(queueKey, JSON.stringify(queue));
  }

  function queueAttachment(file: File, kind: "FILE" | "SCREENSHOT", preview: string | null = null) {
    const resolvedPreview = preview || (file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
    setPendingAttachments((prev) => [
      ...prev,
      {
        id: makeAttachmentId(),
        file,
        kind,
        preview: resolvedPreview,
      },
    ]);
    setUploadMessage(kind === "SCREENSHOT" ? "Screenshot vorgemerkt." : `Datei vorgemerkt: ${file.name}`);
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) releasePreview(target.preview);
      return prev.filter((item) => item.id !== id);
    });
  }

  function clearScreenshotDraft() {
    setScreenshotFile(null);
    setScreenshotPreview(null);
    setShowAnnotateChoice(false);
    setAnnotating(false);
  }

  async function sendAttachment(entryId: number, authorToken: string, item: PendingAttachment): Promise<{ ok: boolean; status: number; detail: string }> {
    const formData = new FormData();
    formData.append("author_token", authorToken);
    formData.append("kind", item.kind);
    formData.append("file", item.file);
    const r = await fetch(`/api/entries/${entryId}/attachments`, {
      method: "POST",
      body: formData,
    });
    const detail = r.ok ? "" : (await r.text()).slice(0, 220);
    return { ok: r.ok, status: r.status, detail };
  }

  async function uploadPendingAttachments(entryId: number, authorToken: string, items: PendingAttachment[]) {
    if (!items.length) return { okCount: 0, failCount: 0 };
    setUploadBusy(true);
    const failed: PendingAttachment[] = [];
    let okCount = 0;
    for (const item of items) {
      try {
        const result = await sendAttachment(entryId, authorToken, item);
        if (result.ok) {
          okCount += 1;
          releasePreview(item.preview);
        } else {
          failed.push(item);
        }
      } catch {
        failed.push(item);
      }
    }
    setPendingAttachments(failed);
    setUploadBusy(false);
    return { okCount, failCount: failed.length };
  }

  async function captureScreenshot() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setUploadMessage("Screenshot wird von diesem Browser nicht unterstuetzt.");
      return;
    }
    let stream: MediaStream | null = null;
    setUploadBusy(true);
    setUploadMessage("");
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false } as DisplayMediaStreamOptions);
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();

      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context fehlt.");
      ctx.drawImage(video, 0, 0, width, height);

      const blob = await canvasToBlob(canvas);
      const file = new File([blob], `schichtbuch-screenshot-${Date.now()}.png`, { type: "image/png" });
      setScreenshotFile(file);
      setScreenshotPreview(canvas.toDataURL("image/png"));
      setShowAnnotateChoice(true);
      setAnnotating(false);
      setUploadMessage("Screenshot erstellt. Willst du Markierungen setzen?");
    } catch (e) {
      setUploadMessage(`Screenshot fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      setUploadBusy(false);
      window.setTimeout(() => window.focus(), 120);
    }
  }

  async function stageRawScreenshot() {
    if (!screenshotFile) {
      setUploadMessage("Kein Screenshot vorhanden.");
      return;
    }
    queueAttachment(screenshotFile, "SCREENSHOT", screenshotPreview);
    clearScreenshotDraft();
  }

  function startAnnotation() {
    if (!screenshotPreview) return;
    setShowAnnotateChoice(false);
    setAnnotating(true);
  }

  async function stageAnnotatedScreenshot() {
    const canvas = annotateCanvasRef.current;
    if (!canvas) {
      setUploadMessage("Markierungsflaeche nicht verfuegbar.");
      return;
    }
    const blob = await canvasToBlob(canvas);
    const dataUrl = canvas.toDataURL("image/png");
    const file = new File([blob], `schichtbuch-screenshot-markiert-${Date.now()}.png`, { type: "image/png" });
    queueAttachment(file, "SCREENSHOT", dataUrl);
    clearScreenshotDraft();
  }

  function drawPointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = annotateCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function onAnnotatePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = annotateCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const pt = drawPointFromEvent(e);
    if (!ctx || !pt) return;
    drawingRef.current = true;
    lastPointRef.current = pt;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    ctx.lineTo(pt.x + 0.1, pt.y + 0.1);
    ctx.stroke();
  }

  function onAnnotatePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = annotateCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const pt = drawPointFromEvent(e);
    const last = lastPointRef.current;
    if (!ctx || !pt || !last) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPointRef.current = pt;
  }

  function onAnnotatePointerUp() {
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  useEffect(() => {
    if (!annotating || !screenshotPreview) return;
    const canvas = annotateCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = screenshotPreview;
  }, [annotating, screenshotPreview]);

  async function flushQueue() {
    const queue = JSON.parse(localStorage.getItem(queueKey) || "[]") as Record<string, string>[];
    if (!queue.length) return;

    const pending: Record<string, string>[] = [];
    for (const item of queue) {
      const r = await fetch(`/api/plants/${plantSlug}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      if (!r.ok) pending.push(item);
    }

    localStorage.setItem(queueKey, JSON.stringify(pending));
    if (!pending.length) {
      setStatusText("Offline Queue synchronisiert");
      await loadEntries({ silent: true });
    }
  }

  async function submitEntry() {
    if (!author.trim() || !subject.trim() || !body.trim()) {
      setStatusText("Bitte Name, Betreff und Text ausfuellen.");
      return;
    }
    if (screenshotFile) {
      setStatusText("Bitte Screenshot erst bestaetigen (vormerken oder verwerfen).");
      return;
    }

    const authorToken = localStorage.getItem("author_token") || crypto.randomUUID();
    const payload = {
      client_request_id: crypto.randomUUID(),
      author_name: author,
      author_token: authorToken,
      subject,
      body,
    };
    localStorage.setItem("author_token", payload.author_token);

    if (isOffline) {
      if (pendingAttachments.length > 0) {
        setStatusText("Offline mit Anhaengen nicht moeglich. Bitte online absenden.");
        return;
      }
      pushQueue(payload);
      setStatusText("Offline gespeichert, wird spaeter gesendet");
      return;
    }

    const r = await fetch(`/api/plants/${plantSlug}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      setStatusText(`Fehler ${r.status}`);
      return;
    }

    const created = await r.json();
    const entryId = Number(created?.entry_id || 0);

    let resultText = "Eintrag gespeichert";
    if (entryId > 0 && pendingAttachments.length > 0) {
      const uploadResult = await uploadPendingAttachments(entryId, authorToken, [...pendingAttachments]);
      if (uploadResult.failCount === 0) {
        resultText = `Eintrag gespeichert. ${uploadResult.okCount} Anhaenge hochgeladen.`;
      } else {
        resultText = `Eintrag gespeichert. ${uploadResult.okCount} hochgeladen, ${uploadResult.failCount} fehlgeschlagen.`;
      }
    }

    localStorage.removeItem(draftKey);
    setSubject("");
    setBody("");
    await loadEntries({ silent: true });
    setStatusText(resultText);
  }

  useEffect(() => {
    void loadEntries({ silent: true });
    loadDraft();

    const online = () => {
      setIsOffline(false);
      void flushQueue();
    };
    const offline = () => setIsOffline(true);

    window.addEventListener("online", online);
    window.addEventListener("offline", offline);

    const timer = setInterval(() => {
      if (navigator.onLine) void flushQueue();
    }, 30000);

    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (viewMode === "history") {
      void loadEntries();
    }
  }, [viewMode]);

  useEffect(() => {
    const t = setTimeout(saveDraft, 700);
    return () => clearTimeout(t);
  }, [author, subject, body]);

  const detailEditable = isEntryEditable(selectedEntry);

  return (
    <div className="container">
      <div className="card">
        <h1>Schichtbuch</h1>
        <p className="subtitle">Anlage: {plantSlug}</p>
        <div className="menu-tabs">
          <button
            className={`tab ${viewMode === "create" ? "active" : ""}`}
            onClick={() => setViewMode("create")}
          >
            Neuer Eintrag
          </button>
          <button
            className={`tab ${viewMode === "history" ? "active" : ""}`}
            onClick={() => setViewMode("history")}
          >
            Verlauf
          </button>
        </div>
        {isOffline ? (
          <div className="offline" data-testid="offline-banner">
            Offline - Aenderungen werden spaeter uebertragen.
          </div>
        ) : null}
      </div>

      {viewMode === "create" ? (
        <div className="card">
          <label>Name</label>
          <input data-testid="author-name" value={author} onChange={(e) => setAuthor(e.target.value)} />
          <label>Betreff</label>
          <input data-testid="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <label>Text</label>
          <textarea data-testid="body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="upload-box">
            <h2>Anhaenge und Screenshot</h2>
            <p className="muted">Dateien oder Screenshots werden nach dem Speichern am Eintrag angehaengt.</p>
            <input
              type="file"
              disabled={uploadBusy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                queueAttachment(file, "FILE");
                e.currentTarget.value = "";
              }}
            />
            <div className="toolbar">
              <button className="secondary" onClick={() => void captureScreenshot()} disabled={uploadBusy}>Screenshot aufnehmen</button>
            </div>

            {pendingAttachments.length > 0 ? (
              <div className="pending-list">
                <p><strong>Vorgemerkte Anhaenge</strong></p>
                {pendingAttachments.map((item) => (
                  <div key={item.id} className="pending-item">
                    <div>
                      <span>{item.kind === "SCREENSHOT" ? "Screenshot" : "Datei"}: {item.file.name}</span>
                      {item.preview ? <img className="pending-preview" src={item.preview} alt={`Vorschau ${item.file.name}`} /> : null}
                    </div>
                    <button className="secondary" onClick={() => removePendingAttachment(item.id)} disabled={uploadBusy}>Entfernen</button>
                  </div>
                ))}
              </div>
            ) : null}

            {screenshotPreview ? (
              <div className="upload-preview">
                {!annotating ? (
                  <>
                    <img className="preview-image" src={screenshotPreview} alt="Screenshot Vorschau" />
                    {showAnnotateChoice ? (
                      <>
                        <p>Markierungen hinzufuegen?</p>
                        <div className="toolbar">
                          <button className="secondary" onClick={startAnnotation} disabled={uploadBusy}>Ja, markieren</button>
                          <button onClick={() => void stageRawScreenshot()} disabled={uploadBusy}>Nein, vormerken</button>
                          <button className="secondary" onClick={() => void captureScreenshot()} disabled={uploadBusy}>Neu aufnehmen</button>
                        </div>
                      </>
                    ) : (
                      <div className="toolbar">
                        <button className="secondary" onClick={() => void captureScreenshot()} disabled={uploadBusy}>Neu aufnehmen</button>
                        <button className="secondary" onClick={clearScreenshotDraft} disabled={uploadBusy}>Verwerfen</button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <canvas
                      ref={annotateCanvasRef}
                      className="annotate-canvas"
                      onPointerDown={onAnnotatePointerDown}
                      onPointerMove={onAnnotatePointerMove}
                      onPointerUp={onAnnotatePointerUp}
                      onPointerLeave={onAnnotatePointerUp}
                    />
                    <div className="toolbar">
                      <label>
                        Pinsel
                        <input type="range" min={2} max={24} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
                      </label>
                      <label>
                        Farbe
                        <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} />
                      </label>
                      <button onClick={() => void stageAnnotatedScreenshot()} disabled={uploadBusy}>Markierung speichern</button>
                      <button className="secondary" onClick={() => setAnnotating(false)} disabled={uploadBusy}>Zur Vorschau</button>
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {uploadMessage ? <p>{uploadMessage}</p> : null}
          </div>
          <div className="toolbar">
            <button data-testid="save-draft" className="secondary" onClick={saveDraft}>Als Entwurf behalten</button>
            <button data-testid="submit-entry" onClick={() => void submitEntry()} disabled={uploadBusy}>Absenden</button>
          </div>
          <p>{statusText}</p>
        </div>
      ) : (
        <div className="card">
          <div className="history-toolbar">
            <h2>Verlauf</h2>
            <button className="secondary" onClick={() => void loadEntries()} disabled={historyLoading}>Aktualisieren</button>
          </div>
          {historyError ? <p className="notice-error">{historyError}</p> : null}
          {historyLoading && entries.length === 0 ? <p>Eintraege werden geladen...</p> : null}
          {!historyLoading && entries.length === 0 ? <p>Noch keine Eintraege vorhanden.</p> : null}
          <div className="history-list">
            {entries.map((entry) => (
              <div key={entry.entry_id} className="history-item">
                <div className="history-item-head">
                  <strong>{entry.subject}</strong>
                  <span className="history-status">{entry.status}</span>
                </div>
                <p className="history-body">
                  {entry.body.length > 200 ? `${entry.body.slice(0, 200)}...` : entry.body}
                </p>
                <small>{entry.author_name} | {formatTs(entry.created_at)}</small>
                <div className="toolbar">
                  <button onClick={() => void openEntryDetail(entry.entry_id)}>Eintrag oeffnen</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showDetailModal ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowDetailModal(false);
            setDetailEditMode(false);
            setDetailMessage("");
          }}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Eintrag Details</h2>
              <button
                className="secondary"
                onClick={() => {
                  setShowDetailModal(false);
                  setDetailEditMode(false);
                  setDetailMessage("");
                }}
              >
                Schliessen
              </button>
            </div>
            {detailLoading ? <p>Lade Details...</p> : null}
            {detailError ? <p className="notice-error">{detailError}</p> : null}
            {detailMessage ? <p>{detailMessage}</p> : null}
            {!detailLoading && !detailError && selectedEntry ? (
              <>
                {!detailEditMode ? <p><strong>Betreff:</strong> {selectedEntry.subject}</p> : null}
                <p><strong>Autor:</strong> {selectedEntry.author_name}</p>
                <p><strong>Status:</strong> {selectedEntry.status}</p>
                <p><strong>Bearbeitbar bis:</strong> {formatTs(selectedEntry.editable_until)}</p>
                {detailEditable ? (
                  <div className="toolbar">
                    {!detailEditMode ? (
                      <button className="secondary" onClick={() => setDetailEditMode(true)} disabled={detailBusy}>Bearbeiten</button>
                    ) : (
                      <>
                        <button onClick={() => void saveDetailChanges()} disabled={detailBusy}>Speichern</button>
                        <button className="secondary" onClick={() => {
                          setDetailEditMode(false);
                          setDetailSubject(selectedEntry.subject);
                          setDetailBody(selectedEntry.body);
                          setDetailMessage("");
                        }} disabled={detailBusy}>Abbrechen</button>
                      </>
                    )}
                    {!detailEditMode ? (
                      <button className="danger" onClick={() => void deleteSelectedEntry()} disabled={detailBusy}>Loeschen</button>
                    ) : null}
                  </div>
                ) : (
                  <p className="muted">Bearbeitungszeit abgelaufen. Bearbeiten ist nicht mehr moeglich.</p>
                )}
                {detailEditMode ? (
                  <div className="edit-box">
                    <label>Betreff</label>
                    <input value={detailSubject} onChange={(e) => setDetailSubject(e.target.value)} />
                    <label>Text</label>
                    <textarea rows={6} value={detailBody} onChange={(e) => setDetailBody(e.target.value)} />
                  </div>
                ) : (
                  <p className="detail-body">{selectedEntry.body}</p>
                )}
                <h3>Anhaenge</h3>
                {selectedEntry.attachments.length === 0 ? <p>Keine Anhaenge vorhanden.</p> : null}
                <div className="attachment-list">
                  {selectedEntry.attachments.map((attachment) => {
                    const inlineUrl = attachmentUrl(selectedEntry.entry_id, attachment.attachment_id, false);
                    const downloadUrl = attachmentUrl(selectedEntry.entry_id, attachment.attachment_id, true);
                    const image = isImageMime(attachment.mime);
                    return (
                      <div key={attachment.attachment_id} className="attachment-item">
                        <p>
                          <strong>{attachment.filename_original}</strong>
                          <br />
                          <small>{attachment.kind} | {attachment.mime || "unbekannt"} | {formatBytes(attachment.size_bytes)}</small>
                        </p>
                        {image ? (
                          <img
                            className="attachment-thumb"
                            src={inlineUrl}
                            alt={attachment.filename_original}
                            onClick={() => setImageModal({ src: inlineUrl, title: attachment.filename_original, downloadUrl })}
                          />
                        ) : null}
                        <div className="toolbar">
                          {image ? (
                            <button
                              className="secondary"
                              onClick={() => setImageModal({ src: inlineUrl, title: attachment.filename_original, downloadUrl })}
                            >
                              Im Popup ansehen
                            </button>
                          ) : (
                            <a className="link-btn secondary" href={inlineUrl} target="_blank" rel="noreferrer">Im Browser</a>
                          )}
                          <a className="link-btn" href={downloadUrl}>Download</a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {imageModal ? (
        <div className="modal-backdrop" onClick={() => setImageModal(null)}>
          <div className="image-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{imageModal.title}</h2>
              <button className="secondary" onClick={() => setImageModal(null)}>Schliessen</button>
            </div>
            <img className="image-modal" src={imageModal.src} alt={imageModal.title} />
            <div className="toolbar">
              <a className="link-btn" href={imageModal.downloadUrl}>Download</a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

