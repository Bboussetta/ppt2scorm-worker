// PPT/PPTX -> SCORM 1.2 ZIP worker
// - POST /convert (multipart): file=.ppt/.pptx, title=<string optional>
// - Header required: x-worker-secret: <WORKER_SECRET>
// - Returns: application/zip with index.html, imsmanifest.xml, slides/*.png

import express from "express";
import Busboy from "busboy";
import { promises as fs } from "fs";
import fse from "fs-extra";
import { exec as _exec } from "child_process";
import { promisify } from "util";
import archiver from "archiver";
import { nanoid } from "nanoid";

const exec = promisify(_exec);
const app = express();

// --- Normalize env + helpers ---
function norm(s) {
  return String(s ?? "").trim();
}
const WORKER_SECRET = norm(process.env.WORKER_SECRET);

function mask(s) {
  if (!s) return "(empty)";
  return `${s.slice(0, 2)}…${s.slice(-2)} (${s.length})`;
}

// Health + diag
app.get("/health", (_req, res) => res.status(200).send("ok"));
app.get("/diag", (_req, res) => {
  res.json({
    hasSecret: Boolean(WORKER_SECRET),
    secretMasked: mask(WORKER_SECRET),
  });
});

app.post("/convert", async (req, res) => {
  try {
    // ---- SECRET CHECK (instrumented) ----
    const receivedRaw =
      req.headers["x-worker-secret"] ??
      req.headers["X-Worker-Secret"] ??
      req.get("x-worker-secret") ??
      "";
    const received = norm(receivedRaw);
    const expected = WORKER_SECRET;

    console.log("SECDBG", {
      recv_len: received.length,
      exp_len: expected.length,
      recv_head: received.slice(0, 3),
      recv_tail: received.slice(-3),
      exp_head: expected.slice(0, 3),
      exp_tail: expected.slice(-3),
    });

    if (expected && received !== expected) {
      return res.status(401).send("Unauthorized");
    }

    // --- defaults + temp dir ---
    let title = "Converted Presentation";
    let tmpDir = `/tmp/${nanoid()}`;
    let uploadPath = "";
    let baseName = "presentation";

    await fse.ensureDir(tmpDir);

    // --- parse multipart
    const parse = new Promise((resolve, reject) => {
      const bb = Busboy({ headers: req.headers });
      bb.on("field", (name, val) => {
        if (name === "title" && val) title = String(val).slice(0, 200);
      });
      bb.on("file", async (_name, file, info) => {
        const filename = info.filename || "upload.pptx";
        baseName = filename.replace(/\.[^.]+$/, "");
        uploadPath = `${tmpDir}/${filename}`;
        const out = fse.createWriteStream(uploadPath);
        file.pipe(out);
        out.on("close", resolve);
        out.on("error", reject);
      });
      bb.on("error", reject);
      req.pipe(bb);
    });

    await parse;
    if (!uploadPath) return res.status(400).send("No file uploaded");

    // --- 1) PPT/PPTX -> PDF
    await exec(`soffice --headless --convert-to pdf --outdir "${tmpDir}" "${uploadPath}"`);
    const pdfPath = `${tmpDir}/${baseName}.pdf`;

    // --- 2) PDF -> PNG slides
    const slidesDir = `${tmpDir}/slides`;
    await fse.ensureDir(slidesDir);
    await exec(`pdftoppm -png "${pdfPath}" "${slidesDir}/slide"`);

    let slideFiles = (await fs.readdir(slidesDir))
      .filter(n => n.toLowerCase().endsWith(".png"))
      .sort(new Intl.Collator(undefined, { numeric: true }).compare);

    if (slideFiles.length === 0) throw new Error("No slides produced. Check input file.");

    const slidePaths = slideFiles.map(n => `slides/${n}`);

    // --- 3) Build SCORM files
    const indexHtml = renderIndexHtml(title, slidePaths);
    const manifestXml = renderManifest(title, slidePaths);

    // --- 4) Stream ZIP
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="course_scorm.zip"');
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", err => { throw err; });
    archive.pipe(res);

    archive.append(indexHtml, { name: "index.html" });
    archive.append(manifestXml, { name: "imsmanifest.xml" });
    for (const n of slideFiles) {
      archive.file(`${slidesDir}/${n}`, { name: `slides/${n}` });
    }
    await archive.finalize();

    archive.on("end", async () => { try { await fse.remove(tmpDir); } catch {} });

  } catch (err) {
    console.error(err);
    return res.status(500).send("Worker error: " + (err?.message || err));
  }
});

