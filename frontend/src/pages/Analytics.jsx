import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from 'recharts';
import { PageHeader, Card, SkeletonRows, EmptyState, Button } from '../components/ui.jsx';
import api from '../lib/api.js';

const COLORS = ['#00915a', '#22c55e', '#DC2626', '#CA8A04', '#0F1115'];

const nf = (n) => new Intl.NumberFormat('en-US').format(Number(n || 0));
const usd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n || 0));

const tooltipStyle = { borderRadius: '8px', border: '1px solid #E5E7EB', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' };

export default function Analytics() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get('/runs/analytics', { params: id ? { workflowId: id } : {} })
      .then((res) => {
        if (!cancelled) {
          setData(res.data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  const summary = data?.summary || {};
  const subtitle = useMemo(() => {
    if (summary.workflowName && summary.runCount != null) {
      const runs = summary.runCount === 1 ? '1 run' : `${summary.runCount} runs`;
      const when = summary.latestRun?.startedAt
        ? ` · latest ${new Date(summary.latestRun.startedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`
        : '';
      return `${summary.workflowName}${summary.period ? ` · ${summary.period}` : ''} · ${runs}${when}`;
    }
    return 'Enterprise reconciliation performance and deep insights';
  }, [summary]);

  if (loading) return <Card className="p-5"><SkeletonRows rows={10} cols={3} /></Card>;
  if (!data) return <div className="p-5">Could not load analytics.</div>;

  const KPI_METRICS = data.kpi || [];
  const TREND_DATA = data.trend || [];
  const ROOT_CAUSE_DATA = data.rootCause || [];
  const AGING_DATA = data.aging || [];
  const SYSTEM_VOLUME = data.systemVolume || [];
  const rootCauseTotal = ROOT_CAUSE_DATA.reduce((s, d) => s + (d.value || 0), 0);

  if (KPI_METRICS.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Intelligence & Analytics" subtitle={subtitle} />
        <EmptyState
          title="No processed analytics yet"
          message="The dashboard is built live from your reconciled runs — run a reconciliation first and the KPIs, trends, root causes, aging and per-source volumes will appear here."
          action={id ? <Link to={`/workflows/${id}/run`}><Button>▶ Go to Run</Button></Link> : null}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Intelligence & Analytics"
        subtitle={subtitle}
      />

      {/* KPI Section */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {KPI_METRICS.map((kpi, idx) => (
          <Card key={idx} className="p-5 flex flex-col justify-between hover:shadow-hover transition-all">
            <h3 className="text-small font-semibold text-ledger-meta uppercase tracking-wide">{kpi.label}</h3>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-ledger-ink">{kpi.value}</span>
              <span className="text-small text-ledger-meta font-medium">{kpi.secondary}</span>
            </div>
            <div className={`mt-3 text-[11px] font-semibold flex items-center gap-1 ${kpi.trendUp ? 'text-[#16A34A]' : 'text-ledger-brk'}`}>
              {kpi.trendUp ? '▲' : '▼'} {kpi.trend}
            </div>
          </Card>
        ))}
      </div>

      {/* Main Charts Area */}
      <div className="grid gap-6 lg:grid-cols-3">

        {/* Trend Area Chart spans 2 columns */}
        <Card className="p-5 lg:col-span-2">
          <h3 className="text-base font-semibold mb-4">Reconciliation Trends (last 6 months)</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={TREND_DATA} margin={{ top: 10, right: 30, left: 20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorMatched" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00915a" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#00915a" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorExceptions" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#DC2626" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#DC2626" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} dx={-10} tickFormatter={(val) => `${val / 1000}k`} />
                <RechartsTooltip
                  contentStyle={tooltipStyle}
                  formatter={(value, name) => [nf(value), name === 'matched' ? 'Successfully Matched' : name === 'exceptions' ? 'Exceptions (Breaks)' : name]}
                />
                <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px' }}/>
                <Area type="monotone" dataKey="matched" name="Successfully Matched" stroke="#00915a" strokeWidth={3} fillOpacity={1} fill="url(#colorMatched)" />
                <Area type="monotone" dataKey="exceptions" name="Exceptions (Breaks)" stroke="#DC2626" strokeWidth={3} fillOpacity={1} fill="url(#colorExceptions)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Donut Chart spans 1 column */}
        <Card className="p-5 lg:col-span-1">
          <h3 className="text-base font-semibold mb-4">Break Root Causes</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={ROOT_CAUSE_DATA}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {ROOT_CAUSE_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip
                  contentStyle={tooltipStyle}
                  formatter={(value, name) => {
                    const share = rootCauseTotal > 0 ? ((value / rootCauseTotal) * 100).toFixed(1) : '0';
                    return [`${nf(value)} (${share}%)`, name];
                  }}
                />
                <Legend layout="vertical" verticalAlign="middle" align="right" iconType="circle" wrapperStyle={{ fontSize: '12px' }}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* System Volume Radar Chart */}
        <Card className="p-5 lg:col-span-1">
          <h3 className="text-base font-semibold mb-4">Processing Volume by Source</h3>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="70%" data={SYSTEM_VOLUME}>
                <PolarGrid stroke="#E5E7EB" />
                <PolarAngleAxis dataKey="system" tick={{ fill: '#6B7280', fontSize: 10 }} />
                <PolarRadiusAxis angle={30} domain={[0, 'dataMax']} tick={false} axisLine={false} />
                <Radar name="Records processed" dataKey="volume" stroke="#00915a" strokeWidth={2} fill="#00915a" fillOpacity={0.4} />
                <RechartsTooltip
                  contentStyle={tooltipStyle}
                  formatter={(value, name, entry) => {
                    const p = entry?.payload || {};
                    return [`${nf(value)} records${p.amount ? ` · ${usd(p.amount)}` : ''}`, p.system || name];
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Aging Analysis Bar Chart spans 2 columns */}
        <Card className="p-5 lg:col-span-2">
          <h3 className="text-base font-semibold mb-4">Aging Analysis of Open Breaks</h3>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={AGING_DATA} margin={{ top: 20, right: 30, left: 20, bottom: 5 }} barSize={50}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="age" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} dx={-10} />
                <RechartsTooltip
                  cursor={{ fill: '#F3F4F6' }}
                  contentStyle={tooltipStyle}
                  formatter={(value, name) => [`${nf(value)} breaks`, name === 'volume' ? 'Number of Breaks' : name]}
                />
                <Bar dataKey="volume" name="Number of Breaks" fill="#00915a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

      </div>
    </div>
  );
}