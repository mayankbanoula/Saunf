"use client";

import { format, parseISO } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const axisTick = { fontSize: 11, fill: "var(--muted-foreground)" };
const tooltipStyle = {
  contentStyle: {
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--popover)",
    fontSize: 12,
    color: "var(--foreground)",
  },
  labelStyle: { color: "var(--muted-foreground)", marginBottom: 4 },
};

/** Created vs completed per day (one axis, two series; legend + tooltip; created is dashed). */
export function ThroughputChart({ data }: { data: { day: string; created: number; completed: number }[] }) {
  return (
    <div className="h-64 w-full" role="img" aria-label="Tasks created and completed per day">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="day"
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            tickFormatter={(d: string) => format(parseISO(d), "d MMM")}
            minTickGap={24}
          />
          <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            {...tooltipStyle}
            cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
            labelFormatter={(d) => format(parseISO(String(d)), "EEE d MMM yyyy")}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }} />
          <Line
            type="monotone"
            dataKey="created"
            name="Created"
            stroke="var(--chart-2)"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
          />
          <Line
            type="monotone"
            dataKey="completed"
            name="Completed"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Open work per person, split into on-track and overdue (stacked, thin bars). */
export function WorkloadChart({ data }: { data: { name: string; onTrack: number; overdue: number }[] }) {
  const height = Math.max(160, data.length * 30 + 48);
  return (
    <div style={{ height }} className="w-full" role="img" aria-label="Open tasks per person">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barCategoryGap={8}>
          <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" tick={axisTick} tickLine={false} axisLine={false} width={110} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "var(--muted)" }} />
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }} />
          <Bar dataKey="onTrack" name="Open, on track" stackId="a" fill="var(--chart-2)" stroke="var(--card)" strokeWidth={2} maxBarSize={16} />
          <Bar dataKey="overdue" name="Overdue" stackId="a" fill="var(--chart-3)" stroke="var(--card)" strokeWidth={2} radius={[0, 4, 4, 0]} maxBarSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
