// Phase 6C — Step 6C.8: Reusable Project Closure Report .docx template.
// Server-side only; consumes ClosureReportData from dataMapper.ts.

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  Header,
  Footer,
  PageNumber,
  BorderStyle,
  WidthType,
  ShadingType,
  LevelFormat,
  PageBreak,
} from "https://esm.sh/docx@8.5.0";

export interface ClosureReportData {
  generatedAt: string;
  generatedByLabel: string;
  organizationName: string | null;
  project: {
    name: string;
    workspaceName: string | null;
    programName: string | null;
    statusLabel: string | null;
    stageLabel: string | null;
    healthLabel: string | null;
    completionPct: number | null;
    startDate: string | null;
    targetEndDate: string | null;
    description: string | null;
    goals: string | null;
    scopeIn: string | null;
    scopeOut: string | null;
    successCriteria: string | null;
    // Phase 6D.7D — Portfolio context (org-level classification).
    portfolioItemId: string | null;
    portfolioName: string | null;
    portfolioCode: string | null;
    portfolioLifecycleState: string | null;
    portfolioIsArchived: boolean | null;
    portfolioLabel: string | null;
  };
  projectManagerNames: string[];
  projectSponsorNames: string[];
  teamMemberNames: string[];
  stakeholders: Array<{ name: string; role: string | null }>;
  raciSummary: {
    responsible: string[];
    accountable: string[];
    consulted: string[];
    informed: string[];
  };
  phases: Array<{
    name: string;
    status: string | null;
    startDate: string | null;
    targetEndDate: string | null;
  }>;
  taskCounts: { total: number; completed: number; open: number; overdue: number };
  closureSummary: {
    outcome: string | null;
    benefits: string | null;
    achievements: string | null;
    openItems: string | null;
    transitionNotes: string | null;
  } | null;
  benefits: Array<{
    benefitType: string;
    metric: string;
    unit: string;
    baseline: number | null;
    target: number | null;
    actual: number | null;
    status: string | null;
    owner: string | null;
    expectedDate: string | null;
    actualDate: string | null;
  }>;
  kpis: Array<{
    name: string;
    unit: string | null;
    targetValue: number | null;
    currentValue: number | null;
    lastUpdated: string | null;
  }>;
  riskCounts: { total: number; open: number; closed: number };
  openRisks: Array<{ title: string; status: string | null; severity: string | null }>;
  blockerCounts: { total: number; open: number; closed: number };
  openBlockers: Array<{ title: string; status: string | null; severity: string | null }>;
  lessonsLearned: {
    documentName: string | null;
    status: string | null;
    lastModified: string | null;
    sharepointWebUrl: string | null;
  } | null;
}

const FONT = "Calibri";
const PLACEHOLDER = "Not maintained";
const CONTENT_WIDTH = 9360;

function fmtDate(d: string | null | undefined): string {
  if (!d) return PLACEHOLDER;
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d);
    return dt.toISOString().slice(0, 10);
  } catch {
    return String(d);
  }
}

function val(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return PLACEHOLDER;
  const s = String(v).trim();
  return s.length > 0 ? s : PLACEHOLDER;
}

function num(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return PLACEHOLDER;
  return String(n);
}

export function closureReportFilenameFor(projectName: string): string {
  const safe = (projectName || "Project")
    .replace(/[\\/:*?"<>|#%]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Project";
  return `Project Closure Report - ${safe}.docx`;
}

function run(
  text: string,
  opts: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {},
): TextRun {
  return new TextRun({
    text,
    bold: opts.bold,
    italics: opts.italics,
    size: opts.size ?? 22,
    color: opts.color,
    font: FONT,
  });
}

function h1(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
  });
}

function h2(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
  });
}

function bodyPara(text: string | null | undefined): Paragraph {
  return new Paragraph({
    children: [run(val(text as string | null | undefined))],
    spacing: { after: 120 },
  });
}

function narrativeParas(
  text: string | null | undefined,
  emptyState: string,
): Paragraph[] {
  const lines = (text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return [
      new Paragraph({
        children: [run(emptyState, { italics: true, color: "808080" })],
        spacing: { after: 120 },
      }),
    ];
  }
  return lines.map(
    (l) => new Paragraph({ children: [run(l)], spacing: { after: 80 } }),
  );
}

