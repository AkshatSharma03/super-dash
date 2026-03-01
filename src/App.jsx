import { useState, useRef, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from "recharts";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const P = ["#00AAFF","#F59E0B","#10B981","#EF4444","#8B5CF6","#F97316","#06B6D4","#94a3b8"];
const C = { cn:"#EF4444", ru:"#F59E0B", eu:"#10B981", us:"#8B5CF6", tr:"#F97316", uk:"#06B6D4", other:"#64748b" };

// ─────────────────────────────────────────────────────────────────────────────
// STATIC DATA  (modeled/estimated — see README for verified sources)
// ─────────────────────────────────────────────────────────────────────────────
const GDP_DATA = [
  {year:2010,gdp_bn:148,gdp_growth:7.3,gdp_per_capita:9070,digital_pct:1.4},
  {year:2011,gdp_bn:188,gdp_growth:7.5,gdp_per_capita:11380,digital_pct:1.6},
  {year:2012,gdp_bn:208,gdp_growth:5.0,gdp_per_capita:12390,digital_pct:1.8},
  {year:2013,gdp_bn:237,gdp_growth:6.0,gdp_per_capita:13890,digital_pct:2.0},
  {year:2014,gdp_bn:222,gdp_growth:4.3,gdp_per_capita:12810,digital_pct:2.1},
  {year:2015,gdp_bn:184,gdp_growth:1.2,gdp_per_capita:10510,digital_pct:2.1},
  {year:2016,gdp_bn:137,gdp_growth:1.1,gdp_per_capita:7715,digital_pct:2.3},
  {year:2017,gdp_bn:166,gdp_growth:4.1,gdp_per_capita:9246,digital_pct:2.5},
  {year:2018,gdp_bn:179,gdp_growth:4.1,gdp_per_capita:9814,digital_pct:2.8},
  {year:2019,gdp_bn:181,gdp_growth:4.5,gdp_per_capita:9813,digital_pct:3.0},
  {year:2020,gdp_bn:171,gdp_growth:-2.6,gdp_per_capita:9122,digital_pct:3.3},
  {year:2021,gdp_bn:197,gdp_growth:4.3,gdp_per_capita:10367,digital_pct:3.6},
  {year:2022,gdp_bn:225,gdp_growth:3.2,gdp_per_capita:11735,digital_pct:3.8},
  {year:2023,gdp_bn:261,gdp_growth:5.1,gdp_per_capita:13480,digital_pct:4.0},
  {year:2024,gdp_bn:278,gdp_growth:4.8,gdp_per_capita:14200,digital_pct:4.2},
];

const EXPORTS_DATA = [
  {year:2010,total:60.3,oil_gas:43.2,metals:8.1,chemicals:1.8,machinery:0.9,agriculture:2.1,other:4.2},
  {year:2012,total:86.9,oil_gas:62.4,metals:9.5,chemicals:2.4,machinery:1.2,agriculture:3.1,other:8.3},
  {year:2014,total:79.5,oil_gas:56.3,metals:9.6,chemicals:2.3,machinery:1.2,agriculture:3.0,other:7.1},
  {year:2016,total:36.7,oil_gas:23.1,metals:6.2,chemicals:1.6,machinery:0.9,agriculture:2.1,other:2.8},
  {year:2018,total:61.1,oil_gas:42.8,metals:8.7,chemicals:2.2,machinery:1.1,agriculture:2.9,other:3.4},
  {year:2020,total:48.4,oil_gas:30.6,metals:8.0,chemicals:2.0,machinery:1.1,agriculture:3.2,other:3.5},
  {year:2022,total:84.4,oil_gas:60.3,metals:10.2,chemicals:2.5,machinery:1.4,agriculture:4.1,other:5.9},
  {year:2024,total:82.0,oil_gas:56.0,metals:12.0,chemicals:3.0,machinery:1.8,agriculture:5.0,other:4.2},
];

const IMPORTS_DATA = [
  {year:2010,total:31.1,china:7.2,russia:10.4,eu:6.8,us:1.2,turkey:1.3,uk:0.9,other:3.3},
  {year:2012,total:46.4,china:10.5,russia:14.2,eu:9.3,us:1.8,turkey:2.0,uk:1.3,other:7.3},
  {year:2014,total:41.3,china:10.6,russia:12.9,eu:8.5,us:1.7,turkey:2.0,uk:1.2,other:4.4},
  {year:2016,total:25.4,china:7.8,russia:8.1,eu:5.0,us:1.0,turkey:1.2,uk:0.7,other:1.6},
  {year:2018,total:33.7,china:9.8,russia:10.5,eu:6.4,us:1.3,turkey:1.7,uk:1.0,other:3.0},
  {year:2020,total:31.7,china:10.6,russia:9.8,eu:5.5,us:1.2,turkey:1.6,uk:0.9,other:2.1},
  {year:2022,total:44.5,china:16.2,russia:10.8,eu:7.5,us:1.6,turkey:2.8,uk:1.2,other:4.4},
  {year:2024,total:51.0,china:20.0,russia:9.8,eu:8.5,us:1.9,turkey:3.3,uk:1.4,other:6.1},
];

const PIE_EXPORTS_2024 = [
  {name:"Oil & Gas",value:56},{name:"Metals",value:12},{name:"Agriculture",value:5},
  {name:"Chemicals",value:3},{name:"Machinery",value:1.8},{name:"Other",value:4.2},
];
const PIE_IMPORTS_2024 = [
  {name:"China",value:20},{name:"Russia",value:9.8},{name:"EU",value:8.5},
  {name:"Turkey",value:3.3},{name:"US",value:1.9},{name:"UK",value:1.4},{name:"Other",value:6.1},
];
const TRADE_BALANCE = EXPORTS_DATA.map((e,i)=>({
  year:e.year, exports:e.total, imports:IMPORTS_DATA[i].total,
  balance:+(e.total-IMPORTS_DATA[i].total).toFixed(1),
}));

// ─────────────────────────────────────────────────────────────────────────────
// SHARED CHART STYLE DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────
const TT  = {contentStyle:{background:"#0f1117",border:"1px solid #2d3348",borderRadius:8,fontSize:12}};
const GRID = {strokeDasharray:"3 3",stroke:"#2d3348"};
const AX   = {fill:"#64748b",fontSize:11};
const LEG  = {wrapperStyle:{fontSize:12}};

// ─────────────────────────────────────────────────────────────────────────────
// UI PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────
function Btn({onClick,children,active,style={},disabled=false}){
  return(
    <button onClick={onClick} disabled={disabled} style={{
      background:active?"#00AAFF":"#1e2130", color:active?"#fff":"#94a3b8",
      border:"1px solid "+(active?"#00AAFF":"#2d3348"), borderRadius:7,
      padding:"6px 14px", fontSize:12, fontWeight:600,
      cursor:disabled?"not-allowed":"pointer", opacity:disabled?0.5:1,
      transition:"all .15s", ...style,
    }}>{children}</button>
  );
}

function KPI({label,value,sub,color="#00AAFF",trend}){
  const up = trend&&(trend.startsWith("+")||trend.startsWith("↑"));
  return(
    <div style={{background:"#1e2130",borderRadius:12,padding:"14px 16px",border:"1px solid #2d3348"}}>
      <p style={{margin:"0 0 4px",fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:1}}>{label}</p>
      <p style={{margin:"0 0 2px",fontSize:22,fontWeight:800,color}}>{value}</p>
      <p style={{margin:"0 0 2px",fontSize:11,color:"#94a3b8"}}>{sub}</p>
      {trend&&<p style={{margin:0,fontSize:11,color:up?"#10B981":"#EF4444"}}>{trend}</p>}
    </div>
  );
}

function Card({title,children}){
  return(
    <div style={{background:"#1e2130",borderRadius:12,padding:18,border:"1px solid #2d3348",marginBottom:18}}>
      <h3 style={{margin:"0 0 14px",fontSize:13,color:"#94a3b8",fontWeight:600}}>{title}</h3>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKDOWN RENDERER  (used by Search mode)
// ─────────────────────────────────────────────────────────────────────────────
function RenderInline({ text }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**")
          ? <strong key={i} style={{ color: "#e2e8f0" }}>{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

function MarkdownText({ text }) {
  if (!text) return <span style={{ color: "#64748b" }}>No content.</span>;
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // H2/H3 headings
    if (/^#{2,3}\s/.test(line)) {
      out.push(
        <h4 key={i} style={{ margin: "16px 0 8px", color: "#e2e8f0", fontSize: 14, fontWeight: 700 }}>
          <RenderInline text={line.replace(/^#+\s/, "")} />
        </h4>
      );
      i++; continue;
    }

    // Bold-only line (acts as subheading)
    if (/^\*\*[^*]+\*\*:?$/.test(line.trim())) {
      out.push(
        <h4 key={i} style={{ margin: "14px 0 6px", color: "#e2e8f0", fontSize: 13, fontWeight: 700 }}>
          {line.replace(/\*\*/g, "")}
        </h4>
      );
      i++; continue;
    }

    // Bullet list
    if (/^[-•*]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-•*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-•*]\s/, ""));
        i++;
      }
      out.push(
        <ul key={`ul${i}`} style={{ margin: "6px 0 10px", paddingLeft: 20 }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ color: "#cbd5e1", fontSize: 14, lineHeight: 1.7, marginBottom: 3 }}>
              <RenderInline text={item} />
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      out.push(
        <ol key={`ol${i}`} style={{ margin: "6px 0 10px", paddingLeft: 20 }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ color: "#cbd5e1", fontSize: 14, lineHeight: 1.7, marginBottom: 3 }}>
              <RenderInline text={item} />
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Regular paragraph
    out.push(
      <p key={i} style={{ margin: "0 0 10px", fontSize: 14, color: "#cbd5e1", lineHeight: 1.75 }}>
        <RenderInline text={line} />
      </p>
    );
    i++;
  }
  return <div>{out}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC CHART RENDERER  (used by AI Chat and Data modes)
// ─────────────────────────────────────────────────────────────────────────────
function DynChart({chart}){
  const {type,data,xKey,series=[]} = chart;
  if(!data?.length) return <p style={{color:"#64748b",fontSize:13}}>No data.</p>;
  const h = 270;

  if(type==="pie") return(
    <ResponsiveContainer width="100%" height={h}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
          outerRadius={95} label={({name,value})=>`${name}: ${value}`} labelLine>
          {data.map((_,i)=><Cell key={i} fill={P[i%P.length]}/>)}
        </Pie>
        <Tooltip {...TT}/><Legend {...LEG}/>
      </PieChart>
    </ResponsiveContainer>
  );

  if(type==="radar") return(
    <ResponsiveContainer width="100%" height={h}>
      <RadarChart data={data} cx="50%" cy="50%" outerRadius={90}>
        <PolarGrid stroke="#2d3348"/>
        <PolarAngleAxis dataKey={xKey||"label"} tick={AX}/>
        <Tooltip {...TT}/><Legend {...LEG}/>
        {series.map((s,i)=>(
          <Radar key={s.key} name={s.name} dataKey={s.key}
            stroke={s.color||P[i]} fill={s.color||P[i]} fillOpacity={0.25}/>
        ))}
      </RadarChart>
    </ResponsiveContainer>
  );

  if(type==="composed") return(
    <ResponsiveContainer width="100%" height={h}>
      <ComposedChart data={data} margin={{top:5,right:20,left:0,bottom:5}}>
        <CartesianGrid {...GRID}/>
        <XAxis dataKey={xKey} tick={AX}/>
        <YAxis yAxisId="left" tick={AX}/>
        <YAxis yAxisId="right" orientation="right" tick={AX}/>
        <Tooltip {...TT}/><Legend {...LEG}/>
        {series.map((s,i)=>s.chartType==="bar"
          ?<Bar key={s.key} yAxisId="left" dataKey={s.key} name={s.name} fill={s.color||P[i]} opacity={0.8} radius={[3,3,0,0]}/>
          :<Line key={s.key} yAxisId={s.rightAxis?"right":"left"} type="monotone" dataKey={s.key} name={s.name} stroke={s.color||P[i]} strokeWidth={2.5} dot={{r:3}}/>
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );

  if(type==="area") return(
    <ResponsiveContainer width="100%" height={h}>
      <AreaChart data={data} margin={{top:5,right:20,left:0,bottom:5}}>
        <CartesianGrid {...GRID}/>
        <XAxis dataKey={xKey} tick={AX}/><YAxis tick={AX}/>
        <Tooltip {...TT}/><Legend {...LEG}/>
        {series.map((s,i)=>(
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.name}
            stroke={s.color||P[i]} fill={(s.color||P[i])+"33"} strokeWidth={2}
            stackId={s.stacked?"a":undefined}/>
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );

  if(type==="bar") return(
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} margin={{top:5,right:20,left:0,bottom:5}}>
        <CartesianGrid {...GRID}/>
        <XAxis dataKey={xKey} tick={AX}/><YAxis tick={AX}/>
        <Tooltip {...TT}/><Legend {...LEG}/>
        {series.map((s,i)=>(
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color||P[i]}
            stackId={s.stacked?"a":undefined} radius={!s.stacked?[3,3,0,0]:undefined}/>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );

  // default: line
  return(
    <ResponsiveContainer width="100%" height={h}>
      <LineChart data={data} margin={{top:5,right:20,left:0,bottom:5}}>
        <CartesianGrid {...GRID}/>
        <XAxis dataKey={xKey} tick={AX}/><YAxis tick={AX}/>
        <Tooltip {...TT}/><Legend {...LEG}/>
        {series.map((s,i)=>(
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.name}
            stroke={s.color||P[i]} strokeWidth={2.5} dot={{r:3}} connectNulls/>
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// API CALLS  (proxied through /api/* — key stays server-side)
// ─────────────────────────────────────────────────────────────────────────────
async function askClaude(messages){
  const res = await fetch("/api/chat",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({messages}),
  });
  if(!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function performWebSearch(query) {
  const res = await fetch("/api/search",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({query}),
  });
  if(!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV PARSER
// ─────────────────────────────────────────────────────────────────────────────
function parseCSV(raw) {
  const lines = raw.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };

  const parseLine = line => {
    const cols = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (line[i] === "," && !inQ) {
        cols.push(cur.trim()); cur = "";
      } else cur += line[i];
    }
    cols.push(cur.trim());
    return cols;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).filter(l => l.trim()).map(l => {
    const vals = parseLine(l);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  });
  return { headers, rows };
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV → CLAUDE CHART ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────
async function analyzeCSVData(headers, rows, context) {
  const res = await fetch("/api/analyze-csv",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({headers,rows,context}),
  });
  if(!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD MODE
// ─────────────────────────────────────────────────────────────────────────────
const DASH_TABS = ["GDP","Exports","Imports","Trade Balance"];

function DashboardMode({yearRange,setYearRange}){
  const [tab,setTab] = useState("GDP");
  const yr = d => d.filter(r=>r.year>=yearRange[0]&&r.year<=yearRange[1]);
  const gdp=yr(GDP_DATA), exp=yr(EXPORTS_DATA), imp=yr(IMPORTS_DATA), bal=yr(TRADE_BALANCE);

  return(
    <>
      {/* KPI cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:18}}>
        <KPI label="GDP 2024"      value="$278B"   sub="Nominal USD"           trend="+$17B YoY"      color="#00AAFF"/>
        <KPI label="GDP Growth"    value="4.8%"    sub="Real 2024"             trend="↑ Accelerating" color="#10B981"/>
        <KPI label="GDP/Capita"    value="$14.2K"  sub="2024 estimate"         trend="+5.3% YoY"      color="#8B5CF6"/>
        <KPI label="Total Exports" value="$82B"    sub="2024"                  trend="+3.7% YoY"      color="#F59E0B"/>
        <KPI label="Total Imports" value="$51B"    sub="2024"                  trend="+6.0% YoY"      color="#EF4444"/>
        <KPI label="Trade Surplus" value="+$31B"   sub="2024"                  trend="↑ Oil-driven"   color="#06B6D4"/>
        <KPI label="Digital GDP%"  value="4.2%"    sub="of total GDP"          trend="+0.2pp YoY"     color="#F97316"/>
        <KPI label="#1 Importer"   value="China"   sub="$20B · 39% share"                             color="#EF4444"/>
      </div>

      {/* Sub-tabs */}
      <div style={{display:"flex",gap:4,marginBottom:18,background:"#1e2130",borderRadius:10,padding:4,width:"fit-content"}}>
        {DASH_TABS.map(t=><Btn key={t} onClick={()=>setTab(t)} active={tab===t} style={{fontSize:12}}>{t}</Btn>)}
      </div>

      {/* GDP */}
      {tab==="GDP"&&<>
        <Card title="GDP (Nominal $B) vs Digital Economy Share (%)">
          <ResponsiveContainer width="100%" height={270}>
            <ComposedChart data={gdp} margin={{top:5,right:30,left:0,bottom:5}}>
              <CartesianGrid {...GRID}/>
              <XAxis dataKey="year" tick={AX}/>
              <YAxis yAxisId="left" tick={AX}/><YAxis yAxisId="right" orientation="right" tick={AX}/>
              <Tooltip {...TT}/><Legend {...LEG}/>
              <Bar yAxisId="left" dataKey="gdp_bn" name="GDP ($B)" fill="#00AAFF" opacity={0.75} radius={[3,3,0,0]}/>
              <Line yAxisId="right" type="monotone" dataKey="digital_pct" name="Digital % GDP" stroke="#F97316" strokeWidth={2.5} dot={{r:4}}/>
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
          <Card title="Real GDP Growth Rate (%)">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={gdp} margin={{top:5,right:10,left:0,bottom:5}}>
                <CartesianGrid {...GRID}/>
                <XAxis dataKey="year" tick={AX}/><YAxis tick={AX}/>
                <Tooltip {...TT}/>
                <Bar dataKey="gdp_growth" name="Growth %">
                  {gdp.map((d,i)=><Cell key={i} fill={d.gdp_growth<0?"#EF4444":"#10B981"}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <Card title="GDP Per Capita (USD)">
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={gdp} margin={{top:5,right:10,left:0,bottom:5}}>
                <CartesianGrid {...GRID}/>
                <XAxis dataKey="year" tick={AX}/><YAxis tick={AX}/>
                <Tooltip {...TT}/>
                <Area type="monotone" dataKey="gdp_per_capita" name="GDP/Capita ($)" stroke="#8B5CF6" fill="#8B5CF622" strokeWidth={2}/>
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </>}

      {/* Exports */}
      {tab==="Exports"&&<>
        <Card title="Export Composition by Sector ($B)">
          <ResponsiveContainer width="100%" height={270}>
            <BarChart data={exp} margin={{top:5,right:20,left:0,bottom:5}}>
              <CartesianGrid {...GRID}/>
              <XAxis dataKey="year" tick={AX}/><YAxis tick={AX}/>
              <Tooltip {...TT}/><Legend {...LEG}/>
              {[
                ["oil_gas","Oil & Gas","#F59E0B"],["metals","Metals","#94a3b8"],
                ["agriculture","Agriculture","#10B981"],["chemicals","Chemicals","#8B5CF6"],
                ["machinery","Machinery","#06B6D4"],["other","Other","#64748b"],
              ].map(([k,n,c],i,arr)=>(
                <Bar key={k} dataKey={k} name={n} stackId="a" fill={c}
                  radius={i===arr.length-1?[3,3,0,0]:[0,0,0,0]}/>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
          <Card title="2024 Export Breakdown">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={PIE_EXPORTS_2024} dataKey="value" nameKey="name"
                  cx="50%" cy="50%" outerRadius={80} label={({name,value})=>`${name}: $${value}B`} labelLine>
                  {PIE_EXPORTS_2024.map((_,i)=><Cell key={i} fill={P[i%P.length]}/>)}
                </Pie>
                <Tooltip {...TT}/>
              </PieChart>
            </ResponsiveContainer>
          </Card>
          <Card title="Total Exports Over Time ($B)">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={exp} margin={{top:5,right:10,left:0,bottom:5}}>
                <CartesianGrid {...GRID}/>
                <XAxis dataKey="year" tick={AX}/><YAxis tick={AX}/>
                <Tooltip {...TT}/>
                <Area type="monotone" dataKey="total" name="Total Exports ($B)" stroke="#00AAFF" fill="#00AAFF22" strokeWidth={2.5}/>
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </>}

      {/* Imports */}
      {tab==="Imports"&&<>
        <Card title="Imports by Partner ($B) — Stacked">
          <ResponsiveContainer width="100%" height={270}>
            <AreaChart data={imp} margin={{top:5,right:20,left:0,bottom:5}}>
              <CartesianGrid {...GRID}/>
              <XAxis dataKey="year" tick={AX}/><YAxis tick={AX}/>
              <Tooltip {...TT}/><Legend {...LEG}/>
              {[["china","China",C.cn],["russia","Russia",C.ru],["eu","EU",C.eu],
                ["turkey","Turkey",C.tr],["us","US",C.us],["uk","UK",C.uk],["other","Other",C.other]
              ].map(([k,n,c])=>(
                <Area key={k} type="monotone" dataKey={k} name={n}
                  stackId="a" stroke={c} fill={c+"55"} strokeWidth={1.5}/>
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
          <Card title="China vs Russia vs EU ($B)">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={imp} margin={{top:5,right:10,left:0,bottom:5}}>
                <CartesianGrid {...GRID}/>
                <XAxis dataKey="year" tick={AX}/><YAxis tick={AX}/>
                <Tooltip {...TT}/><Legend {...LEG}/>
                <Line type="monotone" dataKey="china"  name="China"  stroke={C.cn} strokeWidth={2.5} dot={{r:4}}/>
                <Line type="monotone" dataKey="russia" name="Russia" stroke={C.ru} strokeWidth={2.5} dot={{r:4}}/>
                <Line type="monotone" dataKey="eu"     name="EU"     stroke={C.eu} strokeWidth={2.5} dot={{r:4}}/>
              </LineChart>
            </ResponsiveContainer>
          </Card>
          <Card title="2024 Import Share by Partner">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={PIE_IMPORTS_2024} dataKey="value" nameKey="name"
                  cx="50%" cy="50%" outerRadius={80} label={({name,value})=>`${name}: $${value}B`} labelLine>
                  {PIE_IMPORTS_2024.map((_,i)=><Cell key={i} fill={P[i%P.length]}/>)}
                </Pie>
                <Tooltip {...TT}/>
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </>}

      {/* Trade Balance */}
      {tab==="Trade Balance"&&<>
        <Card title="Exports vs Imports vs Trade Balance ($B)">
          <ResponsiveContainer width="100%" height={270}>
            <ComposedChart data={bal} margin={{top:5,right:20,left:0,bottom:5}}>
              <CartesianGrid {...GRID}/>
              <XAxis dataKey="year" tick={AX}/><YAxis tick={AX}/>
              <Tooltip {...TT}/><Legend {...LEG}/>
              <Bar dataKey="exports" name="Exports ($B)" fill="#00AAFF" opacity={0.8} radius={[3,3,0,0]}/>
              <Bar dataKey="imports" name="Imports ($B)" fill="#EF4444" opacity={0.8} radius={[3,3,0,0]}/>
              <Line type="monotone" dataKey="balance" name="Balance ($B)" stroke="#10B981" strokeWidth={2.5} dot={{r:4}}/>
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Annual Trade Surplus / Deficit ($B)">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={bal} margin={{top:5,right:20,left:0,bottom:5}}>
              <CartesianGrid {...GRID}/>
              <XAxis dataKey="year" tick={AX}/><YAxis tick={AX}/>
              <Tooltip {...TT}/>
              <Bar dataKey="balance" name="Balance ($B)" radius={[3,3,0,0]}>
                {bal.map((d,i)=><Cell key={i} fill={d.balance>=0?"#10B981":"#EF4444"}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </>}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI CHAT MODE
// ─────────────────────────────────────────────────────────────────────────────
const SUGGESTIONS = [
  "Show Kazakhstan's GDP growth vs oil prices 2010–2024",
  "Compare imports from China, Russia and EU over time",
  "What are Kazakhstan's top export sectors?",
  "How has China's import share grown vs Russia's decline?",
  "Show Kazakhstan's digital economy trajectory",
  "Analyze Central Asia economic competitiveness",
  "Trade balance surplus trend and drivers",
  "Kazakhstan AI governance and tech investment outlook",
];

function ChatMessage({msg,onFollowUp}){
  if(msg.role==="user") return(
    <div style={{display:"flex",justifyContent:"flex-end",marginBottom:14}}>
      <div style={{background:"#00AAFF",color:"#fff",borderRadius:"12px 12px 3px 12px",padding:"10px 16px",maxWidth:"72%",fontSize:14}}>
        {msg.content}
      </div>
    </div>
  );

  const {insight,charts=[],sources=[],followUps=[],error} = msg.content||{};
  return(
    <div style={{marginBottom:22}}>
      {insight&&(
        <div style={{background:"#1e2130",border:"1px solid #2d3348",borderRadius:12,padding:16,marginBottom:14}}>
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:15}}>🤖</span>
            <span style={{fontSize:11,color:"#00AAFF",fontWeight:700,textTransform:"uppercase"}}>Analysis</span>
          </div>
          <p style={{margin:0,fontSize:14,color:"#cbd5e1",lineHeight:1.75}}>{insight}</p>
        </div>
      )}
      {error&&(
        <div style={{background:"#EF444422",border:"1px solid #EF4444",borderRadius:10,padding:14,marginBottom:14,fontSize:13,color:"#EF4444"}}>
          {error}
        </div>
      )}
      {charts.map(chart=>(
        <div key={chart.id} style={{background:"#1e2130",border:"1px solid #2d3348",borderRadius:12,padding:18,marginBottom:12}}>
          <h3 style={{margin:"0 0 4px",fontSize:14,color:"#e2e8f0",fontWeight:600}}>{chart.title}</h3>
          {chart.description&&<p style={{margin:"0 0 12px",fontSize:12,color:"#64748b"}}>{chart.description}</p>}
          <DynChart chart={chart}/>
        </div>
      ))}
      {sources?.length>0&&(
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
          <span style={{fontSize:11,color:"#64748b"}}>Sources:</span>
          {sources.map((s,i)=>(
            <span key={i} style={{fontSize:11,color:"#64748b",background:"#1e2130",border:"1px solid #2d3348",borderRadius:4,padding:"2px 8px"}}>{s}</span>
          ))}
        </div>
      )}
      {followUps?.length>0&&(
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {followUps.map((q,i)=>(
            <button key={i} onClick={()=>onFollowUp(q)}
              style={{background:"transparent",border:"1px solid #2d3348",borderRadius:20,padding:"5px 12px",fontSize:12,color:"#94a3b8",cursor:"pointer",transition:"all .15s"}}
              onMouseEnter={e=>{e.target.style.borderColor="#00AAFF";e.target.style.color="#00AAFF";}}
              onMouseLeave={e=>{e.target.style.borderColor="#2d3348";e.target.style.color="#94a3b8";}}>
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatMode(){
  const [messages,setMessages] = useState([]);
  const [input,setInput] = useState("");
  const [loading,setLoading] = useState(false);
  const bottomRef = useRef();
  const inputRef = useRef();

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[messages,loading]);

  const send = async(query)=>{
    if(!query.trim()||loading) return;
    const q=query.trim(); setInput("");
    setMessages(prev=>[...prev,{role:"user",content:q}]);
    setLoading(true);
    try{
      const history = messages.map(m=>({
        role:m.role,
        content:m.role==="user"?m.content:JSON.stringify(m.content),
      }));
      history.push({role:"user",content:q});
      const result = await askClaude(history);
      setMessages(prev=>[...prev,{role:"assistant",content:result}]);
    }catch(e){
      setMessages(prev=>[...prev,{role:"assistant",content:{error:"Error: "+e.message,charts:[],followUps:[]}}]);
    }
    setLoading(false);
  };

  const isEmpty = messages.length===0;

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{flex:1,overflowY:"auto",paddingBottom:8}}>
        {isEmpty?(
          <div style={{maxWidth:680,margin:"0 auto",paddingTop:20}}>
            <div style={{textAlign:"center",marginBottom:28}}>
              <div style={{fontSize:40,marginBottom:10}}>💬</div>
              <h2 style={{margin:"0 0 8px",fontSize:18,fontWeight:800,color:"#fff"}}>Ask anything about Kazakhstan's economy</h2>
              <p style={{margin:0,fontSize:13,color:"#64748b",lineHeight:1.6}}>
                I generate real charts and expert analysis from World Bank, IMF, UN Comtrade, and policy data.<br/>
                Every visualization is built from your query — nothing is pre-loaded.
              </p>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {SUGGESTIONS.map((s,i)=>(
                <button key={i} onClick={()=>send(s)}
                  style={{background:"#1e2130",border:"1px solid #2d3348",borderRadius:10,padding:"12px 14px",fontSize:13,color:"#94a3b8",cursor:"pointer",textAlign:"left",lineHeight:1.4,transition:"all .15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor="#00AAFF";e.currentTarget.style.color="#e2e8f0";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor="#2d3348";e.currentTarget.style.color="#94a3b8";}}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ):(
          <div style={{maxWidth:820,margin:"0 auto"}}>
            {messages.map((m,i)=>(
              <ChatMessage key={i} msg={m} onFollowUp={q=>{setInput(q);inputRef.current?.focus();}}/>
            ))}
            {loading&&(
              <div style={{background:"#1e2130",border:"1px solid #2d3348",borderRadius:12,padding:"14px 18px",display:"inline-flex",gap:10,alignItems:"center",marginBottom:16}}>
                <span style={{fontSize:14}}>🤖</span>
                <span style={{fontSize:13,color:"#64748b"}}>Generating charts and analysis…</span>
                <span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>⏳</span>
              </div>
            )}
            <div ref={bottomRef}/>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div style={{borderTop:"1px solid #1e2130",paddingTop:14,flexShrink:0}}>
        <div style={{maxWidth:820,margin:"0 auto",display:"flex",gap:10}}>
          {messages.length>0&&(
            <button onClick={()=>setMessages([])}
              style={{background:"transparent",border:"1px solid #2d3348",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#64748b",cursor:"pointer",whiteSpace:"nowrap"}}>
              Clear
            </button>
          )}
          <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send(input)}
            placeholder="Ask about GDP, trade flows, imports, exports, digital economy, AI governance…"
            disabled={loading}
            style={{flex:1,background:"#1e2130",border:"1px solid #2d3348",borderRadius:10,padding:"11px 16px",color:"#e2e8f0",fontSize:13,outline:"none",transition:"border-color .15s"}}
            onFocus={e=>e.target.style.borderColor="#00AAFF"}
            onBlur={e=>e.target.style.borderColor="#2d3348"}/>
          <button onClick={()=>send(input)} disabled={loading||!input.trim()}
            style={{background:loading||!input.trim()?"#1e2130":"#00AAFF",border:"none",borderRadius:10,padding:"11px 20px",color:loading||!input.trim()?"#334155":"#fff",fontSize:13,fontWeight:700,cursor:loading||!input.trim()?"not-allowed":"pointer",transition:"all .15s",whiteSpace:"nowrap"}}>
            {loading?"⏳":"Generate →"}
          </button>
        </div>
        <p style={{textAlign:"center",fontSize:11,color:"#334155",marginTop:8}}>
          Powered by Claude · Data: World Bank · IMF · UN Comtrade · stat.gov.kz · Press Enter to send
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH MODE
// ─────────────────────────────────────────────────────────────────────────────
const SEARCH_SUGGESTIONS = [
  "Kazakhstan GDP growth forecast 2025",
  "Kazakhstan oil and gas exports latest data",
  "Foreign direct investment Kazakhstan 2024",
  "China Kazakhstan trade relationship growth",
  "Kazakhstan inflation and interest rate policy",
  "Kazakhstan digital economy and fintech sector",
  "Central Asia Belt and Road Initiative economic impact",
  "Kazakhstan sovereign wealth fund and capital markets",
];

function SearchMode() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState("");
  const [followQuery, setFollowQuery] = useState("");

  const doSearch = async q => {
    if (!q?.trim() || loading) return;
    const trimmed = q.trim();
    setLoading(true);
    setResult(null);
    setError(null);
    setSearched(trimmed);
    setQuery("");
    setFollowQuery("");
    try {
      const res = await performWebSearch(trimmed);
      setResult(res);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      {/* Search bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && doSearch(query)}
          disabled={loading}
          placeholder="Search for Kazakhstan economic data, news, trade stats from the web…"
          style={{
            flex: 1, background: "#1e2130", border: "1px solid #2d3348",
            borderRadius: 10, padding: "12px 16px", color: "#e2e8f0",
            fontSize: 14, outline: "none", transition: "border-color .15s",
          }}
          onFocus={e => e.target.style.borderColor = "#10B981"}
          onBlur={e => e.target.style.borderColor = "#2d3348"}
        />
        <button
          onClick={() => doSearch(query)}
          disabled={loading || !query.trim()}
          style={{
            background: loading || !query.trim() ? "#1e2130" : "#10B981",
            border: "none", borderRadius: 10, padding: "12px 22px",
            color: loading || !query.trim() ? "#334155" : "#fff",
            fontSize: 14, fontWeight: 700,
            cursor: loading || !query.trim() ? "not-allowed" : "pointer",
            transition: "all .15s", whiteSpace: "nowrap",
          }}>
          {loading ? "⏳" : "🔍 Search"}
        </button>
      </div>

      {/* Suggestions (shown when no result yet) */}
      {!result && !loading && !error && (
        <>
          <p style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>Suggested searches:</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 24 }}>
            {SEARCH_SUGGESTIONS.map((s, i) => (
              <button key={i} onClick={() => doSearch(s)}
                style={{
                  background: "#1e2130", border: "1px solid #2d3348", borderRadius: 8,
                  padding: "10px 14px", fontSize: 12, color: "#94a3b8",
                  cursor: "pointer", textAlign: "left", lineHeight: 1.4, transition: "all .15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "#10B981"; e.currentTarget.style.color = "#e2e8f0"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#2d3348"; e.currentTarget.style.color = "#94a3b8"; }}>
                {s}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{
          background: "#1e2130", border: "1px solid #10B98144",
          borderRadius: 12, padding: "22px 24px",
          display: "flex", alignItems: "center", gap: 16,
        }}>
          <span style={{ animation: "spin 1.8s linear infinite", display: "inline-block", fontSize: 22 }}>🔍</span>
          <div>
            <p style={{ margin: "0 0 4px", fontSize: 14, color: "#e2e8f0", fontWeight: 600 }}>
              Searching the web…
            </p>
            <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
              Querying World Bank, IMF, Reuters, Bloomberg and authoritative sources
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: "#EF444422", border: "1px solid #EF4444",
          borderRadius: 10, padding: 16, fontSize: 13, color: "#EF4444",
        }}>
          <strong>Search error:</strong> {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div>
          {/* Result header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 11,
              background: result.webSearchUsed ? "#10B98122" : "#F59E0B22",
              color: result.webSearchUsed ? "#10B981" : "#F59E0B",
              border: `1px solid ${result.webSearchUsed ? "#10B98144" : "#F59E0B44"}`,
              borderRadius: 5, padding: "2px 10px", fontWeight: 600,
            }}>
              {result.webSearchUsed ? "🌐 Live Web Search" : "📚 Model Knowledge"}
            </span>
            <span style={{ fontSize: 12, color: "#64748b", fontStyle: "italic" }}>
              "{searched}"
            </span>
            <button
              onClick={() => { setResult(null); setError(null); setSearched(""); }}
              style={{
                marginLeft: "auto", background: "transparent",
                border: "1px solid #2d3348", borderRadius: 6,
                padding: "4px 12px", fontSize: 11, color: "#64748b", cursor: "pointer",
              }}>
              Clear
            </button>
          </div>

          {/* Main summary card */}
          <div style={{
            background: "#1e2130",
            border: `1px solid ${result.webSearchUsed ? "#10B98133" : "#F59E0B33"}`,
            borderRadius: 12, padding: 22, marginBottom: 14,
          }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 16 }}>🌐</span>
              <span style={{
                fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                color: result.webSearchUsed ? "#10B981" : "#F59E0B",
              }}>
                Research Summary
              </span>
              {!result.webSearchUsed && (
                <span style={{
                  fontSize: 10, color: "#F59E0B", background: "#F59E0B11",
                  border: "1px solid #F59E0B33", borderRadius: 4, padding: "1px 7px",
                }}>
                  Training data — may be outdated
                </span>
              )}
            </div>
            <MarkdownText text={result.text} />
          </div>

          {/* Sources */}
          {result.sources?.length > 0 && (
            <div style={{
              background: "#1e2130", border: "1px solid #2d3348",
              borderRadius: 10, padding: 16, marginBottom: 16,
            }}>
              <p style={{ margin: "0 0 10px", fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>
                Sources ({result.sources.length})
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {result.sources.slice(0, 8).map((s, i) => (
                  s.url
                    ? <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                        style={{
                          fontSize: 12, color: "#00AAFF", textDecoration: "none",
                          display: "flex", alignItems: "flex-start", gap: 6,
                        }}
                        onMouseEnter={e => e.currentTarget.style.textDecoration = "underline"}
                        onMouseLeave={e => e.currentTarget.style.textDecoration = "none"}>
                        <span style={{ color: "#64748b", flexShrink: 0 }}>↗</span>
                        {s.title}
                      </a>
                    : <span key={i} style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 6 }}>
                        <span>📚</span>{s.title}
                      </span>
                ))}
              </div>
            </div>
          )}

          {/* Follow-up search */}
          <div style={{
            background: "#1e2130", border: "1px solid #2d3348",
            borderRadius: 10, padding: 14,
          }}>
            <p style={{ margin: "0 0 10px", fontSize: 11, color: "#64748b", fontWeight: 600 }}>
              Search again or refine:
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                value={followQuery}
                onChange={e => setFollowQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && doSearch(followQuery)}
                disabled={loading}
                placeholder="Enter a follow-up or related search…"
                style={{
                  flex: 1, background: "#0f1117", border: "1px solid #2d3348",
                  borderRadius: 8, padding: "9px 14px", color: "#e2e8f0",
                  fontSize: 13, outline: "none",
                }}
                onFocus={e => e.target.style.borderColor = "#10B981"}
                onBlur={e => e.target.style.borderColor = "#2d3348"}
              />
              <button
                onClick={() => doSearch(followQuery)}
                disabled={loading || !followQuery.trim()}
                style={{
                  background: loading || !followQuery.trim() ? "#0f1117" : "#10B981",
                  border: "none", borderRadius: 8, padding: "9px 18px",
                  color: loading || !followQuery.trim() ? "#334155" : "#fff",
                  fontSize: 13, fontWeight: 700,
                  cursor: loading || !followQuery.trim() ? "not-allowed" : "pointer",
                }}>
                Search
              </button>
            </div>
          </div>
        </div>
      )}

      <p style={{ textAlign: "center", fontSize: 11, color: "#334155", marginTop: 20 }}>
        Powered by Claude · Web search via Anthropic · Sources: World Bank · IMF · Reuters · Bloomberg
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA UPLOAD MODE
// ─────────────────────────────────────────────────────────────────────────────
function DataMode() {
  const [file, setFile] = useState(null);
  const [csv, setCsv] = useState(null);
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  const handleFile = f => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a .csv file."); return;
    }
    setFile(f);
    setResult(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = e => {
      const parsed = parseCSV(e.target.result);
      if (!parsed.headers.length) {
        setError("Could not parse CSV — ensure it has a header row."); return;
      }
      setCsv(parsed);
    };
    reader.readAsText(f);
  };

  const generate = async () => {
    if (!csv || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await analyzeCSVData(csv.headers, csv.rows, context);
      setResult(res);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const reset = () => {
    setFile(null); setCsv(null); setResult(null);
    setError(null); setContext("");
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>

      {/* Drop zone (shown when no file loaded) */}
      {!csv && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? "#F59E0B" : "#2d3348"}`,
            borderRadius: 16, padding: "60px 24px", textAlign: "center",
            cursor: "pointer", transition: "all .2s", marginBottom: 16,
            background: dragOver ? "#F59E0B0a" : "#1e2130",
          }}>
          <input
            ref={fileRef} type="file" accept=".csv"
            style={{ display: "none" }}
            onChange={e => handleFile(e.target.files[0])}
          />
          <div style={{ fontSize: 42, marginBottom: 12 }}>📂</div>
          <p style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 700, color: "#e2e8f0" }}>
            Drop your CSV file here
          </p>
          <p style={{ margin: "0 0 20px", fontSize: 13, color: "#64748b" }}>
            or click to browse · CSV files only
          </p>
          <span style={{
            background: "#F59E0B22", color: "#F59E0B",
            border: "1px solid #F59E0B55", borderRadius: 7,
            padding: "8px 22px", fontSize: 13, fontWeight: 600,
          }}>
            Select CSV File
          </span>
        </div>
      )}

      {/* CSV preview + controls */}
      {csv && (
        <>
          {/* File info bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 11, background: "#F59E0B22", color: "#F59E0B",
              border: "1px solid #F59E0B44", borderRadius: 5, padding: "2px 10px", fontWeight: 600,
            }}>
              📁 {file?.name}
            </span>
            <span style={{ fontSize: 11, color: "#64748b" }}>
              {csv.rows.length} rows · {csv.headers.length} columns
            </span>
            <button
              onClick={reset}
              style={{
                marginLeft: "auto", background: "transparent", border: "1px solid #2d3348",
                borderRadius: 6, padding: "4px 12px", fontSize: 11, color: "#64748b", cursor: "pointer",
              }}>
              Remove file
            </button>
          </div>

          {/* Table preview */}
          <div style={{
            background: "#1e2130", border: "1px solid #2d3348",
            borderRadius: 10, overflow: "auto", marginBottom: 16, maxHeight: 230,
          }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {csv.headers.map((h, i) => (
                    <th key={i} style={{
                      padding: "10px 14px", textAlign: "left", color: "#00AAFF",
                      fontWeight: 700, borderBottom: "1px solid #2d3348",
                      background: "#161929", whiteSpace: "nowrap",
                      position: "sticky", top: 0,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csv.rows.slice(0, 6).map((row, ri) => (
                  <tr key={ri} style={{ borderBottom: "1px solid #2d334833" }}>
                    {csv.headers.map((h, ci) => (
                      <td key={ci} style={{ padding: "8px 14px", color: "#94a3b8", whiteSpace: "nowrap" }}>
                        {String(row[h]).slice(0, 40)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {csv.rows.length > 6 && (
              <p style={{ margin: 0, padding: "8px 14px", fontSize: 11, color: "#64748b" }}>
                … and {csv.rows.length - 6} more rows
              </p>
            )}
          </div>

          {/* Context input */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: "#64748b", display: "block", marginBottom: 6 }}>
              Context (optional) — describe what this data represents:
            </label>
            <textarea
              value={context}
              onChange={e => setContext(e.target.value)}
              placeholder="e.g. Monthly Kazakhstan trade data 2020–2024, showing exports and imports by sector in USD millions…"
              rows={2}
              style={{
                width: "100%", background: "#1e2130", border: "1px solid #2d3348",
                borderRadius: 8, padding: "10px 14px", color: "#e2e8f0",
                fontSize: 13, outline: "none", resize: "vertical",
                fontFamily: "Inter, sans-serif", boxSizing: "border-box",
                transition: "border-color .15s",
              }}
              onFocus={e => e.target.style.borderColor = "#F59E0B"}
              onBlur={e => e.target.style.borderColor = "#2d3348"}
            />
          </div>

          <button
            onClick={generate}
            disabled={loading}
            style={{
              background: loading ? "#1e2130" : "#F59E0B",
              border: "none", borderRadius: 10, padding: "12px 28px",
              color: loading ? "#334155" : "#0f1117",
              fontSize: 14, fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "all .15s",
            }}>
            {loading ? "⏳ Analyzing data…" : "✨ Generate Charts"}
          </button>
        </>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: "#EF444422", border: "1px solid #EF4444",
          borderRadius: 10, padding: 14, fontSize: 13, color: "#EF4444", marginTop: 14,
        }}>
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span style={{
              fontSize: 11, background: "#F59E0B22", color: "#F59E0B",
              border: "1px solid #F59E0B44", borderRadius: 5, padding: "2px 10px", fontWeight: 600,
            }}>
              ✨ Generated Analysis
            </span>
            <button
              onClick={() => setResult(null)}
              style={{
                marginLeft: "auto", background: "transparent", border: "1px solid #2d3348",
                borderRadius: 6, padding: "4px 12px", fontSize: 11, color: "#64748b", cursor: "pointer",
              }}>
              Regenerate
            </button>
          </div>

          {result.insight && (
            <div style={{
              background: "#1e2130", border: "1px solid #2d3348",
              borderRadius: 12, padding: 16, marginBottom: 14,
            }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 14 }}>📊</span>
                <span style={{ fontSize: 11, color: "#F59E0B", fontWeight: 700, textTransform: "uppercase" }}>Analysis</span>
              </div>
              <p style={{ margin: 0, fontSize: 14, color: "#cbd5e1", lineHeight: 1.75 }}>
                {result.insight}
              </p>
            </div>
          )}

          {result.charts?.map(chart => (
            <div key={chart.id} style={{
              background: "#1e2130", border: "1px solid #2d3348",
              borderRadius: 12, padding: 18, marginBottom: 12,
            }}>
              <h3 style={{ margin: "0 0 4px", fontSize: 14, color: "#e2e8f0", fontWeight: 600 }}>
                {chart.title}
              </h3>
              {chart.description && (
                <p style={{ margin: "0 0 12px", fontSize: 12, color: "#64748b" }}>
                  {chart.description}
                </p>
              )}
              <DynChart chart={chart} />
            </div>
          ))}

          {result.followUps?.length > 0 && (
            <div style={{
              background: "#1e2130", border: "1px solid #2d3348",
              borderRadius: 10, padding: 14,
            }}>
              <p style={{ margin: "0 0 10px", fontSize: 11, color: "#64748b", fontWeight: 600 }}>
                Explore further in AI Chat mode:
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {result.followUps.map((q, i) => (
                  <span key={i} style={{
                    background: "#0f1117", border: "1px solid #2d3348",
                    borderRadius: 20, padding: "5px 12px", fontSize: 12, color: "#94a3b8",
                  }}>{q}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!csv && !error && (
        <p style={{ textAlign: "center", fontSize: 11, color: "#334155", marginTop: 8 }}>
          Upload any CSV — economic, trade, financial, or custom data — Claude generates charts and insights automatically
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE METADATA
// ─────────────────────────────────────────────────────────────────────────────
const MODES = [
  ["dashboard", "📊 Dashboard"],
  ["chat",      "💬 AI Chat"],
  ["search",    "🔍 Search"],
  ["data",      "📁 Data"],
];

const MODE_META = {
  dashboard: {
    label: "Dashboard Mode",
    desc:  "Pre-built charts with filterable static data — great for overview and reference",
    color: "#00AAFF",
  },
  chat: {
    label: "AI Chat Mode",
    desc:  "Prompt-driven · Claude generates charts and analysis dynamically from your query",
    color: "#8B5CF6",
  },
  search: {
    label: "Web Search Mode",
    desc:  "Live web search · Claude pulls and summarizes current data from reliable sources",
    color: "#10B981",
  },
  data: {
    label: "Data Upload Mode",
    desc:  "Upload a CSV file · Claude analyzes your data and creates charts automatically",
    color: "#F59E0B",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App(){
  const [mode, setMode] = useState("dashboard");
  const [yearRange, setYearRange] = useState([2010, 2024]);
  const { label, desc, color } = MODE_META[mode];
  const modeIcon = MODES.find(m => m[0] === mode)?.[1].split(" ")[0] ?? "";

  return(
    <div style={{fontFamily:"Inter,sans-serif",background:"#0f1117",height:"100vh",display:"flex",flexDirection:"column",color:"#e2e8f0"}}>

      {/* ── Header ── */}
      <div style={{padding:"12px 24px",borderBottom:"1px solid #1e2130",display:"flex",alignItems:"center",gap:14,flexShrink:0,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:38,height:38,borderRadius:9,background:"linear-gradient(135deg,#00AAFF,#8B5CF6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>
            🇰🇿
          </div>
          <div>
            <h1 style={{margin:0,fontSize:16,fontWeight:800,color:"#fff"}}>Kazakhstan Economic Intelligence</h1>
            <p style={{margin:0,fontSize:11,color:"#64748b"}}>Silicon Steppes Research · GDP · Trade · Imports · Exports · AI Analysis</p>
          </div>
        </div>

        {/* Mode toggle — 4 modes */}
        <div style={{marginLeft:"auto",display:"flex",background:"#1e2130",borderRadius:9,padding:3,border:"1px solid #2d3348",gap:3,flexWrap:"nowrap"}}>
          {MODES.map(([m, lbl]) => (
            <button key={m} onClick={() => setMode(m)} style={{
              background: mode === m ? MODE_META[m].color : "transparent",
              color: mode === m ? "#fff" : "#94a3b8",
              border: "none", borderRadius: 7, padding: "6px 14px",
              fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all .2s",
              whiteSpace: "nowrap",
            }}>{lbl}</button>
          ))}
        </div>

        {/* Year filter — dashboard only */}
        {mode==="dashboard"&&(
          <div style={{display:"flex",alignItems:"center",gap:8,background:"#1e2130",border:"1px solid #2d3348",borderRadius:8,padding:"6px 14px"}}>
            <span style={{fontSize:11,color:"#64748b"}}>Years:</span>
            <input type="range" min="2010" max="2024" value={yearRange[0]}
              onChange={e=>setYearRange([+e.target.value,yearRange[1]])}
              style={{width:65,accentColor:"#00AAFF",cursor:"pointer"}}/>
            <span style={{fontSize:11,color:"#00AAFF",minWidth:28}}>{yearRange[0]}</span>
            <span style={{fontSize:11,color:"#64748b"}}>–</span>
            <input type="range" min="2010" max="2024" value={yearRange[1]}
              onChange={e=>setYearRange([yearRange[0],+e.target.value])}
              style={{width:65,accentColor:"#00AAFF",cursor:"pointer"}}/>
            <span style={{fontSize:11,color:"#00AAFF",minWidth:28}}>{yearRange[1]}</span>
          </div>
        )}
      </div>

      {/* ── Mode badge ── */}
      <div style={{padding:"7px 24px",borderBottom:"1px solid #1e2130",flexShrink:0,display:"flex",alignItems:"center",gap:10}}>
        <span style={{
          fontSize:11, borderRadius:5, padding:"2px 10px", fontWeight:600,
          background: color + "22", color, border: `1px solid ${color}44`,
        }}>
          {modeIcon} {label}
        </span>
        <span style={{fontSize:11,color:"#64748b"}}>{desc}</span>
      </div>

      {/* ── Main content ── */}
      <div style={{
        flex:1, overflowY:"auto",
        padding: mode === "chat" ? "16px 24px 0" : "20px 24px",
      }}>
        {mode === "dashboard" && (
          <div style={{maxWidth:1100,margin:"0 auto"}}>
            <DashboardMode yearRange={yearRange} setYearRange={setYearRange}/>
          </div>
        )}
        {mode === "chat" && (
          <div style={{maxWidth:900,margin:"0 auto",height:"100%",display:"flex",flexDirection:"column"}}>
            <ChatMode/>
          </div>
        )}
        {mode === "search" && <SearchMode/>}
        {mode === "data"   && <DataMode/>}
      </div>

      <style>{`
        @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
        ::-webkit-scrollbar { width:6px }
        ::-webkit-scrollbar-track { background:#0f1117 }
        ::-webkit-scrollbar-thumb { background:#2d3348; border-radius:3px }
      `}</style>
    </div>
  );
}
