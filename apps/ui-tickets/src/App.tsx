import React, { useEffect, useMemo, useRef, useState } from "react";

function parsePath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p.toLowerCase() === "tickets");
  const second = idx >= 0 && parts[idx + 1] ? decodeURIComponent(parts[idx + 1]) : "MS_DEMO_ANLAGE_01";
  const third = idx >= 0 && parts[idx + 2] ? decodeURIComponent(parts[idx + 2]) : "";
  return { second, third };
}

type PendingAttachment = {
  id: string;
  file: File;
  preview: string | null;
};

type SubmitSuccess = {
  ticketId: number;
  token: string;
  statusUrl: string;
  dashboardUrl: string;
};

type DashboardItem = {
  ticket_id: number;
  subject: string;
  description: string;
  status: string;
  requester_name: string;
  department: string | null;
  priority_rank: number | null;
  ticket_type: string | null;
  created_at: string;
  updated_at: string;
};

type DashboardDetail = {
  ticket_id: number;
  plant_slug: string;
  subject: string;
  description: string;
  status: string;
  requester_name: string;
  department: string | null;
  priority_rank: number | null;
  ticket_type: string | null;
  wrong_plant_reason: string | null;
  suggested_create_url: string | null;
  created_at: string;
  updated_at: string;
  timeline: Array<{ event_type: string; payload: Record<string, unknown>; created_at: string }>;
};

function releasePreview(preview: string | null): void {
  if (preview && preview.startsWith("blob:")) {
    URL.revokeObjectURL(preview);
  }
}

const CLOSED_STATUSES = new Set(["CLOSED", "CANCELLED", "CANCELLED_WRONG_PLANT"]);
const OPEN_STATUSES = new Set(["NEW", "QUEUED", "IN_PROGRESS", "RESOLVED", "TRIAGE"]);
const STATUS_STEPS = ["NEW", "QUEUED", "IN_PROGRESS", "RESOLVED", "CLOSED"];

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    NEW: "Neu",
    TRIAGE: "Neu",
    QUEUED: "Geplant",
    IN_PROGRESS: "In Bearbeitung",
    RESOLVED: "Geloest",
    CLOSED: "Geschlossen",
    CANCELLED: "Storniert",
    CANCELLED_WRONG_PLANT: "Falsche Anlage",
  };
  return map[status] || status;
}

function statusClass(status: string): string {
  if (status === "NEW" || status === "TRIAGE") return "s-new";
  if (status === "QUEUED" || status === "IN_PROGRESS") return "s-work";
  if (status === "RESOLVED") return "s-resolved";
  if (CLOSED_STATUSES.has(status)) return "s-closed";
  return "s-new";
}

function formatTs(ts: string | null | undefined): string {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("de-DE");
}

function timelineText(eventType: string, payload: Record<string, unknown>): string {
  if (eventType === "TicketCreated") return "Ticket wurde erstellt";
  if (eventType === "TicketTriaged") return "Ticket wurde eingeordnet";
  if (eventType === "TicketAssigned") return "Ticket wurde zugewiesen";
  if (eventType === "TicketAttachmentAdded") return "Ein Anhang wurde hinzugefuegt";
  if (eventType === "TicketCommentAdded") {
    const msg = typeof payload.message === "string" ? payload.message : "";
    return msg ? `Rueckmeldung: ${msg}` : "Rueckmeldung hinzugefuegt";
  }
  if (eventType === "TicketStatusChanged") {
    const next = typeof payload.status === "string" ? payload.status : "";
    return next ? `Status geaendert: ${statusLabel(next)}` : "Status geaendert";
  }
  return eventType;
}

