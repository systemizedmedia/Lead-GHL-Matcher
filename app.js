let metaData = null;
let ghlData = null;
let metaDetected = null;
let ghlDetected = null;
let latestReviewRows = [];
let latestFullRows = [];

const metaFileInput = document.getElementById("metaFile");
const ghlFileInput = document.getElementById("ghlFile");
const runButton = document.getElementById("runButton");
const statusBox = document.getElementById("status");
const nameThresholdInput = document.getElementById("nameThreshold");
const thresholdValue = document.getElementById("thresholdValue");

const mappingSection = document.getElementById("mappingSection");
const mappingTable = document.getElementById("mappingTable");
const overrideSection = document.getElementById("overrideSection");
const applyOverrideButton = document.getElementById("applyOverrideButton");

const resultsSection = document.getElementById("resultsSection");
const totalMeta = document.getElementById("totalMeta");
const totalReview = document.getElementById("totalReview");
const totalMatched = document.getElementById("totalMatched");
const reviewTable = document.getElementById("reviewTable");

const downloadReviewButton = document.getElementById("downloadReviewButton");
const downloadFullButton = document.getElementById("downloadFullButton");

nameThresholdInput.addEventListener("input", () => {
  thresholdValue.textContent = nameThresholdInput.value;
});

metaFileInput.addEventListener("change", async () => {
  metaData = await readCsvFile(metaFileInput.files[0]);
  updateRunButton();
});

ghlFileInput.addEventListener("change", async () => {
  ghlData = await readCsvFile(ghlFileInput.files[0]);
  updateRunButton();
});

runButton.addEventListener("click", () => {
  runMatcher(false);
});

applyOverrideButton.addEventListener("click", () => {
  applyOverrides();
  runMatcher(true);
});

downloadReviewButton.addEventListener("click", () => {
  downloadCsv("meta_ghl_leads_needing_manual_review.csv", latestReviewRows);
});

downloadFullButton.addEventListener("click", () => {
  downloadCsv("meta_ghl_full_match_report.csv", latestFullRows);
});

function updateRunButton() {
  runButton.disabled = !(metaData && ghlData);
}

async function readCsvFile(file) {
  if (!file) return null;
  const text = await file.text();
  return parseCsv(text);
}

