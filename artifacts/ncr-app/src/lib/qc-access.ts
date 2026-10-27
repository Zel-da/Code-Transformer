// Keep aligned with the QC-only API guards in routes/reports.ts.
export function canAccessQc(role: string | undefined): boolean {
  return role === "admin" || role === "reviewer" || role === "approver";
}
