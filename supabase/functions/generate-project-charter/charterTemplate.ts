// SP.6b — Reusable Project Charter template (server-side, Word .docx).
//
// 4D.4 update:
// - PM / Sponsor support multiple names.
// - Adds Business Case, Success Criteria, Completion Criteria,
//   Budget Narrative, Assumptions, Constraints from canonical source data.
// - RACI is rendered grouped by role (Responsible / Accountable / Consulted
//   / Informed) sourced from project-level RACI assignments.
// - Key Deliverables come from deliverable-type tasks.
// - Empty states use truthful "Not specified in BTPM." style strings for
//   the sections this step touches.

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

export interface CharterData {
  generatedAt: string;
  generatedByLabel: string;
  organizationName: string | null;

  project: {
    name: string;
    workspaceName: string | null;
    programName: string | null;
    statusLabel: string | null;
    stageLabel: string | null;
    startDate: string | null;
    targetEndDate: string | null;
    purpose: string | null;
    goal: string | null;
    businessCase: string | null;
    successCriteria: string | null;
    completionCriteria: string | null;
    budgetNarrative: string | null;
    scopeIn: string | null;
    scopeOut: string | null;
    /** Deliverable-type tasks. */
    keyDeliverables: Array<{ name: string; dueDate: string | null; status: string | null }>;
    assumptions: string[];
    constraints: string[];
    highLevelRisks: string[];
    // Phase 6D.7D — Portfolio context (org-level classification).
    portfolioItemId: string | null;
    portfolioName: string | null;
    portfolioCode: string | null;
    portfolioLifecycleState: string | null;
    portfolioIsArchived: boolean | null;
    portfolioLabel: string | null;
  };

  /** Zero, one, or many Project Managers from the project team. */
  projectManagerNames: string[];
  /** Zero, one, or many Project Sponsors from the project team. */
  projectSponsorNames: string[];

  milestones: Array<{ name: string; targetDate: string | null }>;

  /** Project RACI grouped by role; names list per group. */
  raciSummary: {
    responsible: string[];
    accountable: string[];
    consulted: string[];
    informed: string[];
  };

  glossary: Array<{ term: string; description: string }>;
}

// ---------- formatting helpers ----------

const PLACEHOLDER = "Not specified";
const NOT_SPECIFIED_BTPM = "Not specified in BTPM.";
const NO_RACI_BTPM = "No project RACI assignments recorded in BTPM.";
const NO_DELIVERABLES_BTPM = "No deliverable-type tasks recorded in BTPM.";
const FONT = "Calibri";

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

function val(v: string | null | undefined): string {
  return v && String(v).trim().length > 0 ? String(v).trim() : PLACEHOLDER;
}

function safeDocxName(name: string): string {
  return (name || "Project")
    .replace(/[\\/:*?"<>|#%]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Project";
}

export function charterFilenameFor(projectName: string): string {
  return `Project Overview - ${safeDocxName(projectName)}.docx`;
}

function run(text: string, opts: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {}): TextRun {
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
    children: [run(val(text), { size: 22 })],
    spacing: { after: 120 },
  });
}

/**
 * Render a multi-line narrative as one paragraph per non-empty line,
 * falling back to the supplied empty-state string when no content exists.
 */
function narrativeParas(text: string | null | undefined, emptyState: string): Paragraph[] {
  const lines = (text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/g, ""))
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return [
      new Paragraph({
        children: [run(emptyState, { italics: true, color: "808080" })],
        spacing: { after: 120 },
      }),
    ];
  }
  return lines.map(
    (l) =>
      new Paragraph({
        children: [run(l)],
        spacing: { after: 80 },
      }),
  );
}

function emptyStatePara(text: string): Paragraph {
  return new Paragraph({
    children: [run(text, { italics: true, color: "808080" })],
    spacing: { after: 120 },
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    children: [run(text)],
    spacing: { after: 60 },
  });
}

function numbered(text: string): Paragraph {
  return new Paragraph({
    numbering: { reference: "numbers", level: 0 },
    children: [run(text)],
    spacing: { after: 60 },
  });
}

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const allBorders = {
  top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder,
  insideHorizontal: cellBorder, insideVertical: cellBorder,
};
const cellBordersAll = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function headerCell(text: string, width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: cellBordersAll,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    shading: { fill: "1F3A5F", type: ShadingType.CLEAR, color: "auto" },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, size: 22, color: "FFFFFF", font: FONT })],
      }),
    ],
  });
}

