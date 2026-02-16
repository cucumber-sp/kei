export enum Severity {
  Error = "error",
  Warning = "warning",
  Info = "info",
}

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  offset: number;
}

export interface Diagnostic {
  severity: Severity;
  message: string;
  location: SourceLocation;
}
