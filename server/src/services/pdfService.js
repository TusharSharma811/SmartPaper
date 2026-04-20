import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { aggregateBlooms, aggregateCOs, BLOOM_LEVELS } from "../utils/analysisUtils.js";
import logger from "../utils/logger.js";

// ── PDF Service ──────────────────────────────────────────────────
const PDF_DIR = path.resolve(process.env.PDF_STORAGE_PATH || "./pdfs");

/**
 * Ensure the PDF output directory exists at startup.
 */
const ensurePDFDir = () => {
  if (!fs.existsSync(PDF_DIR)) {
    fs.mkdirSync(PDF_DIR, { recursive: true });
    logger.info(`Created PDF directory: ${PDF_DIR}`);
  }
};

/**
 * Render a single question's HTML based on its type.
 */
const renderQuestion = (q) => {
  let html = "";

  if (q.type === "single" && q.subquestions?.length > 0) {
    // Single question — use the first subquestion text
    const sq = q.subquestions[0];
    html += `<div class="question">
      <div class="q-header">
        <span class="q-num">Q${q.question_id}.</span>
        <span class="q-text">${sq.text}</span>
        <span class="marks">[${q.marks} Marks]</span>
      </div>
      <div class="q-meta">
        ${sq.bloom_level ? `<span class="tag bloom">${sq.bloom_level}</span>` : ""}
        ${sq.co ? `<span class="tag co">CO${sq.co}</span>` : ""}
      </div>
    </div>`;
  } else if (q.type === "subparts" && q.subquestions?.length > 0) {
    // Question with sub-parts
    html += `<div class="question">
      <div class="q-header">
        <span class="q-num">Q${q.question_id}.</span>
        <span class="marks">[${q.marks} Marks]</span>
      </div>
      <ol class="subparts" type="a">`;
    for (const sq of q.subquestions) {
      html += `<li>
        <span class="q-text">${sq.text}</span>
        <span class="marks">[${sq.marks} Marks]</span>
        ${sq.bloom_level ? `<span class="tag bloom">${sq.bloom_level}</span>` : ""}
        ${sq.co ? `<span class="tag co">CO${sq.co}</span>` : ""}
      </li>`;
    }
    html += `</ol></div>`;
  } else if (q.type === "choice_group") {
    // Question with OR choices
    html += `<div class="question">
      <div class="q-header">
        <span class="q-num">Q${q.question_id}.</span>
        <span class="marks">[${q.marks} Marks]</span>
      </div>`;

    if (q.subquestions?.length > 0) {
      html += `<div class="choice-label">Answer the following:</div>
      <ol class="subparts" type="a">`;
      for (const sq of q.subquestions) {
        html += `<li>
          <span class="q-text">${sq.text}</span>
          <span class="marks">[${sq.marks} Marks]</span>
        </li>`;
      }
      html += `</ol>`;
    }

    if (q.options?.length > 0) {
      html += `<div class="choice-label">OR</div>
      <ol class="subparts" type="a">`;
      for (const opt of q.options) {
        html += `<li>
          <span class="q-text">${opt.text}</span>
          <span class="marks">[${opt.marks} Marks]</span>
        </li>`;
      }
      html += `</ol>`;
    }
    html += `</div>`;
  }

  return html;
};

/**
 * Build the analysis charts HTML for the PDF (pure HTML/CSS bars — no JS canvas).
 */
const BLOOM_BAR_COLORS = {
  K1: "#14b8a6", K2: "#3b82f6", K3: "#6366f1",
  K4: "#f59e0b", K5: "#f97316", K6: "#ef4444",
  Unknown: "#94a3b8",
};

const CO_BAR_COLORS = [
  "#6366f1", "#8b5cf6", "#a855f7", "#ec4899",
  "#f472b6", "#fb923c", "#facc15", "#34d399",
];

