import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TableColumn<T> {
  key: string;
  title: string;
  render: (row: T, index: number) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  rowKey: (row: T, index: number) => string;
  className?: string;
}

export function DataTable<T>({ columns, data, rowKey, className }: DataTableProps<T>) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border bg-white", className)}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={cn("px-4 py-3 font-semibold", column.className)}>
                  {column.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((row, index) => (
              <tr key={rowKey(row, index)} className="transition hover:bg-indigo-50/30">
                {columns.map((column) => (
                  <td key={column.key} className={cn("px-4 py-4 align-middle text-slate-700", column.className)}>
                    {column.render(row, index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