export function App() {
  const { second, third } = useMemo(parsePath, []);
  const mode = second.toLowerCase() === "status" ? "status" : second.toLowerCase() === "dashboard" ? "dashboard" : "create";
  const createPlantSlug = mode === "create" ? second : "MS_DEMO_ANLAGE_01";
  const dashboardPlantSlug = mode === "dashboard" ? (third || "MS_DEMO_ANLAGE_01") : createPlantSlug;

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [publicToken, setPublicToken] = useState("");
  const [statusData, setStatusData] = useState<any>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState<SubmitSuccess | null>(null);

  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [showAnnotateChoice, setShowAnnotateChoice] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [brushSize, setBrushSize] = useState(8);
  const [brushColor, setBrushColor] = useState("#e11d48");
  const annotateCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const [dashboardItems, setDashboardItems] = useState<DashboardItem[]>([]);
  const [dashboardDetail, setDashboardDetail] = useState<DashboardDetail | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [dashboardSearch, setDashboardSearch] = useState("");
  const [dashboardFilter, setDashboardFilter] = useState("open");
  const [showDetailModal, setShowDetailModal] = useState(false);

  async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        if (!b) {
          reject(new Error("Screenshot konnte nicht erstellt werden."));
          return;
        }
        resolve(b);
      }, "image/png");
    });
  }

  function queueAttachment(file: File, preview: string | null = null) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setPendingAttachments((prev) => [...prev, { id, file, preview }]);
    setUploadMessage(`Anhang vorgemerkt: ${file.name}. Wird nach Ticket-Erstellung hochgeladen.`);
  }

  function setScreenshotPreviewSafe(next: string | null) {
    setScreenshotPreview((prev) => {
      releasePreview(prev);
      return next;
    });
  }

  function openScreenshotPicker() {
    const input = screenshotInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }

  function stageScreenshotDraft(file: File, preview: string, message: string) {
    setScreenshotFile(file);
    setScreenshotPreviewSafe(preview);
    setShowAnnotateChoice(true);
    setAnnotating(false);
    setUploadMessage(message);
  }

  function handlePickedScreenshot(file: File | null, token: string) {
    if (!file) return;
    if (!file.type.toLowerCase().startsWith("image/")) {
      setUploadMessage("Bitte eine Bilddatei fuer den Screenshot auswaehlen.");
      return;
    }
    const preview = URL.createObjectURL(file);
    const msg = token.trim()
      ? "Screenshot uebernommen. Markierungen hinzufuegen?"
      : "Screenshot vorgemerkt. Markierungen hinzufuegen?";
    stageScreenshotDraft(file, preview, msg);
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target) releasePreview(target.preview);
      return prev.filter((x) => x.id !== id);
    });
  }

  async function sendAttachment(token: string, file: File): Promise<{ ok: boolean; status: number; detail: string }> {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`/api/public/tickets/${encodeURIComponent(token)}/attachments`, {
      method: "POST",
      body: fd,
    });
    const detail = r.ok ? "" : (await r.text()).slice(0, 200);
    return { ok: r.ok, status: r.status, detail };
  }

  async function uploadAttachment(token: string, file: File) {
    if (!token.trim()) {
      queueAttachment(file);
      return;
    }
    setUploadBusy(true);
    setUploadMessage("");
    try {
      const result = await sendAttachment(token, file);
      if (!result.ok) {
        setUploadMessage(`Upload fehlgeschlagen: ${result.status}${result.detail ? `: ${result.detail}` : ""}`);
        return;
      }
      setUploadMessage("Anhang hochgeladen.");
      if (mode === "status") {
        await loadStatus(third);
      }
    } catch (e) {
      setUploadMessage(`Upload fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploadBusy(false);
    }
  }

  async function uploadPendingAttachments(token: string, items: PendingAttachment[]) {
    if (!items.length) return;
    setUploadBusy(true);
    let okCount = 0;
    const failed: PendingAttachment[] = [];
    for (const item of items) {
      try {
        const result = await sendAttachment(token, item.file);
        if (result.ok) {
          okCount += 1;
        } else {
          failed.push(item);
        }
      } catch {
        failed.push(item);
      }
    }
    setPendingAttachments(failed);
    setUploadMessage(failed.length === 0 ? `${okCount} vorgemerkte Anhaenge hochgeladen.` : `${okCount} hochgeladen, ${failed.length} fehlgeschlagen.`);
    setUploadBusy(false);
  }

  async function captureScreenshot(token: string) {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      const reason = window.isSecureContext
        ? "Direkte Bildschirmaufnahme wird von diesem Browser nicht angeboten."
        : "Direkte Bildschirmaufnahme ist nur in einem sicheren Kontext (HTTPS) verfuegbar.";
      setUploadMessage(`${reason} Nutze stattdessen 'Screenshot-Datei waehlen' oder Strg+V.`);
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
      const file = new File([blob], `ticket-screenshot-${Date.now()}.png`, { type: "image/png" });
      const msg = token.trim() ? "Screenshot erstellt. Markierungen hinzufuegen?" : "Screenshot vorgemerkt. Markierungen hinzufuegen?";
      stageScreenshotDraft(file, canvas.toDataURL("image/png"), msg);
    } catch (e) {
      setUploadMessage(`Screenshot fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      setUploadBusy(false);
      window.setTimeout(() => window.focus(), 120);
    }
  }

  function clearScreenshotDraft() {
    setScreenshotFile(null);
    setScreenshotPreviewSafe(null);
    setShowAnnotateChoice(false);
    setAnnotating(false);
  }

  async function uploadRawScreenshot(token: string) {
    if (!screenshotFile) {
      setUploadMessage("Kein Screenshot vorhanden.");
      return;
    }
    if (token.trim()) {
      await uploadAttachment(token, screenshotFile);
    } else {
      queueAttachment(screenshotFile, screenshotPreview);
    }
    clearScreenshotDraft();
  }

  function startAnnotation() {
    if (!screenshotPreview) return;
    setShowAnnotateChoice(false);
    setAnnotating(true);
  }

  async function uploadAnnotatedScreenshot(token: string) {
    const canvas = annotateCanvasRef.current;
    if (!canvas) {
      setUploadMessage("Markierungsflaeche nicht verfuegbar.");
      return;
    }
    const blob = await canvasToBlob(canvas);
    const dataUrl = canvas.toDataURL("image/png");
    const file = new File([blob], `ticket-screenshot-markiert-${Date.now()}.png`, { type: "image/png" });
    if (token.trim()) {
      await uploadAttachment(token, file);
    } else {
      queueAttachment(file, dataUrl);
    }
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

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (!item.type.toLowerCase().startsWith("image/")) continue;
        const file = item.getAsFile();
        if (!file) continue;
        const preview = URL.createObjectURL(file);
        const msg = publicToken.trim()
          ? "Screenshot aus Zwischenablage uebernommen. Markierungen hinzufuegen?"
          : "Screenshot aus Zwischenablage vorgemerkt. Markierungen hinzufuegen?";
        stageScreenshotDraft(file, preview, msg);
        event.preventDefault();
        return;
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [publicToken]);

  async function submit() {
    if (!name.trim() || !subject.trim() || !description.trim()) {
      setSubmitError("Bitte Name, Betreff und Beschreibung ausfuellen.");
      setSubmitSuccess(null);
      return;
    }

    setSubmitBusy(true);
    setSubmitError("");
    try {
      const r = await fetch(`/api/public/tickets?plantId=${encodeURIComponent(createPlantSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requester_name: name, subject, description }),
      });
      if (!r.ok) {
        const txt = await r.text();
        setSubmitSuccess(null);
        setSubmitError(`Fehler ${r.status}${txt ? `: ${txt.slice(0, 180)}` : ""}`);
        return;
      }

      const body = await r.json();
      const token = String(body.public_token || "");
      setPublicToken(token);
      setSubmitSuccess({
        ticketId: Number(body.ticket_id),
        token,
        statusUrl: String(body.public_status_url || `/Tickets/status/${token}`),
        dashboardUrl: `/Tickets/dashboard/${encodeURIComponent(createPlantSlug)}`,
      });
      const pendingNow = [...pendingAttachments];
      if (pendingNow.length > 0) {
        await uploadPendingAttachments(token, pendingNow);
      }
    } catch (e) {
      setSubmitSuccess(null);
      setSubmitError(`Ticket konnte nicht gesendet werden: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitBusy(false);
    }
  }

  async function loadStatus(token: string) {
    if (!token) return;
    const r = await fetch(`/api/public/tickets/${encodeURIComponent(token)}`);
    if (!r.ok) {
      setSubmitError(`Fehler ${r.status}`);
      return;
    }
    setStatusData(await r.json());
  }

  async function loadDashboardList(plantSlug: string) {
    setDashboardLoading(true);
    setDashboardError("");
    try {
      const r = await fetch(`/api/public/tickets/dashboard?plantId=${encodeURIComponent(plantSlug)}&limit=120`);
      if (!r.ok) {
        const txt = await r.text();
        setDashboardError(`Dashboard Fehler ${r.status}${txt ? `: ${txt.slice(0, 160)}` : ""}`);
        setDashboardItems([]);
        setDashboardDetail(null);
        return;
      }
      const body = await r.json();
      const items = (body.items || []) as DashboardItem[];
      setDashboardItems(items);
      if (items.length > 0) {
        const firstId = selectedTicketId && items.some((x) => x.ticket_id === selectedTicketId) ? selectedTicketId : items[0].ticket_id;
        setSelectedTicketId(firstId);
      } else {
        setSelectedTicketId(null);
        setDashboardDetail(null);
      }
    } catch (e) {
      setDashboardError(`Dashboard Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDashboardLoading(false);
    }
  }

  async function loadDashboardDetail(plantSlug: string, ticketId: number) {
    const r = await fetch(`/api/public/tickets/dashboard/${ticketId}?plantId=${encodeURIComponent(plantSlug)}`);
    if (!r.ok) {
      const txt = await r.text();
      setDashboardError(`Detail Fehler ${r.status}${txt ? `: ${txt.slice(0, 160)}` : ""}`);
      return;
    }
    setDashboardDetail((await r.json()) as DashboardDetail);
  }

  useEffect(() => {
    if (mode === "status" && third) {
      void loadStatus(third);
    }
    if (mode === "dashboard") {
      void loadDashboardList(dashboardPlantSlug);
    }
  }, [mode, third, dashboardPlantSlug]);

  useEffect(() => {
    if (mode !== "dashboard" || !selectedTicketId) return;
    void loadDashboardDetail(dashboardPlantSlug, selectedTicketId);
  }, [mode, selectedTicketId, dashboardPlantSlug]);

  const dashboardStats = useMemo(() => {
    const open = dashboardItems.filter((x) => OPEN_STATUSES.has(x.status)).length;
    const inWork = dashboardItems.filter((x) => x.status === "QUEUED" || x.status === "IN_PROGRESS").length;
    const closed = dashboardItems.filter((x) => CLOSED_STATUSES.has(x.status)).length;
    const fresh = dashboardItems.filter((x) => x.status === "NEW" || x.status === "TRIAGE").length;
    return { open, inWork, closed, fresh, total: dashboardItems.length };
  }, [dashboardItems]);

  const filteredDashboardItems = useMemo(() => {
    const q = dashboardSearch.trim().toLowerCase();
    return dashboardItems.filter((item) => {
      if (dashboardFilter === "open" && !OPEN_STATUSES.has(item.status)) return false;
      if (dashboardFilter === "new" && !(item.status === "NEW" || item.status === "TRIAGE")) return false;
      if (dashboardFilter === "work" && !(item.status === "QUEUED" || item.status === "IN_PROGRESS" || item.status === "RESOLVED")) return false;
      if (dashboardFilter === "closed" && !CLOSED_STATUSES.has(item.status)) return false;
      if (!q) return true;
      const text = `${item.ticket_id} ${item.subject} ${item.description || ""} ${item.requester_name || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [dashboardItems, dashboardSearch, dashboardFilter]);

  useEffect(() => {
    if (mode !== "dashboard") return;
    if (filteredDashboardItems.length === 0) {
      setSelectedTicketId(null);
      setShowDetailModal(false);
      setDashboardDetail(null);
      return;
    }
    if (!selectedTicketId || !filteredDashboardItems.some((x) => x.ticket_id === selectedTicketId)) {
      setSelectedTicketId(filteredDashboardItems[0].ticket_id);
    }
  }, [mode, filteredDashboardItems, selectedTicketId]);

  function openDashboardDetail(ticketId: number) {
    setSelectedTicketId(ticketId);
    setShowDetailModal(true);
  }

  function goBackFromDashboard() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = `/Tickets/${encodeURIComponent(dashboardPlantSlug)}`;
  }

  function goBackFromStatus(plantSlug: string) {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = `/Tickets/${encodeURIComponent(plantSlug)}`;
  }

  function UploadActions({ token }: { token: string }) {
    return (
      <div style={{ marginTop: 12 }}>
        <h3>Anhaenge</h3>
        {!token.trim() ? <p>Anhaenge jetzt erfassen. Sie werden nach Ticket-Erstellung automatisch hochgeladen.</p> : null}
        <input
          type="file"
          disabled={uploadBusy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (token.trim()) {
              void uploadAttachment(token, file);
            } else {
              queueAttachment(file);
            }
            e.currentTarget.value = "";
          }}
        />
        <input
          ref={screenshotInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            handlePickedScreenshot(e.target.files?.[0] || null, token);
            e.currentTarget.value = "";
          }}
        />
        <div className="toolbar">
          <button className="secondary" onClick={() => void captureScreenshot(token)} disabled={uploadBusy}>Screenshot aufnehmen</button>
          <button className="secondary" onClick={openScreenshotPicker} disabled={uploadBusy}>Screenshot-Datei waehlen</button>
        </div>
        {pendingAttachments.length > 0 ? (
          <div className="pending-list">
            <p><strong>Vorgemerkte Anhaenge:</strong></p>
            {pendingAttachments.map((item) => (
              <div key={item.id} className="pending-item">
                <span>{item.file.name}</span>
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
                      <button onClick={() => void uploadRawScreenshot(token)} disabled={uploadBusy}>Nein, direkt hochladen</button>
                      <button className="secondary" onClick={() => void captureScreenshot(token)} disabled={uploadBusy}>Neu aufnehmen</button>
                    </div>
                  </>
                ) : (
                  <div className="toolbar">
                    <button className="secondary" onClick={() => void captureScreenshot(token)} disabled={uploadBusy}>Neu aufnehmen</button>
                    <button className="secondary" onClick={clearScreenshotDraft} disabled={uploadBusy}>Entwurf loeschen</button>
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
                  <button onClick={() => void uploadAnnotatedScreenshot(token)} disabled={uploadBusy}>Markierung speichern + hochladen</button>
                  <button className="secondary" onClick={() => setAnnotating(false)} disabled={uploadBusy}>Zur Vorschau</button>
                </div>
              </>
            )}
          </div>
        ) : null}
        {uploadMessage ? <p>{uploadMessage}</p> : null}
      </div>
    );
  }

  if (mode === "status") {
    const statusPlantSlug = typeof statusData?.plant_slug === "string" && statusData.plant_slug.trim()
      ? statusData.plant_slug.trim()
      : createPlantSlug;
    return (
      <div className="container">
        <div className="card">
          <h1>Ticket Status</h1>
          <p>Token: {third}</p>
          <UploadActions token={third} />
          {statusData ? (
            <>
              <p>Status: {statusData.status}</p>
              <p>Betreff: {statusData.subject}</p>
              <div className="toolbar">
                <a className="cta" href={`/Tickets/dashboard/${encodeURIComponent(statusPlantSlug)}`}>Verlauf der Anlage</a>
                <button className="secondary" onClick={() => goBackFromStatus(statusPlantSlug)}>Zurueck</button>
              </div>
              {statusData.wrong_plant_reason ? <p>Hinweis: falscher Anlagen-Link.</p> : null}
              {statusData.suggested_create_url ? <a className="cta" href={statusData.suggested_create_url}>Neues Ticket fuer richtige Anlage erstellen</a> : null}
            </>
          ) : (
            <p>Lade...</p>
          )}
        </div>
      </div>
    );
  }

  if (mode === "dashboard") {
    return (
      <div className="container">
        <div className="card">
          <h1>Ticket Dashboard: {dashboardPlantSlug}</h1>
          <div className="toolbar">
            <button onClick={() => void loadDashboardList(dashboardPlantSlug)} disabled={dashboardLoading}>Aktualisieren</button>
            <button className="secondary" onClick={goBackFromDashboard}>Zurueck</button>
          </div>
          <div className="stats-grid">
            <div className="stat-card"><span>Offen</span><strong>{dashboardStats.open}</strong></div>
            <div className="stat-card"><span>Neu</span><strong>{dashboardStats.fresh}</strong></div>
            <div className="stat-card"><span>In Arbeit</span><strong>{dashboardStats.inWork}</strong></div>
            <div className="stat-card"><span>Geschlossen</span><strong>{dashboardStats.closed}</strong></div>
          </div>
          <div className="dashboard-filters">
            <input
              placeholder="Suche im Inhalt (z.B. Foerderband)"
              value={dashboardSearch}
              onChange={(e) => setDashboardSearch(e.target.value)}
            />
            <select value={dashboardFilter} onChange={(e) => setDashboardFilter(e.target.value)}>
              <option value="open">Nur offen</option>
              <option value="new">Nur neu</option>
              <option value="work">In Bearbeitung</option>
              <option value="closed">Geschlossen</option>
              <option value="all">Alle</option>
            </select>
          </div>
          {dashboardError ? <p className="notice-error">{dashboardError}</p> : null}
        </div>
        <div className="card">
          <h2>Tickets dieser Anlage</h2>
          {dashboardLoading && dashboardItems.length === 0 ? <p>Lade Tickets...</p> : null}
          {filteredDashboardItems.length === 0 ? <p>Keine Tickets fuer diesen Filter gefunden.</p> : null}
          {filteredDashboardItems.length > 0 ? (
            <div className="ticket-list">
              {filteredDashboardItems.map((item) => (
                <div
                  key={item.ticket_id}
                  className={`ticket-row ${selectedTicketId === item.ticket_id ? "active" : ""}`}
                >
                  <div className="ticket-row-head">
                    <strong>#{item.ticket_id} {item.subject}</strong>
                    <span className={`status-pill ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
                  </div>
                  <p>{item.description ? item.description.slice(0, 120) : "Keine Beschreibung"}{item.description && item.description.length > 120 ? "..." : ""}</p>
                  <small>Gemeldet von {item.requester_name} | Aktualisiert: {formatTs(item.updated_at)}</small>
                  <div className="toolbar">
                    <button className="secondary" onClick={() => openDashboardDetail(item.ticket_id)}>Details ansehen</button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {showDetailModal ? (
          <div className="modal-backdrop" onClick={() => setShowDetailModal(false)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h2>Bearbeitungsstand</h2>
                <button className="secondary" onClick={() => setShowDetailModal(false)}>Schliessen</button>
              </div>
              {!dashboardDetail ? <p>Lade Ticket-Details...</p> : (
                <>
                  <div className="modal-hero">
                    <p><strong>Ticket #{dashboardDetail.ticket_id}</strong> - {dashboardDetail.subject}</p>
                    <span className={`status-pill ${statusClass(dashboardDetail.status)}`}>{statusLabel(dashboardDetail.status)}</span>
                  </div>
                  <p><strong>Was wurde gemeldet?</strong> {dashboardDetail.description}</p>
                  <div className="stepper">
                    {STATUS_STEPS.map((step, idx) => {
                      const activeIdx = STATUS_STEPS.indexOf(dashboardDetail.status);
                      const fallback = dashboardDetail.status === "CANCELLED_WRONG_PLANT" ? 1 : dashboardDetail.status === "CANCELLED" ? 1 : activeIdx;
                      const pointIdx = fallback >= 0 ? fallback : 0;
                      const cls = idx < pointIdx ? "done" : idx === pointIdx ? "active" : "todo";
                      return (
                        <div key={step} className={`step ${cls}`}>
                          <span>{statusLabel(step)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <h3>Verlauf</h3>
                  <ul className="timeline-list">
                    {dashboardDetail.timeline.map((ev, i) => (
                      <li key={`${ev.created_at}-${i}`}>
                        <span className="dot" />
                        <div>
                          <strong>{timelineText(ev.event_type, ev.payload || {})}</strong>
                          <small>{formatTs(ev.created_at)}</small>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card">
        <h1>Ticket fuer Anlage: {createPlantSlug}</h1>
        <div className="toolbar">
          <a className="cta" href={`/Tickets/dashboard/${encodeURIComponent(createPlantSlug)}`}>Verlauf der Anlage</a>
        </div>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Betreff" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea placeholder="Beschreibung" rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />
        <button onClick={submit} disabled={submitBusy}>{submitBusy ? "Sende..." : "Ticket senden"}</button>
        {submitError ? <p className="notice-error">{submitError}</p> : null}
        {submitSuccess ? (
          <div className="notice-ok">
            <p><strong>Ticket erstellt:</strong> #{submitSuccess.ticketId}</p>
            <p>Token: <code>{submitSuccess.token}</code></p>
          </div>
        ) : null}
        <UploadActions token={publicToken} />
        {submitSuccess ? (
          <div className="toolbar">
            <a className="cta" href={submitSuccess.statusUrl}>Status aufrufen</a>
            <a className="cta" href={submitSuccess.dashboardUrl}>Verlauf der Anlage</a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