const buildChartsHTML = (paper) => {
  const bloomsData = aggregateBlooms(paper);
  const coData = aggregateCOs(paper);

  const totalBlooms = Object.values(bloomsData).reduce((s, v) => s + v, 0);
  const totalCOs = Object.values(coData).reduce((s, v) => s + v, 0);

  if (totalBlooms === 0 && totalCOs === 0) return "";

  const maxBloom = Math.max(...Object.values(bloomsData), 1);
  const maxCO = Math.max(...Object.values(coData), 1);

  // Bloom's horizontal bar rows
  let bloomBars = "";
  for (const [key, val] of Object.entries(bloomsData)) {
    const pct = totalBlooms ? Math.round((val / totalBlooms) * 100) : 0;
    const widthPct = Math.max((val / maxBloom) * 100, val > 0 ? 8 : 0);
    const color = BLOOM_BAR_COLORS[key] || BLOOM_BAR_COLORS.Unknown;
    bloomBars += `
      <div class="bar-row">
        <div class="bar-label">${key}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${widthPct}%;background:${color};">${val > 0 ? val : ""}</div>
        </div>
        <div class="bar-value">${val}m (${pct}%)</div>
      </div>`;
  }

  // CO horizontal bar rows
  let coBars = "";
  const coKeys = Object.keys(coData);
  coKeys.forEach((key, idx) => {
    const val = coData[key];
    const pct = totalCOs ? Math.round((val / totalCOs) * 100) : 0;
    const widthPct = Math.max((val / maxCO) * 100, val > 0 ? 8 : 0);
    const color = CO_BAR_COLORS[idx % CO_BAR_COLORS.length];
    coBars += `
      <div class="bar-row">
        <div class="bar-label">${key}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${widthPct}%;background:${color};">${val > 0 ? val : ""}</div>
        </div>
        <div class="bar-value">${val}m (${pct}%)</div>
      </div>`;
  });

  // Bloom's legend
  let bloomLegend = "";
  for (const k of BLOOM_LEVELS) {
    const labels = { K1: "Remember", K2: "Understand", K3: "Apply", K4: "Analyze", K5: "Evaluate", K6: "Create" };
    bloomLegend += `<div class="legend-item"><div class="legend-color" style="background:${BLOOM_BAR_COLORS[k]};"></div>${k} – ${labels[k]}</div>`;
  }

  // Summary table
  let summaryRows = "";
  for (const [key, val] of Object.entries(bloomsData)) {
    const pct = totalBlooms ? Math.round((val / totalBlooms) * 100) : 0;
    summaryRows += `<tr><td>${key}</td><td>${val}</td><td>${pct}%</td></tr>`;
  }
  let coSummaryRows = "";
  for (const [key, val] of Object.entries(coData)) {
    const pct = totalCOs ? Math.round((val / totalCOs) * 100) : 0;
    coSummaryRows += `<tr><td>${key}</td><td>${val}</td><td>${pct}%</td></tr>`;
  }

  return `
  <div class="analysis-page">
    <h2>Question Paper Analysis</h2>
    <div class="charts-container">
      <div class="chart-box">
        <h3>Bloom's Taxonomy Distribution (K1–K6)</h3>
        <div class="bar-chart">${bloomBars}</div>
        <div style="margin-top:12px;">${bloomLegend}</div>
      </div>
      <div class="chart-box">
        <h3>Course Outcome Distribution</h3>
        <div class="bar-chart">${coBars}</div>
      </div>
    </div>
    <table class="summary-table" style="margin-top:24px;">
      <tr><th colspan="3" style="text-align:center;">Bloom's Taxonomy Summary</th></tr>
      <tr><th>Level</th><th>Marks</th><th>%</th></tr>
      ${summaryRows}
      <tr><td colspan="3" style="height:10px;border:none;"></td></tr>
      <tr><th colspan="3" style="text-align:center;">Course Outcome Summary</th></tr>
      <tr><th>CO</th><th>Marks</th><th>%</th></tr>
      ${coSummaryRows}
    </table>
  </div>`;
};