function emptyStatePara(text: string): Paragraph {
  return new Paragraph({
    children: [run(text, { italics: true, color: "808080" })],
    spacing: { after: 120 },
  });
}

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const allBorders = {
  top: cellBorder,
  bottom: cellBorder,
  left: cellBorder,
  right: cellBorder,
  insideHorizontal: cellBorder,
  insideVertical: cellBorder,
};
const cellBordersAll = {
  top: cellBorder,
  bottom: cellBorder,
  left: cellBorder,
  right: cellBorder,
};

function headerCell(text: string, width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: cellBordersAll,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    shading: { fill: "1F3A5F", type: ShadingType.CLEAR, color: "auto" },
    children: [
      new Paragraph({
        children: [
          new TextRun({ text, bold: true, size: 20, color: "FFFFFF", font: FONT }),
        ],
      }),
    ],
  });
}

function dataCell(text: string, width: number, opts: { bold?: boolean } = {}): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: cellBordersAll,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [run(text, { bold: opts.bold })] })],
  });
}

function summaryTable(d: ClosureReportData): Table {
  const labelW = 3120;
  const valueW = CONTENT_WIDTH - labelW;
  const pmLabel = d.projectManagerNames.length > 0
    ? d.projectManagerNames.join(", ")
    : PLACEHOLDER;
  const sponsorLabel = d.projectSponsorNames.length > 0
    ? d.projectSponsorNames.join(", ")
    : PLACEHOLDER;
  const completion = d.project.completionPct === null
    ? PLACEHOLDER
    : `${d.project.completionPct}%`;
  const rows: Array<[string, string]> = [
    ["Project Name", val(d.project.name)],
    ["Project Manager", pmLabel],
    ["Sponsor", sponsorLabel],
    ["Workspace", val(d.project.workspaceName)],
    ["Program", val(d.project.programName)],
  ];
  if (d.project.portfolioLabel) rows.push(["Portfolio", d.project.portfolioLabel]);
  rows.push(
    ["Status", val(d.project.statusLabel)],
    ["Stage", val(d.project.stageLabel)],
    ["Health", val(d.project.healthLabel)],
    ["Completion", completion],
    ["Start Date", fmtDate(d.project.startDate)],
    ["Target End Date", fmtDate(d.project.targetEndDate)],
  );
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [labelW, valueW],
    borders: allBorders,
    rows: rows.map(
      ([k, v]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: labelW, type: WidthType.DXA },
              borders: cellBordersAll,
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              shading: { fill: "F2F2F2", type: ShadingType.CLEAR, color: "auto" },
              children: [new Paragraph({ children: [run(k, { bold: true })] })],
            }),
            dataCell(v, valueW),
          ],
        }),
    ),
  });
}

function phasesTable(d: ClosureReportData): Table | Paragraph {
  if (d.phases.length === 0) {
    return emptyStatePara("No delivery plan recorded.");
  }
  const cols = [4560, 1600, 1600, 1600];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    borders: allBorders,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell("Phase", cols[0]),
          headerCell("Status", cols[1]),
          headerCell("Start", cols[2]),
          headerCell("Target End", cols[3]),
        ],
      }),
      ...d.phases.map(
        (p) =>
          new TableRow({
            children: [
              dataCell(val(p.name), cols[0]),
              dataCell(val(p.status), cols[1]),
              dataCell(fmtDate(p.startDate), cols[2]),
              dataCell(fmtDate(p.targetEndDate), cols[3]),
            ],
          }),
      ),
    ],
  });
}

function taskRollupTable(d: ClosureReportData): Table {
  const cols = [2340, 2340, 2340, 2340];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    borders: allBorders,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell("Total Tasks", cols[0]),
          headerCell("Completed", cols[1]),
          headerCell("Open", cols[2]),
          headerCell("Overdue", cols[3]),
        ],
      }),
      new TableRow({
        children: [
          dataCell(String(d.taskCounts.total), cols[0]),
          dataCell(String(d.taskCounts.completed), cols[1]),
          dataCell(String(d.taskCounts.open), cols[2]),
          dataCell(String(d.taskCounts.overdue), cols[3]),
        ],
      }),
    ],
  });
}

