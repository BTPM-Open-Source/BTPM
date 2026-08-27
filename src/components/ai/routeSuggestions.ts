// Route-aware suggested starter questions and page label for BTPM Guide.

export interface RouteSuggestion {
  label: string;
  questions: string[];
}

const SUGGESTION_RULES: Array<{ test: (path: string) => boolean; suggestion: RouteSuggestion }> = [
  // --- Knowledge Center ---
  {
    test: (p) => p.startsWith("/knowledge"),
    suggestion: {
      label: "Knowledge Center",
      questions: [
        "How should I use the Knowledge Center?",
        "What articles should I read first?",
        "How do Knowledge Center articles relate to pages?",
      ],
    },
  },

  // --- Specific Admin pages (must come before generic /admin) ---
  {
    test: (p) => p.startsWith("/admin/btpm-guide-evaluation"),
    suggestion: {
      label: "BTPM Guide Evaluation",
      questions: [
        "How should admins use BTPM Guide Evaluation?",
        "What does pass, warn, and fail mean?",
        "Why are sources shown but the answer is weak?",
      ],
    },
  },
  {
    test: (p) => p.startsWith("/admin/invitations"),
    suggestion: {
      label: "Admin Invitations",
      questions: [
        "How should user invitations be handled?",
        "What should I check if someone did not receive access?",
        "What happens after a user accepts an invitation?",
      ],
    },
  },
  {
    test: (p) => p.startsWith("/admin/users"),
    suggestion: {
      label: "Admin Users",
      questions: [
        "How should I manage users and roles?",
        "Why can't a user access a project?",
        "What is the difference between user role and project access?",
      ],
    },
  },
  {
    test: (p) => p.startsWith("/admin/sharepoint"),
    suggestion: {
      label: "Admin SharePoint",
      questions: [
        "How do I set up SharePoint in BTPM?",
        "Why can't users open a SharePoint folder?",
        "Does SharePoint become the project source of truth?",
      ],
    },
  },
  {
    test: (p) => p.startsWith("/admin/power-bi") || p.startsWith("/admin/powerbi"),
    suggestion: {
      label: "Admin Power BI",
      questions: [
        "What is Power BI used for in BTPM?",
        "Why is Power BI data stale or different?",
        "Is Power BI the source of truth?",
      ],
    },
  },
  {
    test: (p) => p.startsWith("/admin/kpi-app"),
    suggestion: {
      label: "Admin KPI App",
      questions: [
        "What is the KPI App integration?",
        "Why is a KPI App report not ready?",
        "Can BTPM automatically approve KPI submissions?",
      ],
    },
  },

  // --- Specific project sub-pages (must come before generic project rule) ---
  {
    test: (p) => /\/project\/[^/]+\/calendar/.test(p) || p.endsWith("/calendar"),
    suggestion: {
      label: "Project Calendar",
      questions: [
        "What should I use the Project Calendar for?",
        "How is the Project Calendar different from My Work Calendar?",
        "What dates should I check here?",
      ],
    },
  },
  {
    test: (p) => /\/project\/[^/]+\/team/.test(p) || p.endsWith("/team"),
    suggestion: {
      label: "Project Team and RACI",
      questions: [
        "What should I do on the Project Team page?",
        "What is RACI?",
        "How should I manage project access and roles?",
      ],
    },
  },
  {
    test: (p) => /\/project\/[^/]+\/agile\/backlog/.test(p) || /\/agile\/backlog/.test(p) || /\/project\/[^/]+\/backlog/.test(p),
    suggestion: {
      label: "Agile Backlog",
      questions: [
        "What do I do in the Agile Backlog?",
        "When should I move an item into a sprint?",
        "How should I prioritize backlog items?",
      ],
    },
  },
  {
    test: (p) => /\/project\/[^/]+\/agile\/sprints/.test(p) || /\/agile\/sprints/.test(p) || /\/project\/[^/]+\/sprints/.test(p),
    suggestion: {
      label: "Agile Sprints",
      questions: [
        "What is a sprint in BTPM?",
        "Is a sprint the same as a phase?",
        "What should I check before closing a sprint?",
      ],
    },
  },
  {
    test: (p) => /\/project\/[^/]+\/agile\/board/.test(p) || /\/agile\/board/.test(p) || /\/project\/[^/]+\/board/.test(p),
    suggestion: {
      label: "Agile Board",
      questions: [
        "What is the Agile Board for?",
        "When should I move an item on the board?",
        "Is the board a separate project plan?",
      ],
    },
  },
  {
    test: (p) => /\/project\/[^/]+\/overview/.test(p) || p.endsWith("/overview"),
    suggestion: {
      label: "Project Overview",
      questions: [
        "What should I do in the project overview?",
        "How should I use scope, goals, and charter fields?",
        "What is the best way to keep the overview useful?",
      ],
    },
  },
  {
    test: (p) => /\/project\/[^/]+\/planning/.test(p) || /\/project\/[^/]+\/phases/.test(p),
    suggestion: {
      label: "Project Planning",
      questions: [
        "How should I plan phases and tasks?",
        "What is the difference between a phase and a task?",
        "How should dependencies be used?",
      ],
    },
  },
  {
    test: (p) => /\/gantt/.test(p),
    suggestion: {
      label: "Gantt",
      questions: [
        "How should I use the Gantt view?",
        "What is the difference between view mode and edit mode?",
        "How do date changes affect the project plan?",
      ],
    },
  },
  {
    test: (p) => /risks-blockers|\/risks(\b|\/)/.test(p),
    suggestion: {
      label: "Risks & Blockers",
      questions: [
        "What is the difference between a risk and a blocker?",
        "When should I create a blocker?",
        "How should I manage mitigation?",
      ],
    },
  },
  {
    test: (p) => /\/kpis?(\b|\/)/.test(p),
    suggestion: {
      label: "KPIs",
      questions: [
        "How should KPIs be defined?",
        "What is KPI update history?",
        "What is the difference between KPI target and current value?",
      ],
    },
  },
  {
    test: (p) => /governance/.test(p),
    suggestion: {
      label: "Governance",
      questions: [
        "What is governance cadence?",
        "How should I record governance evidence?",
        "What should I do if a governance review is overdue?",
      ],
    },
  },
  {
    test: (p) => /files|sharepoint|shared-files/.test(p) && !p.startsWith("/admin") && !p.startsWith("/projects/"),
    suggestion: {
      label: "Files",
      questions: [
        "How are files connected to BTPM?",
        "What should be stored in SharePoint versus BTPM?",
        "How should I link project files?",
      ],
    },
  },

  // --- Projects tabs (workspace-scoped tab pages) ---
  {
    test: (p) => p.startsWith("/projects/programs"),
    suggestion: {
      label: "Programs",
      questions: [
        "What is a program in BTPM?",
        "When should I group projects into a program?",
        "How is a program different from a project?",
      ],
    },
  },
  {
    test: (p) => p.startsWith("/projects/members"),
    suggestion: {
      label: "Workspace Members",
      questions: [
        "What is the Members tab for?",
        "How should workspace access be managed?",
        "Does workspace access grant every project?",
      ],
    },
  },
  {
    test: (p) => p.startsWith("/projects/sharepoint"),
    suggestion: {
      label: "Workspace SharePoint",
      questions: [
        "What is the workspace SharePoint tab for?",
        "How is workspace SharePoint different from project files?",
        "Why can't a user open a SharePoint folder?",
      ],
    },
  },

  // --- Generic Admin fallback ---
  {
    test: (p) => p.startsWith("/admin"),
    suggestion: {
      label: "Admin",
      questions: [
        "What can an Org Admin do?",
        "How should workspace access be managed?",
        "What is the difference between organization role and workspace role?",
      ],
    },
  },

  // --- Project index (must come before /projects and /workspace generic) ---
  {
    test: (p) => /^\/workspace\/[^/]+\/project\/[^/]+\/?$/.test(p),
    suggestion: {
      label: "Project Overview",
      questions: [
        "What should I do on the Project Overview?",
        "What should I check before generating a charter or status deck?",
        "What project information should stay up to date?",
      ],
    },
  },

  // --- Generic Projects / Workspace ---
  {
    test: (p) => p.startsWith("/projects") || /\/workspace\/[^/]+\/project/.test(p) || /\/workspace\/[^/]+/.test(p),
    suggestion: {
      label: "Projects",
      questions: [
        "How should I structure a project?",
        "What is the difference between Program, Project, Phase, and Task?",
        "What should I do on this page?",
      ],
    },
  },
  {
    test: (p) => p.startsWith("/my-work"),
    suggestion: {
      label: "My Work",
      questions: [
        "What is My Work?",
        "How should I prioritize my tasks?",
        "How do assignments work in BTPM?",
      ],
    },
  },
  {
    test: (p) => p.startsWith("/roadmap"),
    suggestion: {
      label: "Roadmap",
      questions: [
        "What does the Roadmap show?",
        "How should I use the Roadmap view?",
        "How do dates roll up to the Roadmap?",
      ],
    },
  },
];

const DEFAULT_SUGGESTION: RouteSuggestion = {
  label: "BTPM",
  questions: [
    "What is BTPM used for?",
    "How is BTPM structured?",
    "Where should I start?",
  ],
};

export function getRouteSuggestion(pathname: string): RouteSuggestion {
  for (const rule of SUGGESTION_RULES) {
    if (rule.test(pathname)) return rule.suggestion;
  }
  return DEFAULT_SUGGESTION;
}
