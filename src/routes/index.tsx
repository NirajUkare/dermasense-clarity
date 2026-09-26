import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { ArrowDown, ArrowRight, Check, Download, FileText, ImagePlus, LoaderCircle, RotateCcw, ShieldCheck, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { assessImage } from "@/lib/assessment.functions";

type Assessment = { description: string; impression: string; differential: string; recommendation: string; imageQuality: string };
type Field = keyof Assessment;

const sections: { key: Field; label: string }[] = [
  { key: "description", label: "Visible findings" },
  { key: "impression", label: "Clinical impression" },
  { key: "differential", label: "Considerations" },
  { key: "recommendation", label: "Suggested next steps" },
  { key: "imageQuality", label: "Image quality" },
];

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "DermaSense — Skin image reports for clinicians" },
    { name: "description", content: "Upload a skin image, review a draft assessment, and export a physician-reviewed PDF report with DermaSense." },
    { property: "og:title", content: "DermaSense — Skin image reports for clinicians" },
    { property: "og:description", content: "Upload a skin image, review a draft assessment, and export a physician-reviewed PDF report." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Index,
});

function Index() {
  const assess = useServerFn(assessImage);
  const fileRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState("");
  const [initials, setInitials] = useState("");
  const [site, setSite] = useState("");
  const [history, setHistory] = useState("");
  const [clinician, setClinician] = useState("");
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => { if (image) URL.revokeObjectURL(image); }, [image]);

  function selectFile(next?: File) {
    if (!next) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(next.type)) {
      setError("Please choose a JPG, PNG, or WebP image."); return;
    }
    if (next.size > 5 * 1024 * 1024) {
      setError("Please choose an image smaller than 5 MB."); return;
    }
    setFile(next);
    setImage(URL.createObjectURL(next));
    setAssessment(null);
    setApproved(false);
    setError("");
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false);
    selectFile(event.dataTransfer.files[0]);
  }

  async function generate() {
    if (!file) { setError("Add a skin image to continue."); return; }
    if (!site.trim()) { setError("Enter the body area to continue."); return; }
    setBusy(true); setError(""); setApproved(false); setAssessment(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the image. Please try another file."));
        reader.readAsDataURL(file);
      });
      const result = await assess({ data: { image: dataUrl, site: site.trim(), history: history.trim() } });
      setAssessment(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The assessment could not be completed. Please try again.");
    } finally { setBusy(false); }
  }

  async function download() {
    if (!assessment || !approved || !clinician.trim()) return;
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const margin = 20;
    let y = 22;
    const pageHeight = 297;
    const write = (value: string, size = 10, weight: "normal" | "bold" = "normal", gap = 6) => {
      pdf.setFont("helvetica", weight);
      pdf.setFontSize(size);
      const lines = pdf.splitTextToSize(value || "Not provided", 170) as string[];
      const lineHeight = size * 0.42;
      if (y + lines.length * lineHeight + gap > pageHeight - margin) { pdf.addPage(); y = 22; }
      pdf.text(lines, margin, y); y += lines.length * lineHeight + gap;
    };
    pdf.setFillColor(23, 21, 18); pdf.rect(0, 0, 210, 11, "F");
    write("DERMASENSE", 11, "bold", 3);
    write("Skin image assessment | Clinician-reviewed report", 16, "bold", 7);
    pdf.setDrawColor(180, 180, 180); pdf.line(margin, y - 2, 190, y - 2);
    write(`Date: ${new Date().toLocaleDateString()}     Patient reference: ${initials.trim() || "Not supplied"}`, 10, "normal", 2);
    write(`Body area: ${site.trim()}     Reviewed by: ${clinician.trim()}`, 10, "normal", 7);
    if (history.trim()) { write("CLINICAL CONTEXT", 10, "bold", 2); write(history.trim(), 10, "normal", 6); }
    if (image) {
      try {
        const img = new Image();
        img.src = image;
        await img.decode();
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const context = canvas.getContext("2d");
        if (context) {
          context.drawImage(img, 0, 0, canvas.width, canvas.height);
          const width = 60;
          const height = Math.min(55, width * canvas.height / canvas.width);
          if (y + height > pageHeight - 25) { pdf.addPage(); y = 22; }
          pdf.addImage(canvas.toDataURL("image/jpeg", 0.8), "JPEG", margin, y, width, height);
          y += height + 9;
        }
      } catch { /* retain the report text even when image embedding fails */ }
    }
    for (const section of sections) {
      write(section.label.toUpperCase(), 10, "bold", 2);
      write(assessment[section.key], 10, "normal", 6);
    }
    write("Clinical note", 10, "bold", 2);
    write("Draft observations were reviewed and edited as needed by the named clinician. Image-based support is not a definitive diagnosis. Correlate with history and in-person examination.", 9);
    pdf.save(`dermasense-report-${(initials.trim() || "case").replace(/[^a-z0-9-]/gi, "-")}.pdf`);
  }

  function updateAssessment(key: Field, value: string) {
    setAssessment((current) => current ? { ...current, [key]: value } : current);
    setApproved(false);
  }

  return <div className="min-h-screen bg-paper text-ink antialiased">
    <header className="border-b-2 border-ink/10 bg-paper">
      <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-5 md:px-6">
        <a href="#top" className="flex items-center gap-2.5" aria-label="DermaSense home">
          <span className="grid size-9 place-items-center rounded-full bg-ink"><span className="size-4 rounded-full bg-coral" /></span>
          <span className="font-display text-2xl font-extrabold">dermasense<span className="text-coral">.</span></span>
        </a>
        <div className="hidden items-center gap-2 text-xs font-bold uppercase text-ink/60 sm:flex"><ShieldCheck className="size-4 text-mint" /> Clinician workspace</div>
        <Button variant="ink" onClick={() => workspaceRef.current?.scrollIntoView({ behavior: "smooth" })}>New report <ArrowRight /></Button>
      </div>
    </header>

    <main id="top">
      <section className="mx-auto max-w-6xl px-5 pb-9 pt-11 md:px-6 md:pb-12 md:pt-14">
        <div className="mb-5 flex items-center gap-2"><span className="border-2 border-ink bg-lime px-3 py-1 text-[11px] font-bold uppercase">Dermatology workspace</span><span className="text-xs font-medium text-muted-foreground">Image → Review → Report</span></div>
        <h1 className="max-w-4xl font-display text-4xl font-extrabold leading-[1.02] sm:text-5xl lg:text-6xl">A clearer path from <span className="text-coral">skin image</span> to <span className="text-cobalt">PDF report.</span></h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink/70 md:text-lg">Upload a clinical photo, review the draft findings, and export a report with your final assessment. Made for the moments between patients.</p>
        <Button variant="ink" size="lg" className="mt-6" onClick={() => workspaceRef.current?.scrollIntoView({ behavior: "smooth" })}>Start a report <ArrowDown /></Button>
      </section>

      <section ref={workspaceRef} id="workspace" className="mx-auto max-w-6xl scroll-mt-6 px-5 pb-16 md:px-6">
        <div className="grid items-start gap-5 lg:grid-cols-5 lg:gap-6">
          <div className="app-panel p-5 md:p-7 lg:col-span-3">
            <div className="mb-5 flex items-center justify-between gap-2"><h2 className="font-display text-xl font-bold">New report</h2><span className="text-[11px] font-bold uppercase text-ink/50">01 / Image & context</span></div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Choose skin image" onChange={(event: ChangeEvent<HTMLInputElement>) => selectFile(event.target.files?.[0])} />
            <div onDrop={onDrop} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} className={`relative overflow-hidden rounded-lg border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-cobalt bg-lime/20" : "border-ink/30 bg-paper/70"}`}>
              {image ? <div className="flex flex-col items-center gap-3 sm:flex-row sm:text-left"><img src={image} alt="Selected skin image" className="h-44 w-full rounded-md border border-ink/15 object-contain bg-cream sm:h-36 sm:w-44" /><div className="min-w-0 flex-1"><p className="truncate font-display font-bold">{file?.name}</p><p className="mt-1 text-sm text-ink/55">{file ? (file.size / 1024 / 1024).toFixed(2) : ""} MB · Ready for review</p><Button variant="soft" size="sm" className="mt-4" onClick={() => fileRef.current?.click()}><RotateCcw /> Replace image</Button></div><Button variant="ghost" size="icon" title="Remove image" aria-label="Remove image" onClick={() => { setFile(null); setImage(""); setAssessment(null); setApproved(false); if (fileRef.current) fileRef.current.value = ""; }}><X /></Button></div> : <><span className="mx-auto mb-4 grid size-14 place-items-center rounded-lg bg-cobalt text-cream"><ImagePlus className="size-6" /></span><p className="font-display text-lg font-bold">Drop a skin image here</p><p className="mt-1 text-sm text-ink/55">JPG, PNG or WebP · Maximum 5 MB</p><Button variant="coral" className="mt-5" onClick={() => fileRef.current?.click()}><UploadCloud /> Browse files</Button></>}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block"><span className="mb-1.5 block text-xs font-bold uppercase text-ink/60">Patient reference <span className="font-normal normal-case">(optional)</span></span><input className="field-control" placeholder="e.g. PT-1042" maxLength={50} value={initials} onChange={(event) => setInitials(event.target.value)} /></label>
              <label className="block"><span className="mb-1.5 block text-xs font-bold uppercase text-ink/60">Body area <span className="text-coral">*</span></span><input className="field-control" placeholder="e.g. Left forearm" maxLength={100} value={site} onChange={(event) => setSite(event.target.value)} /></label>
            </div>
            <label className="mt-4 block"><span className="mb-1.5 block text-xs font-bold uppercase text-ink/60">Clinical context <span className="font-normal normal-case">(optional)</span></span><textarea className="field-control min-h-24 resize-y" placeholder="Duration, symptoms, relevant history or reason for review" maxLength={1200} value={history} onChange={(event) => setHistory(event.target.value)} /></label>
            {error && <div role="alert" className="mt-4 border-l-4 border-coral bg-coral/10 p-3 text-sm">{error}</div>}
            <Button variant="lime" size="lg" className="mt-5 w-full" onClick={generate} disabled={busy}>{busy ? <><LoaderCircle className="animate-spin" /> Reviewing image…</> : <><ImagePlus /> Prepare draft assessment <ArrowRight /></>}</Button>
            <p className="mt-3 text-center text-xs text-ink/50">A draft for clinical review, never a standalone diagnosis.</p>
          </div>

          <div className="app-panel p-5 md:p-7 lg:col-span-2">
            <div className="mb-5 flex items-center justify-between gap-2"><h2 className="font-display text-xl font-bold">Report preview</h2><span className={`flex items-center gap-1.5 text-[11px] font-bold uppercase ${assessment ? "text-mint" : "text-ink/45"}`}><span className={`size-2 rounded-full ${assessment ? "bg-mint" : "bg-ink/30"}`} />{assessment ? "Review draft" : "Awaiting image"}</span></div>
            <div className="rounded-lg border border-ink/15 bg-paper p-4">
              <div className="mb-4 flex items-center gap-2"><span className="grid size-7 place-items-center rounded bg-ink text-cream"><FileText className="size-4" /></span><div><p className="text-xs font-bold">DermaSense clinical report</p><p className="text-[11px] text-ink/50">{initials.trim() || "New patient reference"} · {site.trim() || "Body area pending"}</p></div></div>
              {assessment ? <div className="space-y-4">{sections.map(({ key, label }) => <label key={key} className="block border-t border-ink/15 pt-3"><span className="mb-1.5 block text-[11px] font-bold uppercase text-ink/60">{label}</span><textarea className="w-full resize-y rounded border border-transparent bg-cream p-2 text-sm leading-relaxed outline-none focus:border-cobalt" rows={Math.max(2, Math.ceil(assessment[key].length / 55))} value={assessment[key]} onChange={(event) => updateAssessment(key, event.target.value)} /></label>)}</div> : <div className="border-t border-ink/15 py-12 text-center"><FileText className="mx-auto size-8 text-ink/25" /><p className="mt-3 font-display font-bold">Your draft will appear here</p><p className="mx-auto mt-1 max-w-xs text-sm text-ink/50">Upload an image and add its body area to begin.</p></div>}
            </div>
            {assessment && <div className="mt-5 space-y-4"><label className="block"><span className="mb-1.5 block text-xs font-bold uppercase text-ink/60">Reviewing clinician <span className="text-coral">*</span></span><input className="field-control" placeholder="Your name" maxLength={100} value={clinician} onChange={(event) => { setClinician(event.target.value); setApproved(false); }} /></label><label className="flex cursor-pointer items-start gap-3 text-sm leading-snug"><input type="checkbox" className="mt-0.5 size-4 accent-mint" checked={approved} onChange={(event) => setApproved(event.target.checked)} /><span>I have reviewed and edited these findings as needed. I understand this image-based draft is not a diagnosis.</span></label></div>}
            <Button variant="ink" size="lg" className="mt-5 w-full" disabled={!assessment || !approved || !clinician.trim()} onClick={download}><Download /> Download PDF report</Button>
            <p className="mt-3 text-center text-xs text-ink/50">Clinician confirmation is required before export.</p>
          </div>
        </div>
      </section>

      <section className="border-y-2 border-ink bg-cream py-12"><div className="mx-auto max-w-6xl px-5 md:px-6"><h2 className="mb-7 font-display text-3xl font-extrabold">Three steps. <span className="text-cobalt">One clear record.</span></h2><div className="grid gap-4 md:grid-cols-3"><div className="rounded-lg border-2 border-ink bg-coral p-6 text-cream"><span className="font-display text-4xl font-extrabold">01</span><h3 className="mt-6 font-display text-xl font-bold">Add the image</h3><p className="mt-2 text-sm leading-relaxed">Start with a clear skin photo and a little clinical context.</p></div><div className="rounded-lg border-2 border-ink bg-cobalt p-6 text-cream"><span className="font-display text-4xl font-extrabold">02</span><h3 className="mt-6 font-display text-xl font-bold">Review the draft</h3><p className="mt-2 text-sm leading-relaxed">Read, revise, and confirm every observation before it leaves your workspace.</p></div><div className="rounded-lg border-2 border-ink bg-lime p-6 text-ink"><span className="font-display text-4xl font-extrabold">03</span><h3 className="mt-6 font-display text-xl font-bold">Save the PDF</h3><p className="mt-2 text-sm leading-relaxed">Download a report with the photo, context, findings, and clinician name.</p></div></div></div></section>
      <section className="mx-auto max-w-6xl px-5 py-12 md:px-6"><div className="flex max-w-3xl items-start gap-4"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-lime"><Check /></span><div><h2 className="font-display text-xl font-bold">Clinical judgment stays with you.</h2><p className="mt-2 text-sm leading-relaxed text-ink/65">Image analysis can miss important context. For suspicious or changing lesions, use an in-person examination and appropriate diagnostic work-up. Do not upload identifying patient details unless you have authorization to do so.</p></div></div></section>
    </main>
    <footer className="border-t border-ink/20"><div className="mx-auto flex max-w-6xl flex-col justify-between gap-3 px-5 py-7 text-sm text-ink/55 sm:flex-row md:px-6"><span className="font-display font-extrabold text-ink">dermasense<span className="text-coral">.</span></span><span>For clinician review only · Not a substitute for diagnosis</span></div></footer>
  </div>;
}