function dataCell(text: string, width: number, opts: { bold?: boolean } = {}): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: cellBordersAll,
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    children: [
      new Paragraph({ children: [run(val(text), { bold: opts.bold })] }),
    ],
  });
}

function rawCell(text: string, width: number, opts: { bold?: boolean } = {}): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: cellBordersAll,
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    children: [
      new Paragraph({ children: [run(text && text.trim().length > 0 ? text : " ", { bold: opts.bold })] }),
    ],
  });
}

function blankSignCell(width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: cellBordersAll,
    margins: { top: 200, bottom: 200, left: 140, right: 140 },
    children: [new Paragraph({ children: [run(" ")] })],
  });
}

function multiLineCell(lines: string[], width: number): TableCell {
  const safe = lines.length > 0 ? lines : [PLACEHOLDER];
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: cellBordersAll,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: safe.map((l) => new Paragraph({ children: [run(l)] })),
  });
}

const CONTENT_WIDTH = 9360;

// ---------- section builders ----------

function joinNamesOrEmpty(names: string[]): string {
  if (!names || names.length === 0) return NOT_SPECIFIED_BTPM;
  return names.join(", ");
}

function summaryTable(d: CharterData): Table {
  const labelW = 3120;
  const valueW = CONTENT_WIDTH - labelW;
  const rows: Array<[string, string]> = [
    ["Project Name", d.project.name],
    ["Project Manager", joinNamesOrEmpty(d.projectManagerNames)],
    ["Project Sponsor", joinNamesOrEmpty(d.projectSponsorNames)],
    ["Workspace", val(d.project.workspaceName)],
  ];
  if (d.project.programName) rows.push(["Program", d.project.programName]);
  if (d.project.portfolioLabel) rows.push(["Portfolio", d.project.portfolioLabel]);
  if (d.project.statusLabel) rows.push(["Current Status", d.project.statusLabel]);
  if (d.project.stageLabel) rows.push(["Lifecycle Stage", d.project.stageLabel]);
  rows.push(["Target Start Date", fmtDate(d.project.startDate)]);
  rows.push(["Target Completion Date", fmtDate(d.project.targetEndDate)]);

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
            new TableCell({
              width: { size: valueW, type: WidthType.DXA },
              borders: cellBordersAll,
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [new Paragraph({ children: [run(val(v))] })],
            }),
          ],
        }),
    ),
  });
}

function scopeTable(d: CharterData): Table {
  const w = CONTENT_WIDTH / 2;
  const inLines = (d.project.scopeIn || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const outLines = (d.project.scopeOut || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [w, w],
    borders: allBorders,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [headerCell("In Scope", w), headerCell("Out of Scope", w)],
      }),
      new TableRow({
        children: [multiLineCell(inLines, w), multiLineCell(outLines, w)],
      }),
    ],
  });
}

/** Grouped RACI by role using real project-level assignments. */
function raciSection(d: CharterData): (Table | Paragraph)[] {
  const r = d.raciSummary || { responsible: [], accountable: [], consulted: [], informed: [] };
  const total =
    r.responsible.length + r.accountable.length + r.consulted.length + r.informed.length;
  if (total === 0) {
    return [emptyStatePara(NO_RACI_BTPM)];
  }
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
          children: [headerCell("RACI Role", labelW), headerCell("Assigned People", namesW)],
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
                multiLineCell(names.length > 0 ? names : ["—"], namesW),
              ],
            }),
        ),
      ],
    }),
  ];
}

function timelineTable(d: CharterData): Table {
  const w = CONTENT_WIDTH / 2;
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [w, w],
    borders: allBorders,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [headerCell("Project Start Date", w), headerCell("Target Project Completion Date", w)],
      }),
      new TableRow({
        children: [dataCell(fmtDate(d.project.startDate), w), dataCell(fmtDate(d.project.targetEndDate), w)],
      }),
    ],
  });
}

function milestoneTable(d: CharterData): Table | Paragraph {
  if (d.milestones.length === 0) {
    return bodyPara("Project phases and milestones will be defined during planning.");
  }
  const w1 = 6000;
  const w2 = CONTENT_WIDTH - w1;
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [w1, w2],
    borders: allBorders,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [headerCell("Project Phases / Milestones", w1), headerCell("Target Completion Date", w2)],
      }),
      ...d.milestones.map(
        (m) =>
          new TableRow({
            children: [dataCell(m.name, w1), rawCell(m.targetDate ? fmtDate(m.targetDate) : "", w2)],
          }),
      ),
    ],
  });
}