function benefitsTable(d: ClosureReportData): Table | Paragraph {
  if (d.benefits.length === 0) return emptyStatePara("No benefits recorded.");
  const cols = [1100, 1300, 600, 750, 750, 750, 900, 1210, 1000, 1000];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    borders: allBorders,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell("Type", cols[0]),
          headerCell("Metric", cols[1]),
          headerCell("Unit", cols[2]),
          headerCell("Baseline", cols[3]),
          headerCell("Target", cols[4]),
          headerCell("Actual", cols[5]),
          headerCell("Status", cols[6]),
          headerCell("Owner", cols[7]),
          headerCell("Expected Date", cols[8]),
          headerCell("Actual Date", cols[9]),
        ],
      }),
      ...d.benefits.map(
        (b) =>
          new TableRow({
            children: [
              dataCell(val(b.benefitType), cols[0]),
              dataCell(val(b.metric), cols[1]),
              dataCell(val(b.unit), cols[2]),
              dataCell(num(b.baseline), cols[3]),
              dataCell(num(b.target), cols[4]),
              dataCell(num(b.actual), cols[5]),
              dataCell(val(b.status), cols[6]),
              dataCell(val(b.owner), cols[7]),
              dataCell(val(b.expectedDate), cols[8]),
              dataCell(val(b.actualDate), cols[9]),
            ],
          }),
      ),
    ],
  });
}

function kpiTable(d: ClosureReportData): Table | Paragraph {
  if (d.kpis.length === 0) return emptyStatePara("No KPIs recorded.");
  const cols = [3600, 1400, 1400, 1400, 1560];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    borders: allBorders,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell("KPI", cols[0]),
          headerCell("Unit", cols[1]),
          headerCell("Target", cols[2]),
          headerCell("Current", cols[3]),
          headerCell("Last Updated", cols[4]),
        ],
      }),
      ...d.kpis.map(
        (k) =>
          new TableRow({
            children: [
              dataCell(val(k.name), cols[0]),
              dataCell(val(k.unit), cols[1]),
              dataCell(num(k.targetValue), cols[2]),
              dataCell(num(k.currentValue), cols[3]),
              dataCell(fmtDate(k.lastUpdated), cols[4]),
            ],
          }),
      ),
    ],
  });
}

function countsTable(counts: { total: number; open: number; closed: number }): Table {
  const cols = [3120, 3120, 3120];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    borders: allBorders,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell("Total", cols[0]),
          headerCell("Open", cols[1]),
          headerCell("Closed", cols[2]),
        ],
      }),
      new TableRow({
        children: [
          dataCell(String(counts.total), cols[0]),
          dataCell(String(counts.open), cols[1]),
          dataCell(String(counts.closed), cols[2]),
        ],
      }),
    ],
  });
}

function openItemsTable(
  items: Array<{ title: string; status: string | null; severity: string | null }>,
  header: string,
): Table | Paragraph {
  if (items.length === 0) return emptyStatePara(`No open ${header.toLowerCase()}.`);
  const cols = [5760, 1800, 1800];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    borders: allBorders,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell("Title", cols[0]),
          headerCell("Status", cols[1]),
          headerCell("Severity", cols[2]),
        ],
      }),
      ...items.map(
        (r) =>
          new TableRow({
            children: [
              dataCell(val(r.title), cols[0]),
              dataCell(val(r.status), cols[1]),
              dataCell(val(r.severity), cols[2]),
            ],
          }),
      ),
    ],
  });
}

function raciSection(d: ClosureReportData): (Table | Paragraph)[] {
  const r = d.raciSummary;
  const total =
    r.responsible.length + r.accountable.length + r.consulted.length + r.informed.length;
  if (total === 0) return [emptyStatePara("No RACI assignments recorded.")];
  const labelW = 2400;
  const namesW = CONTENT_WIDTH - labelW;
  const rows: Array<[string, string[]]> = [
    ["Responsible", r.responsible],
    ["Accountable", r.accountable],
    ["Consulted", r.consulted],
    ["Informed", r.informed],
  ];
  return [
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [labelW, namesW],
      borders: allBorders,
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            headerCell("RACI Role", labelW),
            headerCell("Assigned People", namesW),
          ],
        }),
        ...rows.map(
          ([role, names]) =>
            new TableRow({
              children: [
                new TableCell({
                  width: { size: labelW, type: WidthType.DXA },
                  borders: cellBordersAll,
                  margins: { top: 80, bottom: 80, left: 120, right: 120 },
                  shading: { fill: "F2F2F2", type: ShadingType.CLEAR, color: "auto" },
                  children: [new Paragraph({ children: [run(role, { bold: true })] })],
                }),
                dataCell(names.length > 0 ? names.join(", ") : "—", namesW),
              ],
            }),
        ),
      ],
    }),
  ];
}

