import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const data = [
  { lane: "ATL→DAL", loads: 142 },
  { lane: "LAX→PHX", loads: 121 },
  { lane: "CHI→IND", loads: 108 },
  { lane: "MIA→ORL", loads: 96 },
  { lane: "SEA→PDX", loads: 84 },
  { lane: "NYC→BOS", loads: 71 },
];

export function LaneVolumeChart() {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="lane" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            background: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            fontSize: 12,
          }}
          cursor={{ fill: "var(--color-accent)" }}
        />
        <Bar dataKey="loads" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}