/**
 * Build an HTML string from the question paper data (rich format).
 */
const buildHTML = (paper) => {
  const meta = paper.metadata || {};
  const collegeName = process.env.COLLEGE_NAME || "GL Bajaj Institute of Technology and Management";
  const examName = meta.exam || "Examination";
  const subjectName = meta.subject || "N/A";
  const subjectCode = meta.subject_code || "";
  const duration = meta.duration || "3 Hours";
  const maxMarks = meta.max_marks || 0;

  // Render instructions
  const instructionsList = (paper.instructions || [])
    .map((inst) => `<li>${inst}</li>`)
    .join("");
  const instructionsHTML = instructionsList
    ? `<div class="instructions"><strong>Instructions:</strong><ol>${instructionsList}</ol></div>`
    : "";

  // Render sections
  let sectionsHTML = "";
  const sections = paper.sections || [];

  for (const section of sections) {
    sectionsHTML += `<div class="section">
      <h2>Section ${section.section_id} — ${section.title}</h2>`;

    if (section.description) {
      sectionsHTML += `<p class="section-desc">${section.description}</p>`;
    }
    if (section.marks_scheme || section.attempt_rule) {
      sectionsHTML += `<p class="section-info">`;
      if (section.marks_scheme) sectionsHTML += `<em>${section.marks_scheme}</em>`;
      if (section.marks_scheme && section.attempt_rule) sectionsHTML += ` | `;
      if (section.attempt_rule) sectionsHTML += `<em>${section.attempt_rule}</em>`;
      sectionsHTML += `</p>`;
    }

    for (const q of section.questions || []) {
      sectionsHTML += renderQuestion(q);
    }

    sectionsHTML += `</div>`;
  }

  // Build analysis charts HTML
  const chartsHTML = buildChartsHTML(paper);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 13px;
      padding: 40px 50px;
      color: #000;
    }
    .header {
      text-align: center;
      margin-bottom: 20px;
      border-bottom: 2px solid #000;
      padding-bottom: 12px;
    }
    .header h1 { font-size: 20px; margin-bottom: 4px; }
    .header h2 { font-size: 16px; font-weight: normal; margin-bottom: 4px; }
    .header h3 { font-size: 14px; font-weight: normal; color: #333; }
    .meta {
      display: flex;
      justify-content: space-between;
      margin-bottom: 14px;
      font-size: 13px;
    }
    .meta div { line-height: 1.6; }
    .instructions {
      margin-bottom: 18px;
      padding: 8px 12px;
      border: 1px solid #ccc;
      background: #f9f9f9;
      font-size: 12px;
    }
    .instructions ol { padding-left: 20px; margin-top: 4px; }
    .instructions li { margin-bottom: 2px; }
    .section { margin-bottom: 22px; }
    .section h2 {
      font-size: 15px;
      margin-bottom: 6px;
      text-decoration: underline;
    }
    .section-desc { font-size: 12px; color: #444; margin-bottom: 4px; }
    .section-info { font-size: 12px; color: #555; margin-bottom: 10px; }
    .question { margin-bottom: 12px; padding-left: 4px; }
    .q-header { display: flex; align-items: baseline; gap: 6px; margin-bottom: 2px; }
    .q-num { font-weight: bold; min-width: 32px; }
    .q-text { flex: 1; line-height: 1.5; }
    .marks { font-weight: bold; font-size: 12px; color: #333; white-space: nowrap; }
    .q-meta { margin-left: 32px; margin-top: 2px; }
    .tag {
      display: inline-block;
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 3px;
      margin-right: 4px;
    }
    .bloom { background: #e3f2fd; color: #1565c0; }
    .co { background: #e8f5e9; color: #2e7d32; }
    .subparts { padding-left: 42px; margin-top: 4px; }
    .subparts li { margin-bottom: 6px; line-height: 1.5; }
    .choice-label {
      margin: 8px 0 4px 32px;
      font-weight: bold;
      font-style: italic;
      color: #555;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      font-size: 10px;
      color: #666;
      border-top: 1px solid #ccc;
      padding-top: 8px;
    }
    /* ── Chart Styles (PDF) ──────────────────────── */
    .analysis-page {
      page-break-before: always;
      padding-top: 20px;
      font-family: 'Segoe UI', Arial, sans-serif;
    }
    .analysis-page h2 {
      font-size: 18px;
      text-align: center;
      margin-bottom: 24px;
      color: #1e293b;
      font-weight: 700;
    }
    .charts-container {
      display: flex;
      gap: 32px;
      justify-content: center;
      flex-wrap: wrap;
    }
    .chart-box {
      flex: 1;
      min-width: 280px;
      max-width: 380px;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 20px;
      background: #fafbfc;
    }
    .chart-box h3 {
      text-align: center;
      font-size: 13px;
      font-weight: 700;
      color: #334155;
      margin-bottom: 16px;
    }
    .bar-chart { width: 100%; }
    .bar-row {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .bar-label {
      width: 70px;
      font-weight: 600;
      color: #475569;
      text-align: right;
      padding-right: 10px;
    }
    .bar-track {
      flex: 1;
      height: 22px;
      background: #f1f5f9;
      border-radius: 6px;
      overflow: hidden;
      position: relative;
    }
    .bar-fill {
      height: 100%;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 6px;
      font-size: 10px;
      font-weight: 700;
      color: #fff;
      min-width: 28px;
    }
    .bar-value {
      width: 50px;
      text-align: right;
      font-size: 11px;
      color: #64748b;
      padding-left: 8px;
    }
    .legend-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: center;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      color: #475569;
    }
    .legend-color {
      width: 10px;
      height: 10px;
      border-radius: 3px;
    }
    .summary-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
      font-size: 11px;
    }
    .summary-table th {
      background: #f1f5f9;
      padding: 6px 10px;
      text-align: left;
      font-weight: 600;
      color: #334155;
      border-bottom: 2px solid #e2e8f0;
    }
    .summary-table td {
      padding: 5px 10px;
      border-bottom: 1px solid #f1f5f9;
      color: #475569;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${collegeName}</h1>
    <h2>${examName}</h2>
    ${subjectCode ? `<h3>${subjectCode}</h3>` : ""}
  </div>

  <div class="meta">
    <div>
      <strong>Subject:</strong> ${subjectName}<br/>
      ${subjectCode ? `<strong>Code:</strong> ${subjectCode}<br/>` : ""}
    </div>
    <div>
      <strong>Max Marks:</strong> ${maxMarks}<br/>
      <strong>Duration:</strong> ${duration}
    </div>
  </div>

  ${instructionsHTML}

  ${sectionsHTML}

  <div class="footer">
    Generated on ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
    &bull; AI Question Paper Generator
  </div>

  ${chartsHTML}

</body>
</html>`;
};

/**
 * Generate a PDF file for the given question paper document.
 */
const generatePDF = async (paper) => {
  ensurePDFDir();

  const safeId = path.basename(paper._id.toString());
  const filePath = path.join(PDF_DIR, `${safeId}.pdf`);

  const html = buildHTML(paper);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({
      path: filePath,
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });
    logger.info(`PDF generated: ${filePath}`);
  } finally {
    await browser.close();
  }

  return filePath;
};

/**
 * Resolve the full file-system path for a paper's PDF.
 */
const getPDFPath = (paperId) => {
  const sanitized = path.basename(paperId);
  const filePath = path.join(PDF_DIR, `${sanitized}.pdf`);

  if (!filePath.startsWith(PDF_DIR)) {
    throw new Error("Invalid file path");
  }
  return filePath;
};

export { generatePDF, getPDFPath, ensurePDFDir };