function stakeholdersTable(d: ClosureReportData): Table | Paragraph {
  if (d.stakeholders.length === 0) {
    return emptyStatePara("No stakeholders recorded.");
  }
  const cols = [4680, 4680];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    borders: allBorders,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [headerCell("Name", cols[0]), headerCell("Role", cols[1])],
      }),
      ...d.stakeholders.map(
        (s) =>
          new TableRow({
            children: [dataCell(val(s.name), cols[0]), dataCell(val(s.role), cols[1])],
          }),
      ),
    ],
  });
}

function lessonsLearnedSection(d: ClosureReportData): Paragraph[] {
  const ll = d.lessonsLearned;
  if (!ll) return [emptyStatePara("No Lessons Learned document linked.")];
  const paras: Paragraph[] = [];
  const statusLc = (ll.status || "").toLowerCase();

  paras.push(
    new Paragraph({
      children: [run("Document Name: ", { bold: true }), run(val(ll.documentName))],
      spacing: { after: 60 },
    }),
  );
  paras.push(
    new Paragraph({
      children: [run("Status: ", { bold: true }), run(val(ll.status))],
      spacing: { after: 60 },
    }),
  );
  paras.push(
    new Paragraph({
      children: [
        run("Last Modified: ", { bold: true }),
        run(fmtDate(ll.lastModified)),
      ],
      spacing: { after: 60 },
    }),
  );

  if (statusLc === "available" && ll.sharepointWebUrl) {
    paras.push(
      new Paragraph({
        children: [
          run("SharePoint Link: ", { bold: true }),
          run(ll.sharepointWebUrl, { color: "1F3A5F" }),
        ],
        spacing: { after: 120 },
      }),
    );
  } else if (statusLc === "link_broken") {
    paras.push(emptyStatePara("Link broken — SharePoint file could not be resolved."));
  } else if (statusLc === "missing_folder") {
    paras.push(emptyStatePara("Project SharePoint folder missing."));
  } else if (statusLc === "creation_failed") {
    paras.push(emptyStatePara("Lessons Learned document creation failed."));
  }
  return paras;
}

