import React from "react";

export function MarkdownTable({
  node: _node,
  children,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & { node?: unknown }) {
  return (
    <div className="markdown-table-scroll">
      <table {...props}>{children}</table>
    </div>
  );
}
