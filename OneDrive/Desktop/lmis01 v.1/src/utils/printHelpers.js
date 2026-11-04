import { formatDate, formatCurrency, formatPhTime } from "./formatters";
import { normalizeAnimalType } from "../services/feeService";

/**
 * Generic Popup Window Launcher using the exact procedure as Vet Certify
 * (window.open -> write HTML -> auto window.focus() & window.print()).
 * Completely self-contained with explicit inline styling to avoid blank print previews.
 */
export const printHtmlViaPopup = (title, bodyHtml) => {
  const printWin = window.open("", "_blank", "width=850,height=1100");
  if (!printWin) {
    window.print();
    return;
  }

  const fullHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>&lrm;</title>
      <style>
        @page {
          size: letter portrait;
          margin: 10mm 12mm;
        }
        * {
          box-sizing: border-box !important;
        }
        html, body {
          background: #ffffff !important;
          color: #000000 !important;
          margin: 0 !important;
          padding: 0 !important;
          font-family: Arial, Helvetica, sans-serif;
          font-size: 10pt;
          line-height: 1.4;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        table {
          width: 100% !important;
          border-collapse: collapse !important;
        }
        thead {
          display: table-header-group !important;
        }
        tbody {
          display: table-row-group !important;
        }
        tr {
          break-inside: avoid !important;
          page-break-inside: avoid !important;
        }
        .avoid-break {
          break-inside: avoid !important;
          page-break-inside: avoid !important;
        }
        .no-print, button {
          display: none !important;
        }
      </style>
    </head>
    <body>
      ${bodyHtml}
      <script>
        window.onload = function() {
          setTimeout(function() {
            window.focus();
            window.print();
          }, 250);
        };
      </script>
    </body>
    </html>
  `;

  printWin.document.open();
  printWin.document.write(fullHtml);
  printWin.document.close();
};

/**
 * Print Handler 1: Permit Fee Record (Fee Collection Report & Official Receipt)
 * Renders the complete, detailed Fee Collection Report and Official Receipt Owner Copy.
 */
export const printPermitFeeRecord = (selectedRecord, payments = []) => {
  if (!selectedRecord) return;

  const owner = selectedRecord.owner_name || "Authorized Owner";
  const dateStr = selectedRecord.date ? selectedRecord.date.split("T")[0] : "unknown";
  const selSp = normalizeAnimalType(selectedRecord.animal_type || selectedRecord.species).toLowerCase();

  // Find every payment record in this owner + date + species batch (the same key the
  // Permit Fee Records list groups by) so the slip shows the true head count instead of
  // only the single clicked transaction.
  let groupRecords = payments.filter(
    (p) =>
      (p.owner_name || "").toLowerCase() === owner.toLowerCase() &&
      (p.date ? p.date.split("T")[0] : "unknown") === dateStr &&
      normalizeAnimalType(p.animal_type || p.species).toLowerCase() === selSp
  );
  if (!groupRecords.length) groupRecords = [selectedRecord];

  const totalHeads = groupRecords.reduce((s, r) => s + (Number(r.quantity) || 1), 0);
  const totalAmount = groupRecords.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const paid = payments.filter((p) => (p.status || "").toLowerCase() === "paid");
  const grouped = {};
  paid.forEach((p) => {
    const dStr = p.date ? p.date.split("T")[0] : "unknown";
    const k = `${(p.owner_name || "").toLowerCase()}|||${dStr}`;
    if (!grouped[k]) grouped[k] = { key: k, date: dStr };
  });
  const sortedGroupKeys = Object.keys(grouped).sort((a, b) => new Date(grouped[a].date) - new Date(grouped[b].date));
  const groupIndex = sortedGroupKeys.indexOf(`${owner.toLowerCase()}|||${dateStr}`);
  const seqId = groupIndex !== -1 ? String(groupIndex + 1).padStart(3, "0") : "001";

  const d = new Date(selectedRecord.date || new Date());
  const formattedDateStr = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  const timeFormattedStr = selectedRecord.paid_at || selectedRecord.created_at ? formatPhTime(selectedRecord.paid_at || selectedRecord.created_at) : "—";

  const speciesList = [...new Set(groupRecords.map((r) => r.animal_type || r.species).filter(Boolean))].join(", ") || "Livestock";
  const feeNamesList = [...new Set(groupRecords.map((r) => r.fee_name || "Slaughter Fee").filter(Boolean))].join(", ");

  const bodyHtml = `
    <div class="fee-slip-doc printable-permit" style="width: 100%; margin: 0; background: #ffffff; color: #000000; font-family: Arial, sans-serif; padding: 0; box-sizing: border-box; border: none;">
      
      <!-- DOCUMENT 1: FEE COLLECTION REPORT -->
      <div class="fee-doc" style="background: #ffffff; padding: 0; border: none; margin-bottom: 20px;">
        <!-- Header Band -->
        <div class="fee-header-band avoid-break" style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #1e293b; padding-bottom: 8px; margin-bottom: 12px; break-inside: avoid; page-break-inside: avoid;">
          <img src="/naga_city_seal.png" alt="City of Naga" style="width: 55px; height: 55px; object-fit: contain; border-radius: 50%;" />
          <div style="text-align: center; flex: 1;">
            <p style="margin: 0; font-size: 10px; color: #475569; text-transform: uppercase; letter-spacing: 1px;">Republic of the Philippines</p>
            <p style="margin: 2px 0; font-size: 10px; color: #475569; text-transform: uppercase; letter-spacing: 1px;">Province of Cebu</p>
            <h3 style="margin: 0; font-size: 16px; font-weight: 800; color: #0f172a; letter-spacing: 1px; text-transform: uppercase;">City of Naga</h3>
          </div>
          <img src="/bagong_pilipinas.png" alt="Bagong Pilipinas" style="width: 55px; height: 55px; object-fit: contain; border-radius: 50%;" />
        </div>

        <!-- Meta Row -->
        <div class="fee-meta-row avoid-break" style="display: flex; justify-content: space-between; align-items: flex-end; font-size: 10px; color: #334155; margin-bottom: 12px; break-inside: avoid; page-break-inside: avoid;">
          <div>Slaughterhouse: <strong style="color: #0f172a;">Naga Slaughterhouse</strong></div>
          <div style="text-align: right;">
            <div>Slip No.: <strong style="border-bottom: 1.5px solid #1e293b; font-weight: 700; color: #0f172a; padding-bottom: 1px;">FCR-${seqId}</strong></div>
            <div style="margin-top: 3px;">Date: <strong style="border-bottom: 1.5px solid #1e293b; font-weight: 700; color: #0f172a; padding-bottom: 1px;">${formattedDateStr}</strong></div>
            <div style="margin-top: 3px;">Time: <strong style="border-bottom: 1.5px solid #1e293b; font-weight: 700; color: #0f172a; padding-bottom: 1px;">${timeFormattedStr}</strong></div>
          </div>
        </div>

        <!-- Title -->
        <div class="avoid-break" style="break-inside: avoid; page-break-inside: avoid;">
          <div style="font-size: 14px; font-weight: 800; text-align: center; text-transform: uppercase; letter-spacing: 1px; color: #0f172a; margin: 8px 0 4px 0; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 6px 0;">Fee Collection Report</div>
          <p style="font-size: 9.5px; color: #475569; margin: 0 0 10px 0; line-height: 1.4; font-style: italic;">Official record of slaughter service fees collected from the owner listed below.</p>
        </div>

        <!-- Owner Row -->
        <div class="avoid-break" style="font-size: 10px; margin-bottom: 12px; display: flex; align-items: baseline; gap: 6px; break-inside: avoid; page-break-inside: avoid;">
          <span style="font-weight: 700; color: #475569; white-space: nowrap;">Name & Address of Owner:</span>
          <span style="border-bottom: 1.5px solid #1e293b; flex-grow: 1; font-weight: 700; color: #0f172a; text-transform: uppercase; padding-bottom: 1px;">${owner}</span>
        </div>

        <!-- Fee Table -->
        <table class="fee-table" style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 10px;">
          <thead style="display: table-header-group;">
            <tr style="background: #f8fafc; color: #0f172a; break-inside: avoid; page-break-inside: avoid;">
              <th style="border: 1px solid #1e293b; padding: 5px 6px; text-align: left; font-weight: bold; text-transform: uppercase; font-size: 9px;">Tag No.</th>
              <th style="border: 1px solid #1e293b; padding: 5px 6px; text-align: center; font-weight: bold; text-transform: uppercase; font-size: 9px;">Species</th>
              <th style="border: 1px solid #1e293b; padding: 5px 6px; text-align: left; font-weight: bold; text-transform: uppercase; font-size: 9px;">Fee Name</th>
              <th style="border: 1px solid #1e293b; padding: 5px 6px; text-align: center; font-weight: bold; text-transform: uppercase; font-size: 9px;">Method</th>
              <th style="border: 1px solid #1e293b; padding: 5px 6px; text-align: center; font-weight: bold; text-transform: uppercase; font-size: 9px; width: 70px;">Qty / Wt.</th>
              <th style="border: 1px solid #1e293b; padding: 5px 6px; text-align: right; font-weight: bold; text-transform: uppercase; font-size: 9px; width: 65px;">Rate</th>
              <th style="border: 1px solid #1e293b; padding: 5px 6px; text-align: right; font-weight: bold; text-transform: uppercase; font-size: 9px; width: 85px;">Amount</th>
            </tr>
          </thead>
          <tbody style="display: table-row-group;">
            ${groupRecords
              .map(
                (rec) => `
              <tr style="break-inside: avoid; page-break-inside: avoid;">
                <td style="border: 1px solid #1e293b; padding: 5px 6px; font-family: monospace; color: #dc2626; font-weight: 700; text-align: left;">${rec.tag_number || "—"}</td>
                <td style="border: 1px solid #1e293b; padding: 5px 6px; text-align: center;">${rec.animal_type || rec.species || "Livestock"}</td>
                <td style="border: 1px solid #1e293b; padding: 5px 6px;">${rec.fee_name || "Slaughter Fee"}</td>
                <td style="border: 1px solid #1e293b; padding: 5px 6px; text-align: center;">${rec.method || "Per Head"}</td>
                <td style="border: 1px solid #1e293b; padding: 5px 6px; text-align: center;">${rec.method === "Per Kilo" ? `${rec.weight ?? 0} kg` : `${rec.quantity ?? 1} hd`}</td>
                <td style="border: 1px solid #1e293b; padding: 5px 6px; text-align: right;">${rec.rate ? `₱${Number(rec.rate).toLocaleString()}` : "—"}</td>
                <td style="border: 1px solid #1e293b; padding: 5px 6px; text-align: right; color: #dc2626; font-weight: 700;">₱${Number(rec.amount || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td>
              </tr>
            `
              )
              .join("")}
            <tr style="background: #f1f5f9; font-weight: 700; break-inside: avoid; page-break-inside: avoid;">
              <td colspan="5" style="border: 1px solid #1e293b; padding: 5px 6px; text-align: right;">TOTAL HEADS:</td>
              <td style="border: 1px solid #1e293b; padding: 5px 6px; text-align: center;">${totalHeads}</td>
              <td style="border: 1px solid #1e293b; padding: 5px 6px;"></td>
            </tr>
            <tr style="background: #f1f5f9; font-weight: 800; border-top: 2px solid #1e293b; break-inside: avoid; page-break-inside: avoid;">
              <td colSpan="6" style="border: 1px solid #1e293b; padding: 6px; text-align: right; text-transform: uppercase;">TOTAL AMOUNT:</td>
              <td style="border: 1px solid #1e293b; padding: 6px; text-align: right; color: #dc2626; font-weight: 800; font-size: 11px;">
                ₱${Number(totalAmount).toLocaleString("en-PH", { minimumFractionDigits: 2 })}
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Received By Signature -->
        <div class="fee-received avoid-break" style="text-align: center; margin-top: 14px; break-inside: avoid; page-break-inside: avoid;">
          <div style="font-size: 9.5px; color: #64748b; margin-bottom: 3px;">Received By:</div>
          <div style="font-weight: 800; font-size: 11px; color: #0f172a; text-transform: uppercase; border-bottom: 1.5px solid #0f172a; padding-bottom: 2px; display: inline-block; min-width: 180px;">${owner}</div>
          <div style="font-size: 9px; color: #64748b; margin-top: 3px; font-weight: 600;">Owner</div>
        </div>
      </div>

      <!-- PAGE SEPARATOR / CUT LINE -->
      <div class="fee-page-break" style="border-top: 2px dashed #cbd5e1; margin: 16px 0;"></div>

      <!-- DOCUMENT 2: OFFICIAL RECEIPT COPY -->
      <div class="or-doc avoid-break" style="background: #ffffff; padding: 16px 20px; border: none; break-inside: avoid; page-break-inside: avoid;">
        <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #1e293b; padding-bottom: 8px; margin-bottom: 8px;">
          <img src="/naga_city_seal.png" alt="City of Naga" style="width: 55px; height: 55px; object-fit: contain; border-radius: 50%;" />
          <div style="text-align: center; flex: 1;">
            <p style="margin: 0; font-size: 10px; color: #475569; text-transform: uppercase; letter-spacing: 1px;">Republic of the Philippines</p>
            <p style="margin: 2px 0; font-size: 10px; color: #475569; text-transform: uppercase; letter-spacing: 1px;">Province of Cebu</p>
            <h3 style="margin: 0; font-size: 14px; font-weight: 800; color: #0f172a; letter-spacing: 1px; text-transform: uppercase;">City of Naga</h3>
          </div>
          <img src="/bagong_pilipinas.png" alt="Bagong Pilipinas" style="width: 55px; height: 55px; object-fit: contain; border-radius: 50%;" />
        </div>

        <div style="text-align: right; font-size: 11px; font-weight: 700; color: #64748b; margin: 4px 0 2px 0; font-family: monospace;">Slip No.: FCR-${seqId}</div>
        <div style="display: block; text-align: center; font-size: 13px; font-weight: 900; letter-spacing: 2px; color: #0f172a; margin-bottom: 12px; text-transform: uppercase;">Official Receipt — Owner Copy</div>

        <table style="width: 100%; font-size: 10px; margin-bottom: 12px; border-collapse: collapse;">
          <tbody>
            <tr style="break-inside: avoid; page-break-inside: avoid;">
              <td style="font-weight: 700; color: #475569; text-transform: uppercase; white-space: nowrap; width: 25%; padding: 4px;">Received From</td>
              <td style="padding: 4px;"><span style="border-bottom: 1.5px solid #1e293b; font-weight: 700; color: #0f172a; text-transform: uppercase; display: inline-block; width: 100%; padding-bottom: 1px;">${owner}</span></td>
              <td style="font-weight: 700; color: #475569; text-transform: uppercase; white-space: nowrap; width: 14%; padding: 4px 4px 4px 12px;">Date &amp; Time</td>
              <td style="padding: 4px;"><span style="border-bottom: 1.5px solid #1e293b; font-weight: 700; color: #0f172a; display: inline-block; width: 100%; padding-bottom: 1px;">${formattedDateStr}${timeFormattedStr !== "—" ? ` · ${timeFormattedStr}` : ""}</span></td>
            </tr>
            <tr style="break-inside: avoid; page-break-inside: avoid;">
              <td style="font-weight: 700; color: #475569; text-transform: uppercase; white-space: nowrap; padding: 4px;">No. of Animals</td>
              <td style="padding: 4px;"><span style="border-bottom: 1.5px solid #1e293b; font-weight: 700; color: #0f172a; display: inline-block; width: 100%; padding-bottom: 1px;">${totalHeads} Head(s)</span></td>
              <td style="font-weight: 700; color: #475569; text-transform: uppercase; white-space: nowrap; padding: 4px 4px 4px 12px;">Species</td>
              <td style="padding: 4px;"><span style="border-bottom: 1.5px solid #1e293b; font-weight: 700; color: #0f172a; display: inline-block; width: 100%; padding-bottom: 1px;">${speciesList}</span></td>
            </tr>
            <tr style="break-inside: avoid; page-break-inside: avoid;">
              <td style="font-weight: 700; color: #475569; text-transform: uppercase; white-space: nowrap; padding: 4px;">The Sum of</td>
              <td colSpan="3" style="padding: 4px;"><span style="border-bottom: 1.5px solid #1e293b; font-weight: 900; font-size: 12px; color: #15803d; display: inline-block; width: 100%; padding-bottom: 1px;">₱${Number(totalAmount).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</span></td>
            </tr>
            <tr style="break-inside: avoid; page-break-inside: avoid;">
              <td style="font-weight: 700; color: #475569; text-transform: uppercase; white-space: nowrap; padding: 4px;">For</td>
              <td colSpan="3" style="padding: 4px;"><span style="border-bottom: 1.5px solid #1e293b; font-weight: 700; color: #0f172a; display: inline-block; width: 100%; padding-bottom: 1px;">Slaughterhouse Service Tariffs & Inspection Fees — ${feeNamesList}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  printHtmlViaPopup("Permit Fee Record — Fee Collection Slip & Official Receipt", bodyHtml);
};

/**
 * Print Handler 2: Meat Inspection Permit
 */
export const printMeatPermit = (permit) => {
  if (!permit) return;

  const rawOwner = permit.owner_name || permit.ownerName || "Authorized Owner";
  const owner = rawOwner.includes(" — ") ? rawOwner.split(" — ")[0] : (rawOwner.includes(" - ") ? rawOwner.split(" - ")[0] : rawOwner);
  const rawIssueDate = permit.permit_issued_at || permit.issued_at || permit.date || permit.slaughter_date_time;
  const dateFormatted = rawIssueDate ? formatDate(rawIssueDate) : formatDate(new Date());
  const permitNo = permit.permit_no || permit.permitNo || (permit.receipt_no
    ? "MIC-06-" + String(permit.receipt_no).replace(/\D/g, "").padStart(6, "0").slice(-6)
    : "MIC-06-016246");

  const animals = permit.records || permit.animals || permit.displayAnimals || (permit.tag_number ? [permit] : []);
  const origin = permit.origin || "City of Naga Slaughterhouse Facility";
  const destination = permit.destination || "EAST POBLACION";
  const address = permit.address || "EAST POBLACION";
  const conveyance = permit.conveyance || "Inspected Refrigerated Meat Transport";
  const plateNo = permit.plateNo || "NGA-001";
  // Never substitute a placeholder clock time here: an unissued permit must print an
  // em dash rather than a fabricated issuance time. Callers pass the real
  // Asia/Manila issuance time read from the permit record.
  const timeIssue = permit.timeIssue || permit.displayTime || "—";
  const inspector = permit.inspector || "Dr. Dave";
  const veterinarian = permit.veterinarian || "DR. RAYMUNDO VALENTINE P. PAMIREZ";

  const totalQty = animals.length || permit.totalQuantity || 1;
  const totalWeight = animals.reduce((s, a) => s + (parseFloat(a.total_weight || a.cold_weight || a.weight || 0)), 0) || permit.totalWeight || 0;

  const bodyHtml = `
    <div class="permit-doc printable-permit" style="width: 100%; margin: 0; background: #ffffff; color: #000000; font-family: Arial, sans-serif; padding: 0; box-sizing: border-box; border: none;">
      
      <!-- MEAT INSPECTION CERTIFICATE HEADER -->
      <div class="permit-header-top avoid-break" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000000; padding-bottom: 8px; margin-bottom: 12px; break-inside: avoid; page-break-inside: avoid;">
        <img src="/naga_city_seal.png" alt="City of Naga" style="width: 60px; height: 60px; object-fit: contain; border-radius: 50%;" />
        <div style="text-align: center; flex: 1;">
          <h1 style="font-size: 13px; margin: 0; font-weight: normal; color: #000;">Republic of the Philippines</h1>
          <h2 style="font-size: 12px; margin: 2px 0; font-weight: normal; color: #000;">Province of Cebu</h2>
          <h3 style="font-size: 14px; margin: 0; font-weight: bold; color: #000;">City of Naga</h3>
        </div>
        <img src="/bagong_pilipinas.png" alt="Bagong Pilipinas" style="width: 60px; height: 60px; object-fit: contain; border-radius: 50%;" />
      </div>

      <div class="avoid-break" style="display: flex; justify-content: space-between; align-items: flex-end; margin: 10px 0 15px 0; font-size: 12px; color: #000; break-inside: avoid; page-break-inside: avoid;">
        <div>Slaughterhouse : <span style="border-bottom: 1.5px solid #000; font-weight: bold;">Naga Slaughterhouse</span></div>
        <div style="text-align: right; display: flex; flex-direction: column; gap: 4px;">
          <div>Permit No. : <span style="border-bottom: 1.5px solid #000; font-weight: bold;">${permitNo}</span></div>
          <div>Date of Issue : <span style="border-bottom: 1.5px solid #000; font-weight: bold;">${dateFormatted}</span></div>
        </div>
      </div>

      <div class="avoid-break" style="break-inside: avoid; page-break-inside: avoid;">
        <h2 style="font-size: 16px; font-weight: bold; text-align: center; text-transform: uppercase; margin: 15px 0 10px 0;">MEAT INSPECTION CERTIFICATE</h2>
        <p style="font-size: 11px; line-height: 1.4; color: #000; margin-bottom: 12px; text-align: left;">
          This is to certify that the Meat and / or entrails described below are from animals slaughtered in this abattoir and time to date of inspection they are fit for human consumption.
        </p>
      </div>

      <table class="permit-table" style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 11px;">
        <thead style="display: table-header-group;">
          <tr style="background: #ffffff; break-inside: avoid; page-break-inside: avoid;">
            <th style="border: 1px solid #000; padding: 6px 8px; font-weight: bold; text-align: center; text-transform: uppercase;">Kinds of Meat / Entrails</th>
            <th style="border: 1px solid #000; padding: 6px 8px; font-weight: bold; text-align: center; text-transform: uppercase; width: 120px;">Quantity</th>
            <th style="border: 1px solid #000; padding: 6px 8px; font-weight: bold; text-align: center; text-transform: uppercase; width: 150px;">Weight (kg)</th>
          </tr>
        </thead>
        <tbody style="display: table-row-group;">
          ${
            animals.length > 0
              ? animals
                  .map(
                    (item) => `
              <tr style="break-inside: avoid; page-break-inside: avoid;">
                <td style="border: 1px solid #000; padding: 6px 8px; font-family: monospace; font-weight: bold; color: #dc2626;">${item.tag_number || item.tag_ref || item.species || "Passed Carcass"}</td>
                <td style="border: 1px solid #000; padding: 6px 8px; text-align: center; font-weight: bold; color: #dc2626;">1</td>
                <td style="border: 1px solid #000; padding: 6px 8px; font-family: monospace; text-align: center; font-weight: bold; color: #dc2626;">${item.total_weight || item.cold_weight || item.weight || 0}</td>
              </tr>
            `
                  )
                  .join("")
              : `
              <tr style="break-inside: avoid; page-break-inside: avoid;">
                <td style="border: 1px solid #000; padding: 6px 8px; font-weight: bold;">Verified Inspected Carcass</td>
                <td style="border: 1px solid #000; padding: 6px 8px; text-align: center; font-weight: bold;">1</td>
                <td style="border: 1px solid #000; padding: 6px 8px; text-align: center; font-weight: bold;">Pass</td>
              </tr>
            `
          }
          <tr style="font-weight: bold; background: #ffffff; break-inside: avoid; page-break-inside: avoid;">
            <td style="border: 1px solid #000; padding: 6px 8px;">TOTAL QUANTITY</td>
            <td style="border: 1px solid #000; padding: 6px 8px; text-align: center;">${totalQty}</td>
            <td style="border: 1px solid #000; padding: 6px 8px;"></td>
          </tr>
          <tr style="font-weight: bold; background: #ffffff; break-inside: avoid; page-break-inside: avoid;">
            <td style="border: 1px solid #000; padding: 6px 8px;">TOTAL CARCASS WEIGHT</td>
            <td style="border: 1px solid #000; padding: 6px 8px;"></td>
            <td style="border: 1px solid #000; padding: 6px 8px; text-align: center;">${totalWeight} kg</td>
          </tr>
        </tbody>
      </table>

      <div class="permit-details-grid avoid-break" style="display: grid; grid-template-columns: 1.1fr 1fr; column-gap: 24px; row-gap: 8px; font-size: 11px; margin: 16px 0 20px 0; color: #000; font-family: Arial, sans-serif; break-inside: avoid; page-break-inside: avoid;">
        <div style="grid-column: 1 / -1; display: flex; align-items: baseline;">
          <span style="font-weight: bold; color: #334155; white-space: nowrap; margin-right: 6px;">Name and Address of Owner:</span>
          <span style="border-bottom: 1.5px solid #000; flex: 1; padding-left: 6px; font-weight: bold; color: #dc2626; text-transform: uppercase;">${owner}</span>
        </div>
        <div style="display: flex; align-items: baseline;">
          <span style="font-weight: bold; color: #334155; white-space: nowrap; margin-right: 6px;">Point of Origin:</span>
          <span style="border-bottom: 1.5px solid #000; flex: 1; padding-left: 6px; font-weight: bold; color: #000;">${origin}</span>
        </div>
        <div style="display: flex; align-items: baseline;">
          <span style="font-weight: bold; color: #334155; white-space: nowrap; margin-right: 6px;">Time Issue:</span>
          <span style="border-bottom: 1.5px solid #000; flex: 1; padding-left: 6px; font-weight: bold; color: #000;">${timeIssue}</span>
        </div>
        <div style="display: flex; align-items: baseline;">
          <span style="font-weight: bold; color: #334155; white-space: nowrap; margin-right: 6px;">Destination:</span>
          <span style="border-bottom: 1.5px solid #000; flex: 1; padding-left: 6px; font-weight: bold; color: #000;">${destination}</span>
        </div>
        <div style="display: flex; align-items: baseline;">
          <span style="font-weight: bold; color: #334155; white-space: nowrap; margin-right: 6px;">Address:</span>
          <span style="border-bottom: 1.5px solid #000; flex: 1; padding-left: 6px; font-weight: bold; color: #000;">${address}</span>
        </div>
        <div style="display: flex; align-items: baseline;">
          <span style="font-weight: bold; color: #334155; white-space: nowrap; margin-right: 6px;">Conveyance Used:</span>
          <span style="border-bottom: 1.5px solid #000; flex: 1; padding-left: 6px; font-weight: bold; color: #000;">${conveyance}</span>
        </div>
      </div>

      <div class="permit-signatures-naga avoid-break" style="display: flex; justify-content: space-between; margin-top: 24px; font-size: 11px; text-align: center; break-inside: avoid; page-break-inside: avoid;">
        <div style="width: 42%;">
          <div style="font-weight: bold; font-size: 12px; text-transform: uppercase; color: #dc2626;">${owner}</div>
          <div style="border-top: 1px solid #000; margin-top: 4px; padding-top: 4px; font-size: 10px; font-weight: bold;">Owner</div>
        </div>
        <div style="width: 42%;">
          <div style="font-weight: bold; font-size: 12px; text-transform: uppercase;">${inspector}</div>
          <div style="border-top: 1px solid #000; margin-top: 4px; padding-top: 4px; font-size: 10px; font-weight: bold;">Meat Inspector III</div>
        </div>
      </div>

      <div class="permit-received-by avoid-break" style="text-align: center; margin-top: 20px; font-size: 11px; break-inside: avoid; page-break-inside: avoid;">
        <div style="border-bottom: 1.5px solid #000; font-weight: bold; font-size: 13px; display: inline-block; padding-bottom: 2px; width: 260px; text-transform: uppercase;">${veterinarian}</div>
        <div style="font-size: 10px; margin-top: 4px; font-weight: bold;">CITY VETERINARIAN</div>
      </div>

      <!-- GATE PASS SECTION -->
      <div class="gate-pass-section avoid-break" style="margin-top: 24px; padding-top: 16px; border-top: 1.5px dashed #000; break-inside: avoid; page-break-inside: avoid;">
        <h2 style="text-align: center; font-size: 16px; font-weight: bold; letter-spacing: 4px; margin: 0 0 14px 0; color: #000; text-transform: uppercase;">
          G A T E &nbsp; P A S S
        </h2>
        
        <table class="gate-pass-header-table" style="width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 11px;">
          <tbody>
            <tr style="break-inside: avoid; page-break-inside: avoid;">
              <td style="font-weight: bold; width: 110px; padding: 4px 0; text-transform: uppercase;">NAME :</td>
              <td style="padding: 4px 16px 4px 0;"><span style="border-bottom: 1.5px solid #000; font-weight: bold; text-transform: uppercase; display: inline-block; width: 100%;">${owner}</span></td>
              <td style="font-weight: bold; width: 65px; padding: 4px 0; text-transform: uppercase;">DATE :</td>
              <td style="padding: 4px;"><span style="border-bottom: 1.5px solid #000; font-weight: bold; text-transform: uppercase; display: inline-block; width: 100%;">${dateFormatted}</span></td>
            </tr>
            <tr style="break-inside: avoid; page-break-inside: avoid;">
              <td style="font-weight: bold; width: 110px; padding: 4px 0; text-transform: uppercase;">DESTINATION :</td>
              <td style="padding: 4px 16px 4px 0;"><span style="border-bottom: 1.5px solid #000; font-weight: bold; text-transform: uppercase; display: inline-block; width: 100%;">${destination}</span></td>
              <td style="font-weight: bold; width: 65px; padding: 4px 0; text-transform: uppercase;">TIME :</td>
              <td style="padding: 4px;"><span style="border-bottom: 1.5px solid #000; font-weight: bold; text-transform: uppercase; display: inline-block; width: 100%;">${timeIssue}</span></td>
            </tr>
          </tbody>
        </table>

        <table class="gate-pass-table" style="width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px;">
          <thead style="display: table-header-group;">
            <tr style="background: #ffffff; break-inside: avoid; page-break-inside: avoid;">
              <th style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: left; text-transform: uppercase;">KINDS OF MEAT / ENTRAILS</th>
              <th style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center; text-transform: uppercase; width: 110px;">QUANTITY</th>
              <th style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center; text-transform: uppercase; width: 140px;">WEIGHT</th>
            </tr>
          </thead>
          <tbody style="display: table-row-group;">
            <tr style="break-inside: avoid; page-break-inside: avoid;">
              <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-transform: uppercase;">CARCASS</td>
              <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center;">${totalQty}</td>
              <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center;">${totalWeight > 0 ? `${totalWeight} kg` : ""}</td>
            </tr>
            <tr style="break-inside: avoid; page-break-inside: avoid;">
              <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-transform: uppercase;">LIVER</td>
              <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center;">${totalQty}</td>
              <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center;"></td>
            </tr>
            <tr style="break-inside: avoid; page-break-inside: avoid;">
              <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-transform: uppercase;">INTESTINE</td>
              <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center;">${totalQty}</td>
              <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center;"></td>
            </tr>
            <tr style="break-inside: avoid; page-break-inside: avoid;">
              <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-transform: uppercase;">BLOOD</td>
              <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center;">${totalQty}</td>
              <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center;"></td>
            </tr>
          </tbody>
        </table>

        <div class="gp-auth avoid-break" style="display: flex; align-items: baseline; gap: 8px; margin-top: 16px; break-inside: avoid; page-break-inside: avoid;">
          <div style="font-size: 11px; font-weight: bold; color: #000; white-space: nowrap;">Authorized By:</div>
          <div style="text-align: center; display: inline-block;">
            <div style="border-bottom: 1.5px solid #000; font-weight: bold; font-size: 12px; text-transform: uppercase; padding-bottom: 2px; min-width: 260px;">
              ${veterinarian}
            </div>
            <div style="font-size: 9.5px; font-weight: bold; margin-top: 3px; text-transform: uppercase; color: #475569;">
              CITY VETERINARIAN
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  printHtmlViaPopup("Official Meat Inspection Certificate & Permit", bodyHtml);
};

/**
 * Print Handler 3: Abattoir Gate Pass
 */
export const printGatePass = (dispatch) => {
  if (!dispatch) return;
  const owner = dispatch.owner_name || dispatch.ownerName || "Authorized Owner";
  const dateFormatted = dispatch.date ? formatDate(dispatch.date) : formatDate(new Date());
  const destination = dispatch.destination || "EAST POBLACION";
  const timeIssue = dispatch.timeIssue || dispatch.displayTime || (dispatch.released_at || dispatch.dispatched_at || dispatch.created_at ? formatPhTime(dispatch.released_at || dispatch.dispatched_at || dispatch.created_at) : "—");
  const veterinarian = dispatch.veterinarian || "DR. RAYMUNDO VALENTINE P. PAMIREZ";

  const totalQty = dispatch.quantity || dispatch.totalQuantity || dispatch.carcasses?.length || 1;
  const totalWeight = dispatch.totalWeight || dispatch.carcass_weight || 0;

  const bodyHtml = `
    <div class="gp-doc printable-permit" style="width: 100%; margin: 0; background: #ffffff; color: #000000; font-family: Arial, sans-serif; padding: 0; box-sizing: border-box; border: none;">
      <h2 class="avoid-break" style="text-align: center; font-size: 16px; font-weight: bold; letter-spacing: 4px; margin: 0 0 14px 0; color: #000; text-transform: uppercase; break-inside: avoid; page-break-inside: avoid;">
        G A T E &nbsp; P A S S
      </h2>
      
      <table class="gate-pass-header-table avoid-break" style="width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 11px; break-inside: avoid; page-break-inside: avoid;">
        <tbody>
          <tr style="break-inside: avoid; page-break-inside: avoid;">
            <td style="font-weight: bold; width: 110px; padding: 4px 0; text-transform: uppercase;">NAME :</td>
            <td style="padding: 4px 16px 4px 0;"><span style="border-bottom: 1.5px solid #000; font-weight: bold; text-transform: uppercase; display: inline-block; width: 100%;">${owner}</span></td>
            <td style="font-weight: bold; width: 65px; padding: 4px 0; text-transform: uppercase;">DATE :</td>
            <td style="padding: 4px;"><span style="border-bottom: 1.5px solid #000; font-weight: bold; text-transform: uppercase; display: inline-block; width: 100%;">${dateFormatted}</span></td>
          </tr>
          <tr style="break-inside: avoid; page-break-inside: avoid;">
            <td style="font-weight: bold; width: 110px; padding: 4px 0; text-transform: uppercase;">DESTINATION :</td>
            <td style="padding: 4px 16px 4px 0;"><span style="border-bottom: 1.5px solid #000; font-weight: bold; text-transform: uppercase; display: inline-block; width: 100%;">${destination}</span></td>
            <td style="font-weight: bold; width: 65px; padding: 4px 0; text-transform: uppercase;">TIME :</td>
            <td style="padding: 4px;"><span style="border-bottom: 1.5px solid #000; font-weight: bold; text-transform: uppercase; display: inline-block; width: 100%;">${timeIssue}</span></td>
          </tr>
        </tbody>
      </table>

      <table class="gate-pass-table" style="width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px;">
        <thead style="display: table-header-group;">
          <tr style="background: #ffffff; break-inside: avoid; page-break-inside: avoid;">
            <th style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: left; text-transform: uppercase;">KINDS OF MEAT / ENTRAILS</th>
            <th style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center; text-transform: uppercase; width: 110px;">QUANTITY</th>
            <th style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center; text-transform: uppercase; width: 140px;">WEIGHT</th>
          </tr>
        </thead>
        <tbody style="display: table-row-group;">
          <tr style="break-inside: avoid; page-break-inside: avoid;">
            <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-transform: uppercase;">CARCASS</td>
            <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center;">${totalQty}</td>
            <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center;">${totalWeight > 0 ? `${totalWeight} kg` : ""}</td>
          </tr>
          <tr style="break-inside: avoid; page-break-inside: avoid;">
            <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-transform: uppercase;">LIVER</td>
            <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center;">${totalQty}</td>
            <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center;"></td>
          </tr>
          <tr style="break-inside: avoid; page-break-inside: avoid;">
            <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-transform: uppercase;">INTESTINE</td>
            <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center;">${totalQty}</td>
            <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center;"></td>
          </tr>
          <tr style="break-inside: avoid; page-break-inside: avoid;">
            <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-transform: uppercase;">BLOOD</td>
            <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center;">${totalQty}</td>
            <td style="border: 1.5px solid #000; padding: 6px 10px; font-weight: bold; text-align: center;"></td>
          </tr>
        </tbody>
      </table>

      <div class="gp-auth avoid-break" style="display: flex; align-items: baseline; gap: 8px; margin-top: 16px; break-inside: avoid; page-break-inside: avoid;">
        <div style="font-size: 11px; font-weight: bold; color: #000; white-space: nowrap;">Authorized By:</div>
        <div style="text-align: center; display: inline-block;">
          <div style="border-bottom: 1.5px solid #000; font-weight: bold; font-size: 12px; text-transform: uppercase; padding-bottom: 2px; min-width: 260px;">
            ${veterinarian}
          </div>
          <div style="font-size: 9.5px; font-weight: bold; margin-top: 3px; text-transform: uppercase; color: #475569;">
            CITY VETERINARIAN
          </div>
        </div>
      </div>
    </div>
  `;

  printHtmlViaPopup("Abattoir Meat Dispatch Gate Pass", bodyHtml);
};