export async function buildClosureReportDocxBuffer(
  d: ClosureReportData,
): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [];

  // Cover.
  if (d.organizationName) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          run(d.organizationName.toUpperCase(), {
            bold: true,
            size: 18,
            color: "808080",
          }),
        ],
        spacing: { before: 240, after: 80 },
      }),
    );
  }
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: "Project Closure Report",
          bold: true,
          size: 56,
          color: "1F3A5F",
          font: FONT,
        }),
      ],
      spacing: { before: 120, after: 240 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [run(d.project.name, { bold: true, size: 32 })],
      spacing: { after: 360 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        run(`Generated from BTPM · ${fmtDate(d.generatedAt)}`, {
          size: 18,
          color: "808080",
        }),
      ],
      spacing: { after: 60 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        run(`Generated by ${d.generatedByLabel}`, {
          italics: true,
          size: 16,
          color: "A6A6A6",
        }),
      ],
      spacing: { after: 240 },
    }),
    new Paragraph({
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: "1F3A5F", space: 1 },
      },
      spacing: { after: 200 },
    }),

    // 1. Project Summary
    h1("1. Project Summary"),
    summaryTable(d),

    // 2. Project Context
    h1("2. Project Context"),
    h2("Description"),
    ...narrativeParas(d.project.description, "No project description recorded."),
    h2("Goals / Objectives"),
    ...narrativeParas(d.project.goals, "No goals recorded."),
    h2("In Scope"),
    ...narrativeParas(d.project.scopeIn, "No in-scope items recorded."),
    h2("Out of Scope"),
    ...narrativeParas(d.project.scopeOut, "No out-of-scope items recorded."),
    h2("Success Criteria"),
    ...narrativeParas(d.project.successCriteria, "No success criteria recorded."),

    // 3. Delivery Summary
    h1("3. Delivery Summary"),
    h2("Task Rollup"),
    taskRollupTable(d),
    h2("Phases"),
    phasesTable(d),
  );

  // 4. Project Outcome & Benefits Summary
  children.push(h1("4. Project Outcome & Benefits Summary"));
  const cs = d.closureSummary;
  if (!cs) {
    children.push(emptyStatePara("No project closure summary recorded."));
  } else {
    children.push(h2("Project Outcome"));
    for (const p of narrativeParas(cs.outcome, "Not recorded.")) children.push(p);
    children.push(h2("Key Benefits Delivered"));
    for (const p of narrativeParas(cs.benefits, "Not recorded.")) children.push(p);
    children.push(h2("Major Achievements"));
    for (const p of narrativeParas(cs.achievements, "Not recorded.")) children.push(p);
    children.push(h2("Open Items / Follow-up"));
    for (const p of narrativeParas(cs.openItems, "Not recorded.")) children.push(p);
    children.push(h2("Transition Notes"));
    for (const p of narrativeParas(cs.transitionNotes, "Not recorded.")) children.push(p);
  }

  // 5. Benefits Realization
  children.push(h1("5. Benefits Realization"));
  children.push(benefitsTable(d));

  // 6. KPI Summary
  children.push(h1("6. KPI Summary"));
  children.push(kpiTable(d));

  // 7. Risks & Blockers Summary
  children.push(h1("7. Risks & Blockers Summary"));
  children.push(h2("Risks"));
  children.push(countsTable(d.riskCounts));
  children.push(h2("Open Risks"));
  children.push(openItemsTable(d.openRisks, "risks"));
  children.push(h2("Blockers"));
  children.push(countsTable(d.blockerCounts));
  children.push(h2("Open Blockers"));
  children.push(openItemsTable(d.openBlockers, "blockers"));

  // 8. Team & Stakeholders
  children.push(h1("8. Team & Stakeholders"));
  children.push(h2("Project Manager"));
  children.push(
    bodyPara(
      d.projectManagerNames.length > 0
        ? d.projectManagerNames.join(", ")
        : PLACEHOLDER,
    ),
  );
  children.push(h2("Sponsor"));
  children.push(
    bodyPara(
      d.projectSponsorNames.length > 0
        ? d.projectSponsorNames.join(", ")
        : PLACEHOLDER,
    ),
  );
  children.push(h2("Team Members"));
  children.push(
    bodyPara(
      d.teamMemberNames.length > 0 ? d.teamMemberNames.join(", ") : PLACEHOLDER,
    ),
  );
  children.push(h2("Stakeholders"));
  children.push(stakeholdersTable(d));
  children.push(h2("RACI Summary"));
  for (const c of raciSection(d)) children.push(c);

  // 9. Lessons Learned Reference
  children.push(h1("9. Lessons Learned Reference"));
  for (const p of lessonsLearnedSection(d)) children.push(p);

  // 10. Open Items / Follow-up
  children.push(h1("10. Open Items / Follow-up"));
  const openItemsText = cs?.openItems ?? null;
  const hasOpenItemsText = openItemsText && openItemsText.trim().length > 0;
  const anyOpen =
    hasOpenItemsText ||
    d.openBlockers.length > 0 ||
    d.openRisks.length > 0 ||
    d.taskCounts.open > 0;
  if (!anyOpen) {
    children.push(emptyStatePara("No open follow-up items recorded."));
  } else {
    if (hasOpenItemsText) {
      children.push(h2("From Closure Summary"));
      for (const p of narrativeParas(openItemsText, "Not recorded.")) children.push(p);
    }
    if (d.taskCounts.open > 0) {
      children.push(h2("Incomplete Tasks"));
      children.push(
        bodyPara(
          `${d.taskCounts.open} open task(s), ${d.taskCounts.overdue} overdue.`,
        ),
      );
    }
    if (d.openBlockers.length > 0) {
      children.push(h2("Open Blockers"));
      children.push(openItemsTable(d.openBlockers, "blockers"));
    }
    if (d.openRisks.length > 0) {
      children.push(h2("Open Risks"));
      children.push(openItemsTable(d.openRisks, "risks"));
    }
  }

  const doc = new Document({
    creator: "BTPM",
    title: `Project Closure Report — ${d.project.name}`,
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 30, bold: true, color: "1F3A5F", font: FONT },
          paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 24, bold: true, color: "2E5984", font: FONT },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "\u2022",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `BTPM · Project Closure Report · ${d.project.name}`,
                    size: 18,
                    color: "808080",
                    font: FONT,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: "BTPM · Generated ",
                    size: 18,
                    color: "808080",
                    font: FONT,
                  }),
                  new TextRun({
                    text: fmtDate(d.generatedAt),
                    size: 18,
                    color: "808080",
                    font: FONT,
                  }),
                  new TextRun({
                    text: " · Page ",
                    size: 18,
                    color: "808080",
                    font: FONT,
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 18,
                    color: "808080",
                    font: FONT,
                  }),
                  new TextRun({
                    text: " of ",
                    size: 18,
                    color: "808080",
                    font: FONT,
                  }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    size: 18,
                    color: "808080",
                    font: FONT,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}

// Unused import guard for PageBreak (kept for parity with charter helpers).
void PageBreak;
