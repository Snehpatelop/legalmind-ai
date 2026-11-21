"""Generate the fictional sample contracts in sample_data/ (used for demos and the sample Ragas dataset).

All parties and terms are fictional.  Run:  python scripts/generate_sample_pdfs.py
"""
from __future__ import annotations

from pathlib import Path

import pymupdf as fitz

OUT = Path(__file__).resolve().parents[2] / "sample_data"

CSS = """
body { font-family: serif; font-size: 10.5pt; line-height: 1.45; color: #1a1a1a; }
h1 { font-size: 15pt; text-align: center; margin-bottom: 4pt; }
h2 { font-size: 11pt; margin-top: 12pt; margin-bottom: 3pt; }
p { margin: 0 0 6pt 0; text-align: justify; }
.c { text-align: center; color: #444; }
"""


def msa(version: str) -> str:
    v1 = version == "2025"
    fee = "USD 18,500" if v1 else "USD 21,000"
    due = "thirty (30) days" if v1 else "forty-five (45) days"
    late = "1.5% per month" if v1 else "1.0% per month"
    term = (
        "This Agreement commences on 1 March 2025 (the Effective Date) and continues for an initial term of twenty-four "
        "(24) months. It renews automatically for successive twelve (12) month periods unless either party gives at least "
        "sixty (60) days' written notice of non-renewal before the end of the then-current term."
        if v1 else
        "This Agreement commences on 1 March 2026 (the Effective Date) and continues for a fixed term of thirty-six (36) "
        "months. It does not renew automatically; any extension must be agreed in writing by both parties."
    )
    convenience = (
        "The Client may terminate this Agreement for convenience by giving at least ninety (90) days' prior written "
        "notice to the Provider."
        if v1 else
        "Either party may terminate this Agreement for convenience by giving at least thirty (30) days' prior written "
        "notice to the other party."
    )
    cap = (
        "the total fees paid by the Client in the twelve (12) months preceding the event giving rise to the claim"
        if v1 else "the total fees paid by the Client in the six (6) months preceding the event giving rise to the claim"
    )
    conf_years = "five (5) years" if v1 else "three (3) years"
    disputes = (
        "Any dispute arising out of or in connection with this Agreement shall be finally resolved by arbitration in "
        "London under the LCIA Rules by a sole arbitrator. This Agreement is governed by the laws of England and Wales."
        if v1 else
        "Any dispute arising out of or in connection with this Agreement shall be submitted to the exclusive jurisdiction "
        "of the state and federal courts located in Wilmington, Delaware. This Agreement is governed by the laws of the "
        "State of Delaware."
    )
    credits = (
        "For each 0.5% (or part thereof) by which availability falls below 99.5% in a calendar month, the Client shall "
        "receive a service credit of 5% of the monthly fee, capped at 25% of the monthly fee for that month."
        if v1 else
        "For each 0.5% (or part thereof) by which availability falls below 99.5% in a calendar month, the Client shall "
        "receive a service credit of 5% of the monthly fee, capped at 10% of the monthly fee for that month."
    )
    title_suffix = "" if v1 else " — RENEWAL DRAFT"
    return f"""
<h1>MASTER SERVICES AGREEMENT{title_suffix}</h1>
<p class="c">Agreement No. NWA-BRL-{version}-014</p>
<p>This Master Services Agreement (the "Agreement") is entered into by and between <b>Northwind Analytics Ltd.</b>, a
company registered in England and Wales with its office at 41 Harbour Lane, Bristol BS1 4XY (the "Provider"), and
<b>Brightline Retail Inc.</b>, a Delaware corporation with its principal office at 900 Market Street, Wilmington,
DE 19801 (the "Client"). The Provider and the Client are each a "party" and together the "parties".</p>

<h2>1. Services</h2>
<p>1.1 The Provider shall provide the data analytics, demand forecasting and dashboard services described in Schedule A
(the "Services") in a professional manner consistent with good industry practice.</p>
<p>1.2 The Client shall provide timely access to the data sources, systems and personnel reasonably required for the
Provider to perform the Services, and shall be responsible for the accuracy of all data it supplies.</p>
<p>1.3 Each party shall appoint a relationship manager responsible for day-to-day communication and escalation.</p>

<h2>2. Term</h2>
<p>2.1 {term}</p>

<h2>3. Fees and Payment</h2>
<p>3.1 In consideration of the Services the Client shall pay the Provider a fixed monthly fee of {fee}, exclusive of
applicable taxes. Invoices are issued monthly in advance and are payable within {due} of the invoice date.</p>
<p>3.2 Late payments accrue interest at {late} from the due date until payment in full.</p>
<p>3.3 If any undisputed invoice remains unpaid for more than fifteen (15) days after its due date, the Provider may
suspend the Services on five (5) business days' written notice until payment is received.</p>
<p>3.4 The Provider may increase the monthly fee once in each contract year by no more than the percentage increase in the
UK Consumer Prices Index over the preceding twelve months, on sixty (60) days' written notice.</p>

<h2>4. Service Levels</h2>
<p>4.1 The Provider shall ensure that the hosted dashboards achieve monthly availability of at least 99.5%, excluding
scheduled maintenance notified at least 48 hours in advance.</p>
<p>4.2 {credits} Service credits are the Client's sole and exclusive financial remedy for failure to meet the
availability target.</p>
<p>4.3 If a Deliverable listed in Schedule A is delivered more than ten (10) business days late for reasons within the
Provider's control, the Provider shall pay liquidated damages of USD 500 for each additional business day of delay, up
to a maximum of USD 10,000 per Deliverable.</p>

<h2>5. Termination</h2>
<p>5.1 {convenience}</p>
<p>5.2 Either party may terminate this Agreement immediately by written notice if the other party commits a material
breach and fails to remedy that breach within thirty (30) days after receiving written notice requiring it to do so.</p>
<p>5.3 Either party may terminate this Agreement immediately if the other party becomes insolvent, enters into
administration or liquidation, or ceases to carry on business.</p>
<p>5.4 On termination the Client shall pay all fees accrued up to the termination date, and the Provider shall return or
securely delete all Client Data within thirty (30) days.</p>

<h2>6. Confidentiality</h2>
<p>6.1 Each party shall keep the other party's Confidential Information strictly confidential, use it only for the
purposes of this Agreement, and disclose it only to employees and advisers who need to know it and are bound by
equivalent obligations.</p>
<p>6.2 The obligations in this clause survive for {conf_years} after termination or expiry of this Agreement.</p>
<p>6.3 Confidential Information does not include information that is or becomes public other than through breach, or
that a party is required to disclose by law.</p>

<h2>7. Data Protection</h2>
<p>7.1 Each party shall comply with applicable data protection laws. The Provider shall process personal data only on the
documented instructions of the Client and shall implement appropriate technical and organisational security measures.</p>
<p>7.2 The Provider shall notify the Client without undue delay, and in any event within seventy-two (72) hours, after
becoming aware of a personal data breach affecting Client Data.</p>

<h2>8. Intellectual Property</h2>
<p>8.1 The Client retains all rights in Client Data. The Provider retains all rights in its pre-existing software,
models and know-how. On payment in full, the Client owns the custom reports created specifically for it.</p>

<h2>9. Indemnification</h2>
<p>9.1 The Provider shall indemnify and hold harmless the Client against all losses arising from any claim that the
Services infringe a third party's intellectual property rights.</p>
<p>9.2 The Client shall indemnify and hold harmless the Provider against all losses arising from any claim relating to
data supplied by the Client, including any claim that such data was collected unlawfully. The Client's liability under
this clause 9.2 is not subject to the limitation in clause 10.</p>

<h2>10. Limitation of Liability</h2>
<p>10.1 Subject to clause 10.3, the Provider's aggregate liability arising out of or in connection with this Agreement
shall not exceed {cap}.</p>
<p>10.2 Neither party shall be liable for any indirect or consequential loss, loss of profits, or loss of goodwill.</p>
<p>10.3 Nothing in this Agreement limits liability for death or personal injury caused by negligence, fraud, or breach of
clause 6 (Confidentiality).</p>

<h2>11. Non-Solicitation</h2>
<p>11.1 During the term and for twelve (12) months afterwards, neither party shall solicit for employment any employee of
the other party who was involved in the Services, without the other party's prior written consent.</p>

<h2>12. Dispute Resolution and Governing Law</h2>
<p>12.1 The parties shall first attempt to resolve any dispute through good-faith negotiation between their relationship
managers for a period of twenty (20) business days.</p>
<p>12.2 {disputes}</p>

<h2>13. General</h2>
<p>13.1 This Agreement, together with its Schedules, constitutes the entire agreement between the parties. Any amendment
must be in writing and signed by both parties. Neither party may assign this Agreement without the other's consent,
not to be unreasonably withheld. Notices must be in writing and delivered by hand, courier or email to the addresses
above.</p>

<h2>Schedule A — Services and Deliverables</h2>
<p>A1. Weekly demand forecast for 1,200 store-SKU combinations. A2. Executive sales dashboard refreshed daily by 07:00 UK
time. A3. Quarterly model performance review. A4. Up to 40 hours per month of analyst support.</p>

<p style="margin-top:18pt">Signed for and on behalf of Northwind Analytics Ltd. ____________________ &nbsp;&nbsp;
Signed for and on behalf of Brightline Retail Inc. ____________________</p>
"""


def render(html: str, path: Path) -> None:
    story = fitz.Story(html=f"<body>{html}</body>", user_css=CSS)
    writer = fitz.DocumentWriter(str(path))
    mediabox = fitz.paper_rect("a4")
    where = mediabox + (64, 64, -64, -64)
    more = True
    while more:
        dev = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(dev)
        writer.end_page()
    writer.close()


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    render(msa("2025"), OUT / "Northwind_Brightline_Master_Services_Agreement_2025.pdf")
    render(msa("2026"), OUT / "Northwind_Brightline_MSA_2026_Renewal_Draft.pdf")
    for p in sorted(OUT.glob("*.pdf")):
        with fitz.open(p) as d:
            print(f"{p.name}: {d.page_count} pages")