function deliverablesSection(d: CharterData): (Table | Paragraph)[] {
  if (d.project.keyDeliverables.length === 0) {
    return [emptyStatePara(NO_DELIVERABLES_BTPM)];
  }
  const cols = [5000, 2000, CONTENT_WIDTH - 5000 - 2000];
  return [
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: cols,
      borders: allBorders,
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            headerCell("Deliverable", cols[0]),
            headerCell("Target Date", cols[1]),
            headerCell("Status", cols[2]),
          ],
        }),
        ...d.project.keyDeliverables.map(
          (kd) =>
            new TableRow({
              children: [
                dataCell(kd.name, cols[0]),
                rawCell(kd.dueDate ? fmtDate(kd.dueDate) : "", cols[1]),
                rawCell(kd.status ? String(kd.status) : "", cols[2]),
              ],
            }),
        ),
      ],
    }),
  ];
}

function approvalTable(d: CharterData): Table {
  const cols = [2400, 3000, 2160, 1800];
  // One row per Sponsor, then one row per PM. If none, single placeholder row.
  const baseRows: Array<[string, string]> = [];
  if (d.projectSponsorNames.length === 0) {
    baseRows.push(["Project Sponsor", ""]);
  } else {
    for (const n of d.projectSponsorNames) baseRows.push(["Project Sponsor", n]);
  }
  if (d.projectManagerNames.length === 0) {
    baseRows.push(["Project Manager", ""]);
  } else {
    for (const n of d.projectManagerNames) baseRows.push(["Project Manager", n]);
  }
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    borders: allBorders,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell("Role", cols[0]),
          headerCell("Name", cols[1]),
          headerCell("Signature", cols[2]),
          headerCell("Date", cols[3]),
        ],
      }),
      ...baseRows.map(
        ([role, name]) =>
          new TableRow({
            children: [
              dataCell(role, cols[0], { bold: true }),
              rawCell(name, cols[1]),
              blankSignCell(cols[2]),
              blankSignCell(cols[3]),
            ],
          }),
      ),
    ],
  });
}

function glossaryTable(d: CharterData): Table {
  const w1 = 3120;
  const w2 = CONTENT_WIDTH - w1;
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [w1, w2],
    borders: allBorders,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [headerCell("Term", w1), headerCell("Description", w2)],
      }),
      ...d.glossary.map(
        (g) =>
          new TableRow({
            children: [dataCell(g.term, w1, { bold: true }), dataCell(g.description, w2)],
          }),
      ),
    ],
  });
}

function changeLogTable(d: CharterData): Table {
  const cols = [1200, 1500, 2200, 2660, 1800];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    borders: allBorders,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell("Version", cols[0]),
          headerCell("Date", cols[1]),
          headerCell("Author / Approver", cols[2]),
          headerCell("Description of Change", cols[3]),
          headerCell("Reason for Change", cols[4]),
        ],
      }),
      new TableRow({
        children: [
          dataCell("1.0", cols[0]),
          dataCell(fmtDate(d.generatedAt), cols[1]),
          dataCell(d.generatedByLabel || "BTPM", cols[2]),
          dataCell("Initial document generation", cols[3]),
          dataCell("Generated from BTPM", cols[4]),
        ],
      }),
    ],
  });
}

// ---------- main builder ----------