// ---------- HTML/Manifest templates ----------
function renderIndexHtml(title, slides) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
:root { --bg:#0b0c10; --fg:#e8e8e8; --muted:#9aa0a6; --accent:#3b82f6; }
*{box-sizing:border-box} html,body{height:100%;margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
.wrap{height:100%;display:grid;grid-template-rows:1fr auto}
.stage{display:grid;place-items:center;padding:12px}
.stage img{max-width:100%;max-height:calc(100vh - 120px);border-radius:12px;background:#111}
.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-top:1px solid #1f2937;background:#0f1115}
.group{display:flex;align-items:center;gap:8px}
button{all:unset;padding:10px 14px;border-radius:10px;background:#1f2937;cursor:pointer}
button:hover{background:#243042} button[disabled]{opacity:.4;cursor:not-allowed}
.pill{padding:8px 12px;border-radius:999px;background:#111827;color:var(--muted);font-size:13px}
.progress{position:relative;flex:1;height:8px;background:#1f2937;border-radius:999px;overflow:hidden}
.progress>span{position:absolute;left:0;top:0;bottom:0;width:0%;background:var(--accent)}
a.link{color:var(--muted);text-decoration:underline}
</style>
<script>
let API=null;function findAPI(w){let d=0;while(w&&d++<10){if(w.API)return w.API;try{if(w.parent&&w.parent!==w)w=w.parent;else break;}catch(e){break;}}return null}
function getAPI(){if(API)return API;try{API=findAPI(window)||findAPI(window.opener)}catch(e){}return API}
const Local={LMSInitialize:()=> "true",LMSFinish:()=> "true",LMSGetValue:(k)=> localStorage.getItem('loc:'+k)||"",LMSSetValue:(k,v)=> {localStorage.setItem('loc:'+k,String(v));return "true"},LMSCommit:()=> "true"};
function scorm(){return getAPI()||Local}
const slides=${JSON.stringify(slides)};
let idx=0;
function set(i){
  idx=Math.max(0,Math.min(i,slides.length-1));
  document.getElementById('s').src=slides[idx];
  document.getElementById('c').textContent=(idx+1)+'/'+slides.length;
  document.getElementById('p').disabled=(idx===0);
  document.getElementById('n').disabled=(idx===slides.length-1);
  scorm().LMSSetValue('cmi.core.lesson_location',''+idx);
  const st=(idx===slides.length-1)?'completed':'incomplete';
  scorm().LMSSetValue('cmi.core.lesson_status',st);
}
window.addEventListener('load',()=>{scorm().LMSInitialize('');set(0)});
window.addEventListener('beforeunload',()=>{scorm().LMSCommit('');scorm().LMSFinish('')});
</script>
</head>
<body>
<div class="wrap">
  <div class="stage"><img id="s" alt="Slide"/></div>
  <div class="bar">
    <div class="group">
      <button id="p" onclick="set(idx-1)">◀ Prev</button>
      <span id="c" class="pill"></span>
      <button id="n" onclick="set(idx+1)">Next ▶</button>
    </div>
    <div class="progress" aria-hidden="true"><span id="prog"></span></div>
    <a class="link" href="https://www.linkedin.com/in/bilal-boussetta/" target="_blank" rel="noreferrer">by Bilal Boussetta</a>
  </div>
</div>
<script>
const prog=document.getElementById('prog');
new MutationObserver(()=>{ prog.style.width=((idx+1)/slides.length*100).toFixed(0)+'%';})
.observe(document.getElementById('c'),{childList:true});
</script>
</body></html>`;
}

function renderManifest(title, files) {
  const filesXml = files.map(f => `<file href="${f}"/>`).join("");
  return `<manifest identifier="MANIFEST-1" version="1.0"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:imsmd="http://www.imsglobal.org/xsd/imsmd_rootv1p2p1"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2">
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>${escapeXml(title)}</title>
      <item identifier="ITEM-1" identifierref="RES-1" isvisible="true">
        <title>Slides</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>${filesXml}
    </resource>
  </resources>
</manifest>`;
}

function escapeHtml(s){return s.replace(/[&<>'"]/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function escapeXml(s){return escapeHtml(s)}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Worker listening on", PORT));

