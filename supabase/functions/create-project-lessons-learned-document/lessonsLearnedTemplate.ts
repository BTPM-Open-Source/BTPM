// Phase 6C — Step 6C.FILE-R1b — Built-in Lessons Learned starter template.
//
// Server-side .docx generation for the initial Lessons Learned document.
// This file only produces a starter document with prompts and empty tables.
// It never invents lessons and never fetches AI-generated content. After
// creation the file is opened and edited by users in SharePoint.

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "https://esm.sh/docx@8.5.0";

export interface LessonsLearnedTemplateData {
  generatedAt: string;
  project: {
    name: string;
    workspaceName: string | null;
    programName: string | null;
    statusLabel: string | null;
    startDate: string | null;
    targetEndDate: string | null;
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
}

function txt(text: string, opts: { bold?: boolean; size?: number } = {}): TextRun {
  return new TextRun({ text, bold: opts.bold, size: opts.size });
}

function p(text: string, opts: { bold?: boolean } = {}): Paragraph {
  return new Paragraph({ children: [txt(text, opts)] });
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });
}

function orNotMaintained(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : "Not maintained";
}

function orNotAssigned(list: string[]): string {
  return list.length > 0 ? list.join(", ") : "Not assigned";
}

function metaRow(label: string, value: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 30, type: WidthType.PERCENTAGE },
        children: [p(label, { bold: true })],
      }),
      new TableCell({
        width: { size: 70, type: WidthType.PERCENTAGE },
        children: [p(value)],
      }),
    ],
  });
}

function headerRow(labels: string[]): TableRow {
  return new TableRow({
    tableHeader: true,
    children: labels.map(
      (l) =>
        new TableCell({
          children: [new Paragraph({ children: [txt(l, { bold: true })] })],
        }),
    ),
  });
}

function emptyRow(cols: number): TableRow {
  return new TableRow({
    children: Array.from({ length: cols }, () => new TableCell({ children: [p(" ")] })),
  });
}

export async function buildLessonsLearnedDocx(
  data: LessonsLearnedTemplateData,
): Promise<Uint8Array> {
  const projectName = (data.project.name ?? "").trim() || "Project";

  const metadataRows: TableRow[] = [
    metaRow("Workspace", orNotMaintained(data.project.workspaceName)),
    metaRow("Program", orNotMaintained(data.project.programName)),
  ];
  if (data.project.portfolioLabel) {
    metadataRows.push(metaRow("Portfolio", data.project.portfolioLabel));
  }
  metadataRows.push(
    metaRow("Project Manager", orNotAssigned(data.projectManagerNames)),
    metaRow("Sponsor", orNotAssigned(data.projectSponsorNames)),
    metaRow("Project Status", orNotMaintained(data.project.statusLabel)),
    metaRow("Start Date", orNotMaintained(data.project.startDate)),
    metaRow("Target End Date", orNotMaintained(data.project.targetEndDate)),
    metaRow("Document Created", data.generatedAt),
  );
  const metadataTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: metadataRows,
  });

  const lessonsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow(["Lesson", "Impact", "Recommendation"]), emptyRow(3), emptyRow(3), emptyRow(3)],
  });

  const actionsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      headerRow(["Action", "Owner", "Due Date", "Status"]),
      emptyRow(4),
      emptyRow(4),
      emptyRow(4),
    ],
  });

  const children: Array<Paragraph | Table> = [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [txt(`Lessons Learned — ${projectName}`, { bold: true, size: 32 })],
      spacing: { after: 200 },
    }),

    heading("Project Metadata", HeadingLevel.HEADING_2),
    metadataTable,

    heading("1. Project Summary", HeadingLevel.HEADING_2),
    p("Summarize the project context, scope, and overall outcome."),

    heading("2. What Went Well", HeadingLevel.HEADING_2),
    p("• What worked well?"),
    p("• Which practices should be repeated?"),
    p("• Which decisions or actions contributed to success?"),

    heading("3. What Did Not Go Well", HeadingLevel.HEADING_2),
    p("• What created delays, rework, or confusion?"),
    p("• Which assumptions proved wrong?"),
    p("• Which risks or blockers could have been managed earlier?"),

    heading("4. Key Lessons Learned", HeadingLevel.HEADING_2),
    lessonsTable,

    heading("5. Recommendations for Future Projects", HeadingLevel.HEADING_2),
    p("• Recommendation 1"),
    p("• Recommendation 2"),
    p("• Recommendation 3"),

    heading("6. Follow-up Actions", HeadingLevel.HEADING_2),
    actionsTable,

    heading("7. Additional Notes", HeadingLevel.HEADING_2),
    p("Add any additional context, references, or supporting notes here."),
  ];

  const doc = new Document({
    creator: "BTPM",
    title: `Lessons Learned — ${projectName}`,
    description: "Lessons Learned starter document generated by BTPM.",
    sections: [{ properties: {}, children }],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}
