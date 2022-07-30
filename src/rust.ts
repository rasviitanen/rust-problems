/* eslint-disable @typescript-eslint/naming-convention */
export interface Diagnostic {
    reason: "compiler-message",
    message: Message,
};

export interface Message {
    code: Code | null,
    children: Child[],
    level: "error" | "info" | "help" | "warning" | "note",
    message: "string",
    spans: Span[],
};

export interface Code {
    code: string,
    explanation: string | null,
};

export interface Child {
    children: Child[],
    code: string | null,
    level: "error" | "info" | "help" | "warning" | "note",
    message: string,
    spans: Span[],
};

export interface Span {
    byte_end: number,
    byte_start: number,
    column_end: number,
    column_start: number,
    label: string | null,
    file_name: string,
    line_end: number,
    line_start: number,
    suggested_replacement: string | null,
    suggestion_applicability: "MaybeIncorrect" | null,
};
