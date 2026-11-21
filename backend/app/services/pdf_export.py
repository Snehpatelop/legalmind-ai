"""Export summaries / risk reports to PDF using PyMuPDF's Story (HTML -> PDF, no extra deps)."""
from __future__ import annotations

import html
import io
from datetime import datetime

import pymupdf as fitz

CSS = """
* { font-family: sans-serif; }
body { font-size: 10pt; color: #172C32; }
h1 { font-size: 18pt; color: #111C2E; margin-bottom: 2pt; }
h2 { font-size: 12pt; color: #426B61; margin-top: 14pt; margin-bottom: 4pt; border-bottom: 1px solid #E5E1D8; }
p { margin: 3pt 0; line-height: 1.4; }
.meta { color: #68756F; font-size: 8.5pt; }
.cite { color: #8a6a3f; font-size: 8pt; }
.q { color: #444; font-style: italic; margin-left: 10pt; }
.high { color: #A4443B; font-weight: bold; } .medium { color: #A87822; font-weight: bold; } .low { color: #426B61; font-weight: bold; }
.disc { color: #68756F; font-size: 8pt; margin-top: 16pt; }
"""

e = lambda s: html.escape(str(s or ""))  # noqa: E731


def _cites(cites: list[dict]) -> str:
    if not cites:
        return ""
    refs = sorted({f"p. {c['page_number']}" for c in cites}, key=lambda s: int(s[3:]))
    return f' <span class="cite">[{", ".join(refs)}]</span>'


def _render(body: str) -> bytes:
    story = fitz.Story(html=f"<body>{body}</body>", user_css=CSS)
    buf = io.BytesIO()
    writer = fitz.DocumentWriter(buf)
    mediabox = fitz.paper_rect("a4")
    where = mediabox + (54, 54, -54, -54)
    more = True
    while more:
        dev = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(dev)
        writer.end_page()
    writer.close()
    return buf.getvalue()


def summary_pdf(result: dict, created_at: datetime) -> bytes:
    parts = [
        f"<h1>Document Summary</h1><p class='meta'>{e(result.get('document_name'))} · "
        f"{e(result.get('length', '')).title()} summary · Generated {created_at:%d %b %Y %H:%M} by LegalMind AI</p>",
        "<h2>Executive summary</h2>",
        f"<p>{e(result.get('executive_summary'))}{_cites(result.get('executive_summary_citations', []))}</p>",
    ]
    if result.get("parties"):
        parts.append("<h2>Parties involved</h2>")
        parts += [f"<p><b>{e(p['name'])}</b> — {e(p['role'])}{_cites(p['citations'])}</p>" for p in result["parties"]]
    if result.get("important_dates"):
        parts.append("<h2>Important dates</h2>")
        parts += [
            f"<p><b>{e(d['date'])}</b> — {e(d['description'])}{_cites(d['citations'])}</p>" for d in result["important_dates"]
        ]
    titles = {
        "key_obligations": "Key obligations",
        "financial_obligations": "Financial obligations",
        "termination_provisions": "Termination provisions",
        "liability_conditions": "Liability conditions",
        "confidentiality_provisions": "Confidentiality provisions",
        "potential_risks": "Potential risks",
    }
    for key, title in titles.items():
        items = result.get(key) or []
        if items:
            parts.append(f"<h2>{title}</h2>")
            parts += [f"<p>• {e(i['text'])}{_cites(i['citations'])}</p>" for i in items]
    parts.append(f"<p class='disc'>{e(result.get('disclaimer'))}</p>")
    return _render("".join(parts))


def risk_pdf(result: dict, created_at: datetime) -> bytes:
    c = result.get("counts", {})
    parts = [
        f"<h1>Contract Risk Analysis</h1><p class='meta'>{e(result.get('document_name'))} · Generated "
        f"{created_at:%d %b %Y %H:%M} by LegalMind AI</p>",
        f"<p>Overall risk: <span class='{result.get('overall_risk', 'LOW').lower()}'>{e(result.get('overall_risk'))}</span> "
        f"· High {c.get('HIGH', 0)} · Medium {c.get('MEDIUM', 0)} · Low {c.get('LOW', 0)}</p>",
        f"<p>{e(result.get('overview'))}</p>",
    ]
    for f in result.get("findings", []):
        lvl = f["risk_level"].lower()
        parts.append(
            f"<h2>{e(f['clause_name'])} — <span class='{lvl}'>{e(f['risk_level'])}</span></h2>"
            f"<p class='q'>“{e(f['extracted_text'])}”</p>"
            f"<p><b>Potential risk:</b> {e(f['potential_risk'])}</p><p>{e(f['explanation'])}</p>"
            f"<p class='cite'>{e(f['document_name'])}, page {f['page_number']}</p>"
        )
    parts.append(f"<p class='disc'>{e(result.get('disclaimer'))}</p>")
    return _render("".join(parts))