export async function buildCharterDocxBuffer(d: CharterData): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [];

  // 1. Cover
  if (d.organizationName) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [run(d.organizationName.toUpperCase(), { bold: true, size: 18, color: "808080" })],
        spacing: { before: 240, after: 80 },
      }),
    );
  }
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Project Charter", bold: true, size: 56, color: "1F3A5F", font: FONT })],
      spacing: { before: 120, after: 80 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [run("Project Overview", { size: 26, color: "595959" })],
      spacing: { after: 480 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [run(d.project.name, { bold: true, size: 32 })],
      spacing: { after: 360 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [run(`Generated from BTPM · ${fmtDate(d.generatedAt)}`, { size: 18, color: "808080" })],
      spacing: { after: 60 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        run(
          "This document is a generated snapshot. Regenerate from BTPM if source data changes.",
          { italics: true, size: 16, color: "A6A6A6" },
        ),
      ],
      spacing: { after: 240 },
    }),
    new Paragraph({
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: "1F3A5F", space: 1 },
      },
      spacing: { after: 200 },
    }),

    // 2. Project Summary
    h1("1. Project Summary"),
    summaryTable(d),
    new Paragraph({ children: [new PageBreak()] }),

    // 3. Project Goal / Objective
    h1("2. Project Goal / Objective"),
    bodyPara(d.project.goal),

    // 4. Purpose & Business Case
    h1("3. Project Purpose and Business Case"),
    h2("Purpose"),
    bodyPara(d.project.purpose),
    h2("Business Case"),
    ...narrativeParas(d.project.businessCase, NOT_SPECIFIED_BTPM),

    // 5. Success Criteria & Completion Criteria
    h1("4. Success Criteria and Completion Criteria"),
    h2("Success Criteria"),
    ...narrativeParas(d.project.successCriteria, NOT_SPECIFIED_BTPM),
    h2("Completion Criteria"),
    ...narrativeParas(d.project.completionCriteria, NOT_SPECIFIED_BTPM),

    // 6. Scope & Deliverables
    h1("5. Project Scope and Deliverables"),
    h2("Scope"),
    scopeTable(d),
    h2("Key Deliverables"),
  );
  for (const c of deliverablesSection(d)) children.push(c);

  // 7. RACI
  children.push(h1("6. RACI"));
  for (const c of raciSection(d)) children.push(c);

  // 8. Timeline & Milestones
  children.push(h1("7. Timeline and Milestones"));
  children.push(timelineTable(d));
  children.push(h2("Milestones"));
  children.push(milestoneTable(d));

  // 9. Budget & Resources
  children.push(h1("8. Budget and Resources"));
  for (const p of narrativeParas(d.project.budgetNarrative, NOT_SPECIFIED_BTPM)) children.push(p);

  // 10. Assumptions & Constraints
  children.push(h1("9. Assumptions and Constraints"));
  children.push(h2("Assumptions"));
  if (d.project.assumptions.length === 0) {
    children.push(emptyStatePara(NOT_SPECIFIED_BTPM));
  } else {
    for (const a of d.project.assumptions) children.push(bullet(a));
  }
  children.push(h2("Constraints"));
  if (d.project.constraints.length === 0) {
    children.push(emptyStatePara(NOT_SPECIFIED_BTPM));
  } else {
    for (const c of d.project.constraints) children.push(bullet(c));
  }

  // 11. High-Level Risks
  children.push(h1("10. High-Level Risks"));
  if (d.project.highLevelRisks.length === 0) {
    children.push(bodyPara("No high-level risks recorded."));
  } else {
    for (const r of d.project.highLevelRisks) children.push(numbered(r));
  }

  // 12. Project Approval
  children.push(h1("11. Project Approval"));
  children.push(
    bodyPara(
      "This Project Charter formally authorizes the project. Signatures below indicate approval of this charter and commitment to the project as described herein.",
    ),
  );
  children.push(approvalTable(d));

  // 13. Glossary (optional)
  if (d.glossary.length > 0) {
    children.push(h1("12. Glossary"));
    children.push(glossaryTable(d));
  }

  // 14. Document History / Change Log
  const changeLogIndex = d.glossary.length > 0 ? 13 : 12;
  children.push(h1(`${changeLogIndex}. Document History / Change Log`));
  children.push(changeLogTable(d));

  const doc = new Document({
    creator: "BTPM",
    title: `Project Overview / Charter — ${d.project.name}`,
    styles: {
      default: {
        document: { run: { font: FONT, size: 22 } },
      },
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
        {
          reference: "numbers",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
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
                    text: `BTPM · Project Charter · ${d.project.name}`,
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
                  new TextRun({ text: "BTPM · Generated ", size: 18, color: "808080", font: FONT }),
                  new TextRun({ text: fmtDate(d.generatedAt), size: 18, color: "808080", font: FONT }),
                  new TextRun({ text: " · v1.0 · Page ", size: 18, color: "808080", font: FONT }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: FONT }),
                  new TextRun({ text: " of ", size: 18, color: "808080", font: FONT }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: "808080", font: FONT }),
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
