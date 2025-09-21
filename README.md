# PPT → SCORM Worker (LibreOffice + Poppler)

Converts `.ppt/.pptx` to a **SCORM 1.2 package**:
- PPT/PPTX → PDF (LibreOffice)
- PDF → PNG slides (Poppler `pdftoppm`)
- Build `index.html` (SCORM 1.2 runtime) + `imsmanifest.xml`
- Stream back a ZIP

## Deploy (Railway)
1. Create a new GitHub repo with these files.
2. On Railway → **New Project → GitHub Repo** → select this repo.
3. Add **Environment Variables**:
   - `WORKER_SECRET` = a strong random string
   - (optional) `PORT` = `8080`
4. Deploy. Get your public URL, e.g.  
   `https://ppt2scorm-worker-production.up.railway.app`
   - Health check: `GET /health` → `ok`
   - Convert endpoint: `POST /convert`

### Test (curl)
```bash
curl -X POST "https://<worker-url>/convert" \
  -H "x-worker-secret: <WORKER_SECRET>" \
  -F "file=@/path/to/presentation.pptx" \
  -F "title=My Course" \
  -o course_scorm.zip