/**
 * Lightweight CSV parser that supports:
 * - quoted fields
 * - commas inside quotes
 * - escaped quotes
 * - CRLF and LF line endings
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      field += '"';
      i++;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const cleanRows = rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
  const headers = cleanRows[0].map((h) => String(h).trim());

  const data = cleanRows.slice(1).map((values, index) => {
    const obj = { _source_row: index + 2 };
    headers.forEach((header, i) => {
      obj[header] = values[i] ?? "";
    });
    return obj;
  });

  return { headers, rows: data };
}

function normalizeColumnText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameSimilarity(a, b) {
  const s1 = normalizeName(a);
  const s2 = normalizeName(b);

  if (!s1 || !s2) return 0;

  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) return 100;

  return Math.round(((longer.length - editDistance(longer, shorter)) / longer.length) * 1000) / 10;
}

function editDistance(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, () => []);

  for (let i = 0; i <= b.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function sampleValues(data, column, limit = 100) {
  return data.rows
    .map((row) => row[column])
    .filter((value) => String(value || "").trim() !== "")
    .slice(0, limit);
}

function valueEmailScore(data, column) {
  const values = sampleValues(data, column);
  if (!values.length) return 0;
  const matches = values.filter((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(String(v).trim()));
  return Math.round((matches.length / values.length) * 100);
}

function valuePhoneScore(data, column) {
  const values = sampleValues(data, column);
  if (!values.length) return 0;
  const matches = values.filter((v) => {
    const len = String(v).replace(/\D/g, "").length;
    return len >= 7 && len <= 15;
  });
  return Math.round((matches.length / values.length) * 100);
}

function valueNameScore(data, column) {
  const values = sampleValues(data, column);
  if (!values.length) return 0;

  const matches = values.filter((v) => {
    const text = String(v).trim();
    if (!text || text.includes("@")) return false;

    const digits = (text.match(/\d/g) || []).length;
    const letters = (text.match(/[A-Za-z]/g) || []).length;
    const words = text.match(/[A-Za-z]+/g) || [];

    return letters >= 2 && digits === 0 && words.length >= 1 && words.length <= 5;
  });

  return Math.round((matches.length / values.length) * 100);
}

function scoreColumnByName(column, fieldType) {
  const colNorm = normalizeColumnText(column);
  const compact = colNorm.replace(/\s/g, "");

  const terms = {
    email: [
      "email",
      "email address",
      "e mail",
      "customer email",
      "contact email",
      "lead email",
      "your email",
      "business email"
    ],
    phone: [
      "phone",
      "phone number",
      "mobile",
      "mobile number",
      "cell",
      "cell phone",
      "contact phone",
      "customer phone",
      "lead phone",
      "your phone",
      "number"
    ],
    full_name: [
      "name",
      "full name",
      "fullname",
      "contact name",
      "customer name",
      "lead name",
      "your name",
      "client name"
    ],
    first_name: [
      "first name",
      "firstname",
      "first",
      "given name"
    ],
    last_name: [
      "last name",
      "lastname",
      "last",
      "surname",
      "family name"
    ]
  }[fieldType] || [];

  let score = 0;

  terms.forEach((term) => {
    const termNorm = normalizeColumnText(term);
    const termCompact = termNorm.replace(/\s/g, "");

    if (colNorm === termNorm || compact === termCompact) {
      score = Math.max(score, 100);
    } else if (colNorm.includes(termNorm) || compact.includes(termCompact)) {
      score = Math.max(score, 85);
    } else if (termNorm.split(" ").some((part) => colNorm.split(" ").includes(part))) {
      score = Math.max(score, 45);
    }
  });

  if (fieldType === "phone" && colNorm.split(" ").includes("id")) score -= 30;
  if (fieldType === "full_name" && ["campaign name", "ad name", "form name"].some((bad) => colNorm.includes(bad))) {
    score -= 80;
  }

  return Math.max(score, 0);
}

function autoDetectField(data, fieldType) {
  let bestColumn = null;
  let bestScore = -1;
  const details = [];

  data.headers.forEach((column) => {
    const nameScore = scoreColumnByName(column, fieldType);
    let valueScore = 0;
    let total = 0;

    if (fieldType === "email") {
      valueScore = valueEmailScore(data, column);
      total = nameScore * 0.65 + valueScore * 0.35;
    } else if (fieldType === "phone") {
      valueScore = valuePhoneScore(data, column);
      total = nameScore * 0.65 + valueScore * 0.35;
    } else {
      valueScore = valueNameScore(data, column);
      total = nameScore * 0.75 + valueScore * 0.25;
    }

    details.push({
      column,
      field_type: fieldType,
      name_score: Math.round(nameScore * 10) / 10,
      value_score: Math.round(valueScore * 10) / 10,
      total_score: Math.round(total * 10) / 10
    });

    if (total > bestScore) {
      bestScore = total;
      bestColumn = column;
    }
  });

  const minimum = fieldType === "email" || fieldType === "phone" ? 35 : 30;

  details.sort((a, b) => b.total_score - a.total_score);

  if (bestScore < minimum) {
    return { column: null, score: Math.round(bestScore * 10) / 10, details };
  }

  return { column: bestColumn, score: Math.round(bestScore * 10) / 10, details };
}

function autoDetectColumns(data) {
  const email = autoDetectField(data, "email");
  const phone = autoDetectField(data, "phone");
  const fullName = autoDetectField(data, "full_name");
  const firstName = autoDetectField(data, "first_name");
  const lastName = autoDetectField(data, "last_name");

  const useSplitName = firstName.column && lastName.column && firstName.column !== lastName.column;

  return {
    email_col: email.column,
    phone_col: phone.column,
    full_name_col: useSplitName ? null : fullName.column,
    first_name_col: useSplitName ? firstName.column : null,
    last_name_col: useSplitName ? lastName.column : null,
    confidence: {
      email: email.score,
      phone: phone.score,
      full_name: fullName.score,
      first_name: firstName.score,
      last_name: lastName.score
    },
    details: {
      email: email.details,
      phone: phone.details,
      full_name: fullName.details,
      first_name: firstName.details,
      last_name: lastName.details
    }
  };
}

function getDisplayName(row, detected) {
  if (detected.full_name_col) return row[detected.full_name_col] || "";

  const first = detected.first_name_col ? row[detected.first_name_col] || "" : "";
  const last = detected.last_name_col ? row[detected.last_name_col] || "" : "";

  return `${first} ${last}`.trim();
}

function prepareRows(data, detected) {
  return data.rows.map((row) => ({
    ...row,
    _normalized_email: detected.email_col ? normalizeEmail(row[detected.email_col]) : "",
    _normalized_phone: detected.phone_col ? normalizePhone(row[detected.phone_col]) : "",
    _display_name: getDisplayName(row, detected),
    _normalized_name: normalizeName(getDisplayName(row, detected))
  }));
}

function findBestMatch(metaRow, ghlRows, nameThreshold) {
  const emailMatches = metaRow._normalized_email
    ? ghlRows.filter((row) => row._normalized_email === metaRow._normalized_email)
    : [];

  const phoneMatches = metaRow._normalized_phone
    ? ghlRows.filter((row) => row._normalized_phone === metaRow._normalized_phone)
    : [];

  const candidates = uniqueRows([...emailMatches, ...phoneMatches]);

  if (!candidates.length) {
    return {
      best: null,
      reason: "No phone/email match in GHL",
      nameScore: 0,
      matchType: "No match"
    };
  }

  let best = null;
  let bestScore = -1;
  let bestStrength = "";
  let bestMatchType = "";

  candidates.forEach((candidate) => {
    const phoneMatch = Boolean(metaRow._normalized_phone && metaRow._normalized_phone === candidate._normalized_phone);
    const emailMatch = Boolean(metaRow._normalized_email && metaRow._normalized_email === candidate._normalized_email);
    const nameScore = nameSimilarity(metaRow._display_name, candidate._display_name);

    let strengthScore = 0;
    let strength = "";
    let matchType = "";

    if (phoneMatch && emailMatch) {
      strengthScore = 1000;
      strength = "Phone + email match";
      matchType = "Phone + email";
    } else if (phoneMatch) {
      strengthScore = 700;
      strength = "Phone match only";
      matchType = "Phone only";
    } else if (emailMatch) {
      strengthScore = 600;
      strength = "Email match only";
      matchType = "Email only";
    }

    const total = strengthScore + nameScore;

    if (total > bestScore) {
      bestScore = total;
      best = candidate;
      bestStrength = strength;
      bestMatchType = matchType;
    }
  });

  const nameScore = nameSimilarity(metaRow._display_name, best._display_name);
  const reason = nameScore < nameThreshold
    ? `${bestStrength}, but name may not match`
    : `${bestStrength}, name looks okay`;

  return {
    best,
    reason,
    nameScore,
    matchType: bestMatchType
  };
}

function uniqueRows(rows) {
  const seen = new Set();
  const output = [];

  rows.forEach((row) => {
    const key = `${row._source_row}|${row._normalized_email}|${row._normalized_phone}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push(row);
    }
  });

  return output;
}

function runMatcher(usingOverride) {
  try {
    statusBox.textContent = "Matching leads...";

    if (!usingOverride) {
      metaDetected = autoDetectColumns(metaData);
      ghlDetected = autoDetectColumns(ghlData);
    }

    renderMapping();
    renderOverrides();

    const nameThreshold = Number(nameThresholdInput.value);
    const metaRows = prepareRows(metaData, metaDetected);
    const ghlRows = prepareRows(ghlData, ghlDetected);

    const reviewRows = [];
    const matchedRows = [];
    const fullRows = [];

    metaRows.forEach((metaRow) => {
      const result = findBestMatch(metaRow, ghlRows, nameThreshold);
      const best = result.best;

      let needsReview = false;

      if (!best) {
        needsReview = true;
      } else if (["No match", "Phone only", "Email only"].includes(result.matchType)) {
        needsReview = true;
      } else if (result.nameScore < nameThreshold) {
        needsReview = true;
      }

      const outputRow = {
        needs_manual_review: needsReview ? "YES" : "NO",
        review_reason: result.reason,
        match_type: result.matchType,
        name_similarity_percent: result.nameScore,
        meta_csv_row: metaRow._source_row,
        meta_name: metaRow._display_name,
        meta_email_normalized: metaRow._normalized_email,
        meta_phone_normalized: metaRow._normalized_phone,
        ghl_csv_row: best ? best._source_row : "",
        ghl_name: best ? best._display_name : "",
        ghl_email_normalized: best ? best._normalized_email : "",
        ghl_phone_normalized: best ? best._normalized_phone : ""
      };

      metaData.headers.forEach((header) => {
        outputRow[`meta__${header}`] = metaRow[header] || "";
      });

      if (best) {
        ghlData.headers.forEach((header) => {
          outputRow[`ghl__${header}`] = best[header] || "";
        });
      }

      fullRows.push(outputRow);

      if (needsReview) {
        reviewRows.push(outputRow);
      } else {
        matchedRows.push(outputRow);
      }
    });

    latestReviewRows = reviewRows;
    latestFullRows = fullRows;

    totalMeta.textContent = metaRows.length;
    totalReview.textContent = reviewRows.length;
    totalMatched.textContent = matchedRows.length;

    renderReviewTable(reviewRows);

    resultsSection.classList.remove("hidden");
    statusBox.textContent = "Done. Download your manual review file below.";
  } catch (error) {
    console.error(error);
    statusBox.textContent = `Error: ${error.message}`;
  }
}

function renderMapping() {
  mappingSection.classList.remove("hidden");

  const rows = [
    mappingRow("Meta", metaDetected),
    mappingRow("GHL / HL", ghlDetected)
  ];

  renderTable(mappingTable, rows);
}

function mappingRow(label, detected) {
  let nameSource = "Not detected";

  if (detected.full_name_col) {
    nameSource = detected.full_name_col;
  } else if (detected.first_name_col || detected.last_name_col) {
    nameSource = `${detected.first_name_col || ""} + ${detected.last_name_col || ""}`.replace(/^ \+ | \+ $/g, "");
  }

  return {
    CSV: label,
    "Email column": detected.email_col || "Not detected",
    "Phone column": detected.phone_col || "Not detected",
    "Name column/source": nameSource,
    "Email confidence": detected.confidence.email,
    "Phone confidence": detected.confidence.phone,
    "Name confidence": Math.max(
      detected.confidence.full_name || 0,
      detected.confidence.first_name || 0,
      detected.confidence.last_name || 0
    )
  };
}

function renderOverrides() {
  overrideSection.innerHTML = "";
  overrideSection.appendChild(buildOverrideBlock("Meta", metaData, metaDetected, "meta"));
  overrideSection.appendChild(buildOverrideBlock("GHL", ghlData, ghlDetected, "ghl"));
}

function buildOverrideBlock(label, data, detected, key) {
  const block = document.createElement("div");
  block.className = "override-block";

  const title = document.createElement("h3");
  title.textContent = label;
  block.appendChild(title);

  [
    ["email_col", "Email column"],
    ["phone_col", "Phone column"],
    ["full_name_col", "Full name column"],
    ["first_name_col", "First name column"],
    ["last_name_col", "Last name column"]
  ].forEach(([field, labelText]) => {
    const wrapper = document.createElement("div");
    wrapper.style.marginBottom = "12px";

    const labelEl = document.createElement("label");
    labelEl.textContent = labelText;

    const select = document.createElement("select");
    select.dataset.target = key;
    select.dataset.field = field;

    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Not selected";
    select.appendChild(blank);

    data.headers.forEach((header) => {
      const option = document.createElement("option");
      option.value = header;
      option.textContent = header;
      if (detected[field] === header) option.selected = true;
      select.appendChild(option);
    });

    wrapper.appendChild(labelEl);
    wrapper.appendChild(select);
    block.appendChild(wrapper);
  });

  return block;
}

function applyOverrides() {
  const selects = overrideSection.querySelectorAll("select");

  selects.forEach((select) => {
    const target = select.dataset.target;
    const field = select.dataset.field;

    if (target === "meta") {
      metaDetected[field] = select.value || null;
    } else if (target === "ghl") {
      ghlDetected[field] = select.value || null;
    }
  });
}

function renderReviewTable(rows) {
  const previewRows = rows.slice(0, 250);

  if (!rows.length) {
    reviewTable.innerHTML = "<tbody><tr><td>Everything matched based on your current settings.</td></tr></tbody>";
    return;
  }

  const compactRows = previewRows.map((row) => ({
    needs_manual_review: row.needs_manual_review,
    review_reason: row.review_reason,
    match_type: row.match_type,
    name_similarity_percent: row.name_similarity_percent,
    meta_csv_row: row.meta_csv_row,
    meta_name: row.meta_name,
    meta_email_normalized: row.meta_email_normalized,
    meta_phone_normalized: row.meta_phone_normalized,
    ghl_csv_row: row.ghl_csv_row,
    ghl_name: row.ghl_name,
    ghl_email_normalized: row.ghl_email_normalized,
    ghl_phone_normalized: row.ghl_phone_normalized
  }));

  renderTable(reviewTable, compactRows);

  if (rows.length > 250) {
    const note = document.createElement("caption");
    note.textContent = `Showing first 250 rows. Download CSV to view all ${rows.length} rows.`;
    reviewTable.prepend(note);
  }
}

function renderTable(table, rows) {
  if (!rows.length) {
    table.innerHTML = "<tbody><tr><td>No rows to show.</td></tr></tbody>";
    return;
  }

  const headers = Object.keys(rows[0]);
  const thead = `<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows
    .map((row) => `<tr>${headers.map((h) => `<td>${escapeHtml(row[h])}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;

  table.innerHTML = thead + tbody;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function downloadCsv(filename, rows) {
  const csv = convertRowsToCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

function convertRowsToCsv(rows) {
  if (!rows.length) return "";

  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];

  rows.forEach((row) => {
    const values = headers.map((header) => csvEscape(row[header]));
    lines.push(values.join(","));
  });

  return lines.join("\n");
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n") || text.includes("\r")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
