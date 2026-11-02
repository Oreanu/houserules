// Styles and the small client script for the preview. Kept as strings so the CLI ships as plain JS
// with no build step for the UI and no network requests (the preview must work offline).

const LIGHT = `
  --bg:#ffffff;--bg-subtle:#f5f7f6;--panel:#ffffff;--hover:#f5f7f6;--border:#dfe5e3;--border-strong:#8b9592;
  --nav-bg:#fafbfb;--nav-sel:#e6ecea;--field:#eff2f1;--hero-bg:#0b2421;--hero-text:#f2f6f5;--hero-muted:#a6b8b4;
  --text:#141a19;--muted:#5b6563;--faint:#68716e;
  --accent:#0f766e;--accent-soft:#e3f1ee;--accent-text:#0f766e;--link:#0f766e;
  --ok:#1a7f45;--ok-soft:#e8f4ec;--warn:#a85400;--warn-soft:#fbf0e3;--bad:#c4281c;--bad-soft:#fbeceb;--ask:#7a3fb8;--ask-soft:#f3ecfa;
  --code-bg:#f5f7f6;--hit:#fff6c2;--hit-edge:#e0b400;--shadow:none;--shadow-pop:0 4px 12px rgba(10,30,28,.08),0 16px 40px rgba(10,30,28,.12);
  --overlay:rgba(10,20,19,.3);`;
const DARK = `
  --bg:#0a0d0d;--bg-subtle:#151a19;--panel:#0f1312;--hover:#151a19;--border:#283130;--border-strong:#5f6a67;
  --nav-bg:#0f1312;--nav-sel:#202827;--field:#192020;--hero-bg:#0c1a18;--hero-text:#eef2f1;--hero-muted:#9fb3ae;
  --text:#eef2f1;--muted:#a3aeab;--faint:#76817e;
  --accent:#2dd4bf;--accent-soft:#0e2a27;--accent-text:#2dd4bf;--link:#2dd4bf;
  --ok:#3ddc84;--ok-soft:#0e2618;--warn:#f5a524;--warn-soft:#2b1f08;--bad:#ff6b5e;--bad-soft:#2c1311;--ask:#c4a1ff;--ask-soft:#251a36;
  --code-bg:#192020;--hit:#3a3110;--hit-edge:#d4a72c;--shadow:none;--shadow-pop:0 4px 12px rgba(0,0,0,.5),0 16px 40px rgba(0,0,0,.6);
  --overlay:rgba(0,0,0,.6);`;

export const CSS = `
:root{${LIGHT}
  --radius:10px;
  --font:-apple-system,BlinkMacSystemFont,system-ui,"Segoe UI","Inter",Roboto,sans-serif;
  --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}
*{box-sizing:border-box}
html{scroll-padding-top:72px}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.47 var(--font);-webkit-font-smoothing:antialiased}
[hidden]{display:none!important}
svg a.node,svg a.node:hover{text-decoration:none}
a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}
code,kbd,pre{font-family:var(--mono)}
code{font-size:.9em;background:none;border:0;padding:0}
kbd{font-size:11px;border:1px solid var(--border-strong);border-bottom-width:2px;border-radius:5px;padding:0 5px;color:var(--muted);background:var(--panel)}
button{font:inherit;color:inherit}
.muted{color:var(--muted)}.faint{color:var(--faint)}

/* shell: the navigator */
.shell{display:grid;grid-template-columns:272px minmax(0,1fr);min-height:100vh}
.sidebar{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;background:var(--nav-bg);border-right:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:8px;padding:16px 18px 14px}
.brand-link{display:flex;align-items:center;gap:8px;color:var(--text);flex:1;min-width:0}.brand-link:hover{text-decoration:none}
.logo{width:20px;height:20px;color:var(--text);display:grid;place-items:center;flex:none}.logo svg{width:20px;height:20px}
.brand-name{font-size:14px;font-weight:600;letter-spacing:-.01em}
.icon-btn{display:inline-grid;place-items:center;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:var(--muted);cursor:pointer;padding:0;flex:none}
.icon-btn:hover{background:var(--nav-sel);color:var(--text)}.icon-btn svg{width:16px;height:16px}
.repo{padding:10px 18px 12px;border-bottom:1px solid var(--border)}
.repo-name{font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.repo-meta{font-size:12px;color:var(--muted);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nav{flex:1;overflow-y:auto;padding:12px 10px;overscroll-behavior:contain}
.nav-group{padding:16px 0 5px 13px;font-size:11.5px;font-weight:600;color:var(--faint)}
.nv-row{display:flex;align-items:center;border-radius:6px;font-size:14px;color:var(--text)}
.nv-row:hover{background:color-mix(in srgb,var(--nav-sel) 60%,transparent)}
.nv-row.cur{background:var(--nav-sel)}.nv-row.cur .nv-label{font-weight:600}
.nv-tog{flex:none;width:18px;align-self:stretch;display:grid;place-items:center;padding:0 0 0 6px;border:0;background:none;color:var(--faint);cursor:pointer}
span.nv-tog{cursor:default}
.nv-tog svg{width:10px;height:10px;stroke-width:2.6;transition:transform .15s}
.nv.open>.nv-row .nv-tog svg{transform:rotate(90deg)}
.nv-link{flex:1;min-width:0;display:flex;align-items:center;gap:8px;padding:5px 8px 5px 4px;color:inherit}.nv-link:hover{text-decoration:none}
.nv-link svg{width:16px;height:16px;flex:none;color:var(--muted)}
.nv-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nav .count{margin-left:auto;padding-left:8px;font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums}
.nv-dot{width:7px;height:7px;border-radius:50%;flex:none}
.nv-kids{display:none;padding:1px 0 4px}.nv.open>.nv-kids{display:block}
.nv-kid{display:flex;align-items:center;padding:4px 8px 4px 50px;border-radius:6px;font-size:13px;color:var(--muted)}
.nv-kid:hover{background:color-mix(in srgb,var(--nav-sel) 60%,transparent);color:var(--text);text-decoration:none}
.nv-none{margin:12px 13px;font-size:13px;color:var(--faint)}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex:none}
.dot.ok{background:var(--ok)}.dot.bad{background:var(--bad)}.dot.warn{background:var(--warn)}.dot.empty{background:var(--border-strong)}
.side-foot{border-top:1px solid var(--border);padding:12px 14px 16px;display:flex;flex-direction:column;gap:10px}
.field{display:flex;align-items:center;gap:8px;background:var(--field);border:0;border-radius:8px;color:var(--faint)}
.field svg{width:14px;height:14px;flex:none}
.nv-filter{height:30px;padding:0 10px}
.nv-filter input{flex:1;min-width:0;border:0;background:none;outline:none;color:var(--text);font:13px var(--font);padding:0}
.nv-filter input::placeholder{color:var(--faint)}
.nv-filter:focus-within{box-shadow:0 0 0 3px color-mix(in srgb,var(--link) 35%,transparent)}
.health{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted);padding:0 2px;min-width:0}
.health>span:nth-child(2){flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.linkbtn{border:0;background:none;padding:0;color:var(--link);font:13px var(--font);cursor:pointer;white-space:nowrap}
.linkbtn:hover{text-decoration:underline}.linkbtn:disabled{color:var(--faint);cursor:default;text-decoration:none}
.btn:disabled{cursor:default;opacity:.75}
.btn.busy svg{animation:hr-spin .8s linear infinite}
@keyframes hr-spin{to{transform:rotate(360deg)}}
.toast{position:fixed;left:50%;bottom:24px;z-index:70;display:flex;align-items:center;gap:10px;max-width:min(520px,calc(100vw - 32px));padding:11px 16px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:var(--text);box-shadow:var(--shadow-pop);font-size:13.5px;opacity:0;transform:translate(-50%,8px);transition:opacity .18s,transform .18s;pointer-events:none}
.toast.show{opacity:1;transform:translate(-50%,0)}
.toast::before{content:"";width:8px;height:8px;border-radius:50%;flex:none;background:var(--ok)}
.toast.bad::before{background:var(--bad)}.toast.warn::before{background:var(--warn)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 16px;border-radius:99px;border:0;background:var(--field);color:var(--text);font-size:14px;font-weight:500;cursor:pointer;text-decoration:none;white-space:nowrap}
.btn:hover{background:var(--nav-sel);text-decoration:none}
.btn.primary{background:var(--link);color:#fff}.btn.primary:hover{background:var(--link);opacity:.9}:root[data-theme="dark"] .btn.primary{color:#04201d}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .btn.primary{color:#04201d}}
.btn.ghost{border-color:transparent;background:transparent}.btn.ghost:hover{background:var(--hover)}
.btn svg{width:15px;height:15px}

/* top bar */
.main{min-width:0;display:flex;flex-direction:column}
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:12px;height:52px;padding:0 28px;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:saturate(1.8) blur(20px);-webkit-backdrop-filter:saturate(1.8) blur(20px);border-bottom:1px solid var(--border)}
.crumbs{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);min-width:0;white-space:nowrap;overflow:hidden}
.crumbs .sep{color:var(--faint)}.crumbs strong{color:var(--muted);font-weight:400;overflow:hidden;text-overflow:ellipsis}
.searchbtn{margin-left:auto;height:32px;width:240px;padding:0 10px;cursor:pointer;font-size:13px;flex:none}
.searchbtn .lbl{flex:1;text-align:left}.searchbtn kbd{border:0;background:none;padding:0;font:12px var(--font);color:var(--faint)}
.searchbtn:hover{color:var(--muted)}
.menu-btn{display:none}

/* page layouts */
.page{width:100%;max-width:1200px;margin:0 auto;padding:56px 72px 96px}
.doc-layout{display:grid;grid-template-columns:minmax(0,1fr) 200px;gap:56px}
.reading{max-width:740px;min-width:0}
.eyebrow{font-size:15px;font-weight:600;color:var(--muted)}
h1{font-size:40px;line-height:1.12;letter-spacing:-.03em;margin:8px 0 12px;font-weight:700}
.lede{font-size:21px;line-height:1.38;color:var(--muted);margin:0 0 14px;max-width:740px}
.doc-meta{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--muted);margin:0 0 4px}.doc-meta .dot{width:7px;height:7px;border-radius:50%;background:var(--ok)}.doc-meta .dot.warn{background:var(--warn)}
.doc-note{font-size:13px;color:var(--faint);margin:0 0 6px}
h2{font-size:32px;line-height:1.12;letter-spacing:-.02em;margin:44px 0 8px;font-weight:700}
.doc-section{border-top:1px solid var(--border);margin-top:40px}.doc-section>h2{margin-top:36px}
h2 .count{font-size:15px;color:var(--faint);font-weight:400;letter-spacing:0;margin-left:8px}
.section-intro{color:var(--muted);margin:0 0 8px;font-size:13.5px}

/* chips & badges */
.chips{display:flex;flex-wrap:wrap;gap:4px 22px;margin:22px 0 4px;border-bottom:1px solid var(--border)}
.chip{display:inline-flex;align-items:center;gap:6px;padding:0 0 9px;margin-bottom:-1px;border:0;border-bottom:2px solid transparent;background:none;font-size:14px;font-weight:500;color:var(--muted);cursor:pointer;text-decoration:none}
.chip:hover{color:var(--text);text-decoration:none}.chip[aria-pressed="true"]{color:var(--text);border-bottom-color:var(--text)}
.chip .n{font-variant-numeric:tabular-nums;color:var(--faint);font-weight:400}
.badge{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap}
.badge svg{width:12px;height:12px}
.badge.ok{background:var(--ok-soft);color:var(--ok)}.badge.warn{background:var(--warn-soft);color:var(--warn)}
.badge.bad{background:var(--bad-soft);color:var(--bad)}.badge.ask{background:var(--ask-soft);color:var(--ask)}
.tag{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:6px;font-size:11.5px;background:var(--hover);color:var(--muted);border:1px solid var(--border)}

/* doc items */
.item{position:relative;padding:28px 0 4px}
.item:first-of-type{border-top:0}
.item-head{display:flex;align-items:flex-start;gap:12px;justify-content:space-between}
.item h3{margin:0;font-size:21px;line-height:1.3;letter-spacing:-.015em;font-weight:600}
.item-label{font-size:13px;font-weight:600;margin-bottom:4px}.item-label.warn{color:var(--warn)}.item-label.ask{color:var(--ask)}.item-label.ok{color:var(--ok)}.item-label.bad{color:var(--bad)}
.item.is-ask{margin-top:24px;padding:16px 20px 12px;border-radius:10px;background:var(--bg-subtle);box-shadow:inset 3px 0 0 var(--ask)}
.item h3 a{color:inherit}.item h3 a:hover{text-decoration:none}
.item h3 .hash{opacity:0;margin-left:6px;color:var(--faint);font-weight:400}.item:hover h3 .hash{opacity:1}
.prose{margin-top:8px;color:var(--text)}
.reading .prose{font-size:17px;line-height:1.47}
.prose p{margin:8px 0}.prose ol,.prose ul{padding-left:22px;margin:8px 0}.prose li{margin:4px 0}
.prose code{overflow-wrap:anywhere;background:none;border:0;padding:0;font-size:.9em}.prose a code{color:var(--link)}
.sources{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;margin-top:12px}
.sources .label{display:inline-flex;align-items:center;gap:5px;font-size:13px;color:var(--faint)}.sources .label.checked svg{width:12px;height:12px;color:var(--ok)}
.src{display:inline-flex;align-items:center;gap:0;max-width:100%;color:var(--link);font:13px var(--mono);cursor:pointer;text-decoration:none}
.src:hover{text-decoration:underline}
.sources .src svg{display:none}.src svg{width:12px;height:12px;flex:none;opacity:.7;margin-right:6px}
.src .ln{color:inherit;opacity:.8}
.src .file{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.alert{display:flex;gap:10px;margin-top:14px;padding:12px 16px;border-radius:10px;font-size:14px;border:0;background:var(--bg-subtle)!important}
.alert svg{width:16px;height:16px;flex:none;margin-top:2px}
.alert.bad{box-shadow:inset 3px 0 0 var(--bad);color:var(--bad)}
.alert.warn{box-shadow:inset 3px 0 0 var(--warn);color:var(--warn)}
.alert ul{margin:0;padding-left:16px;overflow-wrap:anywhere}.alert li{color:var(--text)}
.item.is-broken h3{color:var(--bad)}
.item[hidden]{display:none}

/* on this page */
.toc{position:sticky;top:88px;align-self:start;font-size:13px;max-height:calc(100vh - 110px);overflow-y:auto}
.toc{border-left:1px solid var(--border);padding-left:18px}.toc-title{font-size:12px;font-weight:600;color:var(--faint);margin-bottom:10px;display:flex;align-items:center;gap:6px}
.toc a{display:block;padding:4px 0;color:var(--muted);text-decoration:none}
.toc a:hover{color:var(--text)}.toc a.active{color:var(--text);font-weight:600}
.toc a.lvl3{padding-left:24px;font-size:12.5px}

/* overview */
.hero{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px}
.hero .chips{margin:10px 0 0}
.strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin-top:26px;border:1px solid var(--border);border-radius:12px;background:var(--panel);box-shadow:var(--shadow)}
.strip .cell{padding:16px 20px;border-left:1px solid var(--border)}.strip .cell:first-child{border-left:0}
.strip .k{font-size:12.5px;color:var(--muted)}.strip .v{font-size:26px;font-weight:650;letter-spacing:-.02em;margin-top:4px;font-variant-numeric:tabular-nums}
.strip .s{font-size:12px;color:var(--faint);margin-top:2px}
.grid2{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:18px;margin-top:18px}
.card{border:1px solid var(--border);border-radius:12px;background:var(--panel);box-shadow:var(--shadow);overflow:hidden}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 18px;border-bottom:1px solid var(--border)}
.card-head h3{margin:0;font-size:14px;font-weight:620}
.card-body{padding:6px 18px 14px}
.check{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px dashed var(--border);font-size:13.5px}
.check:last-child{border-bottom:0}
.check .ic{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;flex:none;border:1.5px solid var(--border-strong)}
.check .ic.ok{background:var(--ok);border-color:var(--ok);color:#fff}.check .ic.part{border-color:var(--warn)}
.check .ic svg{width:11px;height:11px}
.check a{color:var(--text)}.check .meta{margin-left:auto;font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums}
.progress{height:6px;border-radius:99px;background:var(--hover);overflow:hidden;width:90px}
.progress i{display:block;height:100%;background:var(--ok);border-radius:99px}
.issue{padding:12px 0;border-bottom:1px solid var(--border);font-size:13.5px}.issue:last-child{border-bottom:0}
.issue .why{font-size:12.5px;color:var(--muted);margin-top:3px;overflow-wrap:anywhere}
.empty-good{display:flex;flex-direction:column;align-items:center;text-align:center;padding:28px 12px;color:var(--muted);font-size:13.5px}
.empty-good .big{width:40px;height:40px;border-radius:50%;background:var(--ok-soft);color:var(--ok);display:grid;place-items:center;margin-bottom:10px}
.empty-good .big svg{width:20px;height:20px}
.empty-good strong{color:var(--text);font-size:14.5px}
table.t{width:100%;border-collapse:collapse;font-size:13.5px}
.t th{text-align:left;font-size:12px;font-weight:550;color:var(--faint);padding:10px 18px;border-bottom:1px solid var(--border);white-space:nowrap}
.t td{padding:11px 18px;border-bottom:1px solid var(--border);vertical-align:top}
.t tr:last-child td{border-bottom:0}
.t td.files a{display:block;font:12px var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px}
.t .env{font:12px var(--mono);color:var(--muted)}
.scroll-x{overflow-x:auto}
.langbar{display:flex;height:10px;border-radius:99px;overflow:hidden;margin:14px 0 10px;background:var(--hover)}
.langbar i{display:block;height:100%}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--muted)}
.legend span{display:inline-flex;align-items:center;gap:6px}.legend b{width:8px;height:8px;border-radius:50%;display:inline-block}
.blocks a{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);color:var(--text);text-decoration:none;font-size:13px}
.blocks a:last-child{border-bottom:0}.blocks a:hover .p{color:var(--accent-text)}
.blocks .p{font-family:var(--mono);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.blocks .n{margin-left:auto;font-size:12px;color:var(--faint);white-space:nowrap}
.steps{counter-reset:s;margin:18px 0 0;padding:0;list-style:none}
.steps li{counter-increment:s;position:relative;padding:14px 18px 14px 56px;border:1px solid var(--border);border-radius:12px;background:var(--panel);margin-bottom:10px}
.steps li::before{content:counter(s);position:absolute;left:18px;top:14px;width:24px;height:24px;border-radius:50%;background:var(--hover);display:grid;place-items:center;font-size:12px;font-weight:650;color:var(--muted)}
.steps strong{display:block;margin-bottom:2px}
.steps pre{margin:8px 0 0;padding:9px 12px;background:var(--code-bg);border:1px solid var(--border);border-radius:8px;font-size:12.5px;overflow-x:auto}

/* drawer */
.overlay{position:fixed;inset:0;background:var(--overlay);opacity:0;pointer-events:none;transition:opacity .18s;z-index:40}
.overlay.open{opacity:1;pointer-events:auto}
.drawer{position:fixed;top:0;right:0;height:100vh;width:min(680px,100vw);background:var(--bg);border-left:1px solid var(--border);box-shadow:var(--shadow-pop);transform:translateX(100%);transition:transform .22s cubic-bezier(.2,.8,.2,1);z-index:50;display:flex;flex-direction:column}
.drawer.open{transform:none}
.drawer-head{display:flex;align-items:center;gap:10px;padding:16px 18px 14px 22px;border-bottom:1px solid var(--border)}
.drawer-title{min-width:0;flex:1}
.drawer-title .path{font:13px var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.drawer-title .sub{font-size:12px;color:var(--faint)}
.drawer-body{flex:1;overflow:auto;background:var(--bg);padding:8px 0}
.code{width:100%;border-collapse:collapse;font:12.5px/1.6 var(--mono);tab-size:4}
.code td{padding:0 14px;white-space:pre;vertical-align:top}
.code td.n{width:1%;text-align:right;color:var(--faint);user-select:none;padding-left:16px;border-right:0}
.code td.n a{color:inherit;text-decoration:none}
.code tr.hit td{background:var(--nav-sel)}.code tr.hit td.n{color:var(--text);box-shadow:inset 3px 0 0 var(--accent)}
.code-page{border:1px solid var(--border);border-radius:12px;overflow:auto;background:var(--panel)}
.loading{padding:24px;color:var(--faint)}

/* search */
.palette{position:fixed;inset:0;z-index:60;display:none;align-items:flex-start;justify-content:center;padding-top:12vh;background:var(--overlay)}
.palette.open{display:flex}
.palette-box{width:min(640px,calc(100vw - 32px));background:var(--bg);border:0;border-radius:14px;box-shadow:var(--shadow-pop);overflow:hidden}
.palette-field{display:flex;align-items:center;gap:10px;padding:0 18px;border-bottom:1px solid var(--border)}.palette-field svg{width:18px;height:18px;color:var(--faint);flex:none}.palette-field kbd{flex:none}
.palette-foot{display:flex;gap:18px;padding:10px 20px 12px;border-top:1px solid var(--border);font-size:12px;color:var(--faint)}
.rgroup{padding:10px 14px 4px;font-size:12px;font-weight:600;color:var(--faint)}
.palette input{flex:1;min-width:0;border:0;padding:16px 0;font:19px var(--font);background:transparent;color:var(--text);outline:none}
.results{max-height:52vh;overflow-y:auto;padding:6px}
.result{display:block;padding:8px 14px;border-radius:8px;color:var(--text);text-decoration:none}
.result:hover,.result.sel{background:var(--nav-sel);text-decoration:none}
.result .rt{font-size:15px;font-weight:400}.result .rs{font-size:13px;color:var(--faint);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.noresult{padding:18px;color:var(--faint);font-size:13px;text-align:center}

footer.foot{padding:28px 40px 40px;font-size:12px;color:var(--faint)}

/* diagrams */
.page-wide{max-width:1480px}.reading.full{max-width:none}.reading.wide{max-width:900px}
.figs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;margin:26px 0 8px}
.fig-k{font-size:13px;font-weight:500;color:var(--faint)}.fig-v{font-size:32px;line-height:1.15;font-weight:700;letter-spacing:-.02em;margin:4px 0 2px}.fig-v.ok{color:var(--ok)}.fig-v.warn{color:var(--warn)}.fig-v.bad{color:var(--bad)}.fig-s{font-size:14px;color:var(--muted)}
.hsec{border-top:1px solid var(--border);margin-top:36px;padding-top:32px}.hsec.first{border-top:0;margin-top:20px;padding-top:0}.hsec h2{font-size:28px;margin:0 0 10px}
.dot{display:inline-block;flex:none;width:7px;height:7px;border-radius:50%;background:var(--border-strong)}.dot.ok{background:var(--ok)}.dot.warn{background:var(--warn)}.dot.bad{background:var(--bad)}
.issues{list-style:none;margin:6px 0 0;padding:0}.issue{display:flex;gap:12px;align-items:flex-start;padding:14px 0;border-top:1px solid var(--border)}.issue .dot{margin-top:9px}.issue>div{flex:1;min-width:0}.issue>div>a{font-size:17px}.issue .issue-why{font-size:14px;color:var(--faint);margin-top:3px}.issue .review{font-size:14px;white-space:nowrap}
.all-good{display:flex;align-items:center;gap:10px;font-size:17px;margin:4px 0}
.hgroup{display:grid;grid-template-columns:220px minmax(0,1fr);gap:24px;padding:16px 0;border-top:1px solid var(--border)}.hgroup:first-of-type{border-top:0}.hgroup h3{margin:0;font-size:17px;font-weight:600}
.hlist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}.hlist li{display:flex;align-items:center;gap:10px;font-size:15px}.hlist li>span{margin-left:auto;color:var(--faint);font-size:14px}
.hsec .t th:first-child,.hsec .t td:first-child{padding-left:0}.hsec .t td{font-size:14.5px}
.note{display:block;margin:18px 0 8px;padding:14px 18px;border-radius:10px;background:var(--bg-subtle);box-shadow:inset 3px 0 0 var(--link);font-size:15px;line-height:1.45}.note b{display:block;color:var(--link);margin-bottom:4px}
.prose.agents h3{font-size:28px;line-height:1.15;letter-spacing:-.015em;font-weight:700;margin:36px 0 10px;padding-top:32px;border-top:1px solid var(--border)}
.prose.agents li{margin:10px 0}.toc-sub{display:block;font-size:12.5px;color:var(--faint);padding:2px 0 0}
.page.message{text-align:center;padding-top:16vh}.page.message .lede{margin:0 auto 18px}.message-links{display:flex;justify-content:center;gap:26px;font-size:17px}
.rules{list-style:none;margin:8px 0 0;padding:0}.rule{padding:16px 0;border-top:1px solid var(--border)}.rule:first-child{border-top:0}
.rule-title{font-size:17px;font-weight:600}.rule-why{margin:4px 0 0;color:var(--muted);font-size:15px}.rule-fix{margin:4px 0 0;font-size:15px}.rule-fix b{font-weight:600}
.rule-meta{margin:6px 0 0;font-size:13px;color:var(--faint)}.rule-meta code{color:var(--faint)}.rule-meta .bad{color:var(--bad);font-weight:600}
.item-label .ruled{color:var(--ok);font-weight:500}.answer-meta{font-size:13px;color:var(--faint);margin:8px 0 0}
.listing{margin:14px 0;padding:14px 18px;border-radius:10px;background:var(--bg-subtle);font:14px/1.6 var(--mono);overflow-x:auto}
@media (max-width:760px){.figs{grid-template-columns:repeat(2,minmax(0,1fr))}.hgroup{grid-template-columns:1fr;gap:8px}main .chapter{grid-template-columns:1fr;gap:12px}main .tcols{grid-template-columns:1fr}main .tcode{position:static;max-height:420px}.page{padding:32px 20px 64px}h1{font-size:32px}.lede{font-size:18px}}
.diagram-card{border:1px solid var(--border);border-radius:14px;background:var(--bg-subtle);overflow:hidden}
.diagram-scroll{overflow:auto;max-height:640px;padding:6px}.diagram-scroll.compact{max-height:360px}
svg.arch{display:block;font-family:var(--font)}
svg.arch .node rect{fill:var(--panel);stroke:var(--border-strong);stroke-width:1;transition:stroke .15s,fill .15s}
svg.arch .node:hover rect,svg.arch .node.hl rect{stroke:var(--accent);fill:var(--accent-soft)}
svg.arch .node.app-node rect{fill:var(--text)!important}svg.arch .node.data-node rect{fill:var(--warn-soft)!important}svg.arch .svc-node:hover rect,svg.arch .svc-node.hl rect{stroke-width:2}
svg.arch .nl{font-size:13px;font-weight:600;fill:var(--text)}svg.arch .ns{font-size:11.5px;fill:var(--faint)}
svg.arch .edge{fill:none;stroke:var(--border-strong);opacity:.9;transition:stroke .15s,opacity .15s}
svg.arch .edge.back{stroke-dasharray:4 4}svg.arch .edge.svc{stroke:var(--accent);stroke-dasharray:3 4;stroke-width:1.3;opacity:.7}
svg.arch marker path{fill:var(--border-strong)}
svg.arch.focus .edge{opacity:.15}svg.arch.focus .edge.hl{opacity:1;stroke:var(--accent)}svg.arch.focus .node:not(.hl) rect{opacity:.5}
svg.arch .svc-node rect{fill:var(--accent-soft);stroke:var(--accent);stroke-width:1}svg.arch .svc-node .nl{fill:var(--accent-text)}
svg.arch .heat{stroke:transparent;stroke-width:4;stroke-linecap:round}svg.arch .hv{font-size:11px;font-weight:700;fill:var(--muted)}
svg.arch.lens-on .node rect:first-of-type{fill:var(--panel)}
.model-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0 12px;font-size:13px}
.model-filter{margin-left:auto;height:32px;width:220px;padding:0 10px;border:1px solid var(--border-strong);border-radius:8px;background:var(--panel);color:var(--text);font:13px var(--font)}
.entities{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;align-items:start}
.entities.limited .entity.extra{display:none}
.entity{border:1px solid var(--border);border-radius:12px;background:var(--panel);box-shadow:var(--shadow);overflow:hidden;transition:box-shadow .2s,border-color .2s}
.entity.flash{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.ent-head{padding:9px 12px;border-bottom:1px solid var(--border);background:var(--bg-subtle)}
.ent-name{border:0;background:none;padding:0;height:auto;font:600 14px var(--font);color:var(--text)}
.fields{list-style:none;margin:0;padding:6px 0}.fields li{display:flex;align-items:center;gap:8px;padding:3px 12px;font-size:12.5px}
.fname{font-family:var(--mono)}.ftype{margin-left:auto;font-family:var(--mono);color:var(--faint);font-size:11.5px;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ftag{font-size:10px;font-weight:700;border-radius:4px;padding:0 4px}.ftag.pk{background:var(--warn-soft);color:var(--warn)}.ftag.fk{background:var(--accent-soft);color:var(--accent-text)}
.rels{display:flex;flex-wrap:wrap;gap:5px;padding:8px 12px 10px;border-top:1px dashed var(--border)}
.rel{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border-radius:999px;border:1px solid var(--border);font-size:12px;color:var(--text);text-decoration:none;background:var(--bg-subtle)}
.rel:hover{border-color:var(--accent);text-decoration:none}.rel .rk{color:var(--faint);font-size:11px}
.show-all-entities{margin-top:12px}
.flowsteps{list-style:none;margin:12px 0 4px;padding:0;position:relative}
.flowsteps li{position:relative;display:flex;gap:12px;padding:0 0 12px}
.flowsteps li:not(:last-child)::before{content:"";position:absolute;left:12px;top:26px;bottom:0;width:2px;background:var(--border)}
.flowsteps .sn{flex:none;width:26px;height:26px;border-radius:50%;background:var(--accent-soft);color:var(--accent-text);display:grid;place-items:center;font-size:12px;font-weight:700;border:1px solid color-mix(in srgb,var(--accent) 35%,transparent)}
.flowsteps .sbody{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-height:26px}
.flowsteps .slabel{font-size:12.5px}
.flow-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.flow-card{border:1px solid var(--border);border-radius:14px;background:var(--panel);padding:14px 16px;box-shadow:var(--shadow)}
.flow-title{display:block;font-weight:620;color:var(--text);margin-bottom:4px}
.history{list-style:none;margin:0;padding:0 0 0 4px;border-left:2px solid var(--border)}
.history li{position:relative;display:flex;gap:14px;padding:6px 0 6px 18px;font-size:13.5px}
.history li::before{content:"";position:absolute;left:-7px;top:12px;width:10px;height:10px;border-radius:50%;background:var(--panel);border:2px solid var(--border-strong)}
.history li.start::before,.history li.latest::before{border-color:var(--accent);background:var(--accent)}
.history .hd{font-family:var(--mono);font-size:12px;color:var(--faint);min-width:86px}
.vtiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin:22px 0 4px}
.vtile{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:var(--panel);color:var(--text);text-decoration:none}
.vtile:hover{border-color:var(--accent);text-decoration:none}.vtile strong{display:block;font-size:14px}.vtile .faint{font-size:12.5px}

.mermaid{display:flex;justify-content:center;margin:12px 0;padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--panel);overflow-x:auto}

/* map explorer */
.map-explorer{border:1px solid var(--border);border-radius:14px;background:var(--bg-subtle);overflow:clip;display:flex;flex-direction:column}
.map-explorer.fullscreen{position:fixed;inset:12px;z-index:65;box-shadow:var(--shadow-pop);background:var(--bg)}
.mx-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border);background:var(--panel)}
.seg{display:inline-flex;border:1px solid var(--border-strong);border-radius:9px;overflow:hidden;background:var(--panel)}
.seg button{border:0;border-right:1px solid var(--border);background:transparent;padding:0 10px;height:30px;font-size:12.5px;color:var(--muted);cursor:pointer;white-space:nowrap}
.seg button:last-child{border-right:0}.seg button:hover{color:var(--text);background:var(--hover)}
.seg button[aria-pressed="true"]{background:var(--text);color:var(--bg)}
.mx-zoom button{min-width:32px}
.mx-flow,.mx-search{height:32px;border:1px solid var(--border-strong);border-radius:9px;background:var(--panel);color:var(--text);font:12.5px var(--font);padding:0 10px}
.mx-flow{max-width:280px}.mx-search{width:160px}.mx-spacer{flex:1}
.mx-body{position:relative;display:flex;min-height:300px;flex:1}
.mx-stage{flex:1;min-width:0;overflow:hidden;position:relative}
.map-explorer .diagram-scroll{max-height:none;overflow:hidden;padding:0}
.map-explorer svg.arch{cursor:grab;touch-action:none;width:100%;display:block}
.map-explorer.fullscreen svg.arch{height:calc(100vh - 130px)!important}
.map-explorer svg.arch.dragging{cursor:grabbing}
svg.arch .node.match rect{stroke:var(--warn);stroke-width:2.5}
svg.arch .node.sel rect{stroke:var(--accent);stroke-width:2.5;fill:var(--accent-soft)}
svg.arch .node.dim{opacity:.28}svg.arch .edge.dim{opacity:.08}svg.arch .edge.hl{stroke:var(--accent);opacity:1}
svg.arch .node.step rect{stroke:var(--accent);stroke-width:3;fill:var(--accent-soft)}
svg.arch .node.visited rect{stroke:var(--accent);stroke-dasharray:3 3}
svg.arch .edge.walk{stroke:var(--accent);opacity:1}
svg.arch .actor-node rect{fill:var(--panel);stroke:var(--border-strong);stroke-dasharray:4 3}
svg.arch .app-node rect{fill:var(--text)}svg.arch .app-node .nl{fill:var(--bg)}svg.arch .app-node .ns{fill:var(--bg);opacity:.7}
svg.arch .data-node rect{fill:var(--warn-soft);stroke:var(--warn)}svg.arch .data-node .nl{fill:var(--warn)}
svg.arch marker path,svg.system marker path{fill:var(--border-strong)}
.mx-panel{width:320px;flex:none;border-left:1px solid var(--border);background:var(--panel);padding:14px 16px;overflow-y:auto;max-height:640px;font-size:13px}
.map-explorer.fullscreen .mx-panel{max-height:none}
.mx-panel h4{margin:0 0 2px;font-size:15px}.mx-panel .dir{font:12px var(--mono);color:var(--faint);overflow-wrap:anywhere}
.mx-panel .kv{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}
.mx-panel .kv div{border:1px solid var(--border);border-radius:9px;padding:7px 9px}.mx-panel .kv b{display:block;font-size:17px}.mx-panel .kv span{font-size:11.5px;color:var(--faint)}
.mx-panel .blast{padding:9px 11px;border-radius:9px;background:var(--warn-soft);color:var(--warn);margin:4px 0 12px}
.mx-panel h5{margin:14px 0 6px;font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint)}
.mx-panel ul{list-style:none;margin:0;padding:0}.mx-panel li{padding:3px 0;overflow-wrap:anywhere}
.mx-panel .chipline{display:flex;flex-wrap:wrap;gap:5px}
.mx-panel .mchip{border:1px solid var(--border);border-radius:999px;padding:1px 8px;font-size:12px;background:var(--bg-subtle);cursor:pointer;color:var(--text)}
.mx-panel .mchip:hover{border-color:var(--accent)}
.mx-close{float:right;border:0;background:none;color:var(--faint);cursor:pointer;font-size:18px;line-height:1}
.mx-caption{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--panel);font-size:13.5px;position:sticky;top:56px;z-index:5;box-shadow:0 6px 12px -10px rgba(0,0,0,.25)}
.map-explorer.fullscreen .mx-caption{top:0}
.mx-caption .ctl{display:flex;gap:6px;flex-wrap:wrap}
.mx-dots{display:flex;gap:4px;flex-basis:100%;order:3}
.mx-dots button{flex:1;height:6px;min-width:14px;padding:0;border:0;border-radius:99px;background:var(--border-strong);cursor:pointer}
.mx-dots button.done{background:color-mix(in srgb,var(--accent) 45%,var(--panel))}.mx-dots button.cur{background:var(--accent)}
.mx-timer{position:absolute;left:0;bottom:-1px;height:2px;background:var(--accent);width:0}
.mx-timer.run{animation:mxtimer 1.8s linear forwards}@keyframes mxtimer{to{width:100%}}
svg.arch .node.pulse rect{animation:mxpulse .7s ease-out}@keyframes mxpulse{0%{stroke-width:6}100%{stroke-width:3}}
.mx-caption .num{width:24px;height:24px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:700;font-size:12px;flex:none}
.mx-caption .txt{flex:1;min-width:0}.mx-caption .txt small{display:block;color:var(--faint)}
.mx-state{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--accent-soft);font-size:12.5px;color:var(--accent-text)}
.mx-state .st{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 4px 0 10px;border-radius:999px;background:var(--panel);border:1px solid color-mix(in srgb,var(--accent) 30%,transparent);color:var(--text)}
.mx-state .st b{font-weight:600}.mx-state .st button{border:0;background:none;cursor:pointer;color:var(--muted);font-size:15px;line-height:1;padding:0 6px;border-radius:999px}
.mx-state .st button:hover{background:var(--hover);color:var(--text)}
.mx-state .hint{margin-left:auto;color:var(--faint)}
.map-explorer.fullscreen .mx-expand{order:-1;background:var(--text);color:var(--bg);border-color:var(--text)}
.mx-lbl{font-size:11.5px;font-weight:600;color:var(--faint);text-transform:uppercase;letter-spacing:.04em;margin-left:4px}
.mx-guide{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;padding:9px 14px;border-bottom:1px solid var(--border);background:var(--bg-subtle);font-size:13px;color:var(--muted)}
.mx-guide b{color:var(--text);font-weight:600}.mx-guide .key{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--faint)}
.mx-guide .key i{display:inline-block;width:18px;height:12px;border:1px solid var(--border-strong);border-radius:3px;background:var(--panel)}
.mx-guide .key i.arr{width:22px;height:0;border:0;border-top:2px solid var(--border-strong);border-radius:0}
.mx-guide .key i.svc{border-color:var(--accent);background:var(--accent-soft);border-radius:99px}
.mx-legend{display:flex;align-items:center;gap:10px;padding:8px 14px;font-size:12px;color:var(--faint);border-top:1px solid var(--border)}
.mx-legend:empty{display:none}
.mx-legend .ramp{width:120px;height:8px;border-radius:99px;background:linear-gradient(90deg,var(--panel),var(--accent))}
.mx-legend .ramp.bad{background:linear-gradient(90deg,var(--panel),var(--bad))}
/* entry points */
.ep-method{font:700 11px var(--mono);color:var(--accent-text);margin-right:7px}
.em{display:flex;flex-direction:column;gap:20px}
.em-tabs{display:flex;gap:4px;border-bottom:1px solid var(--border)}
.em-tab{display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:8px 14px 10px;margin-bottom:-1px;background:none;border:0;border-bottom:2px solid transparent;color:var(--muted);font:inherit;cursor:pointer;text-align:left}
.em-tab b{font-size:13.5px;font-weight:600}.em-tab span{font-size:11.5px;color:var(--faint)}
.em-tab[aria-selected="true"]{border-bottom-color:var(--accent);color:var(--text)}
.em[data-view="simple"] .only-expert,.em[data-view="expert"] .only-simple{display:none!important}
.em-start{display:flex;gap:10px;align-items:baseline;padding:14px 18px;border-radius:12px;background:var(--bg-subtle);font-size:14px;line-height:1.5;color:var(--muted)}
.em-start>b{color:var(--text);white-space:nowrap}.em-start span{flex:1}.em-start a{font-weight:600}
.em-hide{background:none;border:0;color:var(--faint);font:500 12.5px var(--font);cursor:pointer}
.em-strip{display:flex;gap:12px;align-items:center;padding:9px 14px;border:1px solid var(--border);border-radius:10px;background:var(--panel);font-size:12.5px}.em-strip span{flex:1;color:var(--muted)}
.em-mapbtn{background:none;border:0;color:var(--accent-text);font:600 12.5px var(--font);cursor:pointer;white-space:nowrap}
.em[data-view="expert"]:not(.map-open) .em-card{display:none}
.em-card{padding:4px 0 0}
.em-cols{display:flex;justify-content:space-between;font:600 11px var(--font);letter-spacing:.04em;text-transform:uppercase;color:var(--faint);margin-bottom:6px}
.em-svgwrap{position:relative}
.em-map{width:100%;height:auto;display:block;overflow:visible}
.em-link{fill:none;stroke:var(--border-strong);opacity:.6;transition:opacity .15s,stroke .15s}
.em-map.focused .em-link{opacity:.16}.em-map.focused .em-link.hot{stroke:var(--accent);opacity:.75}
.em-map g{cursor:pointer;outline:none}
.em-map rect{fill:var(--panel);stroke:var(--border);stroke-width:1;transition:stroke .15s,fill .15s}
.em-map g:hover rect,.em-map g:focus-visible rect{stroke:var(--accent)}
.em-map .em-n{font:600 13px var(--font);fill:var(--text)}.em-map .em-c{font:400 12px var(--font);fill:var(--faint)}.em-map .em-s{font:400 11.5px var(--font);fill:var(--muted)}.em-map .em-step{font:600 10.5px var(--font);fill:var(--faint)}
.em-map.focused g{opacity:.5;transition:opacity .15s}.em-map.focused g.hot,.em-map.focused g.sel{opacity:1}
.em-areanode.sel rect{fill:var(--accent-soft);stroke:var(--accent);stroke-width:1.5}.em-areanode.sel text{fill:var(--accent-text)!important}
.em-svc.hot rect{stroke:var(--accent)}.em-svc.hot .em-n{fill:var(--accent-text)}
.tone-accent{fill:var(--accent);background:var(--accent)}.tone-ask{fill:var(--ask);background:var(--ask)}.tone-ok{fill:var(--ok);background:var(--ok)}.tone-muted{fill:var(--muted);background:var(--muted)}.tone-warn{fill:var(--warn);background:var(--warn)}.tone-faint{fill:var(--faint);background:var(--faint)}
.em-tip{position:absolute;z-index:5;max-width:250px;padding:9px 11px;border-radius:9px;background:var(--text);color:var(--bg);font-size:12px;line-height:1.45;pointer-events:none;box-shadow:var(--shadow-pop)}
.em-legend{margin:10px 0 0;font-size:13px;color:var(--faint)}
.em-detail{display:flex;flex-direction:column;gap:14px;margin-top:18px;padding-top:28px;border-top:1px solid var(--border)}
.em-head{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap}.em-head>div:first-child{flex:1;min-width:220px}
.em-eyebrow{font:500 13px var(--font);color:var(--faint)}
.em-title{margin:2px 0 0;font-size:28px;font-weight:700;letter-spacing:-.02em}.em-title span{font-size:15px;font-weight:400;letter-spacing:0;color:var(--faint);margin-left:8px}
.em-blurb{margin:4px 0 0;color:var(--muted);font-size:15px}.em-blurb:empty{display:none}
.em.searching .em-eyebrow,.em.searching .em-blurb{visibility:hidden}
.em-search{height:34px;width:min(330px,100%);padding:0 12px;border:0;border-radius:9px;background:var(--hover);color:var(--text);font:14px var(--font)}
.em-mode{display:flex;gap:2px;padding:3px;border:1px solid var(--border);border-radius:8px;background:var(--bg-subtle)}
.em-mode button{border:0;background:none;padding:4px 12px;border-radius:6px;font:500 12.5px var(--font);color:var(--muted);cursor:pointer}.em-mode button[aria-pressed="true"]{background:var(--panel);color:var(--text);box-shadow:0 0 0 1px var(--border)}
.em-chips{display:flex;flex-wrap:wrap;gap:4px 22px;border-bottom:1px solid var(--border)}
.em-chip{padding:0 0 9px;margin-bottom:-1px;border:0;border-bottom:2px solid transparent;background:none;color:var(--muted);font:500 13.5px var(--font);cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.em-chip span{color:var(--faint)}.em-chip:hover{color:var(--text)}.em-chip[aria-pressed="true"]{color:var(--text);border-bottom-color:var(--text)}
.em-chip i,.em-pill i{width:7px;height:7px;border-radius:50%;display:inline-block;flex:none}
.em-list{display:flex;flex-direction:column}
.em-story{padding:18px 0 19px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:7px;scroll-margin-top:90px;transition:background .3s}
.em-story.flash{background:var(--accent-soft);box-shadow:-12px 0 0 var(--accent-soft),12px 0 0 var(--accent-soft)}
.em-top{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}.em-top h3{margin:0;font-size:17px;font-weight:600;letter-spacing:-.01em}.em-top h3 a{color:var(--text)}.em-top h3 a:hover{color:var(--accent-text);text-decoration:none}
.em-pill{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--faint)}
.em-area-tag{display:none;font-size:11.5px;color:var(--faint)}.em.searching .em-area-tag{display:inline}
.em-go{margin-left:auto;white-space:nowrap;font-size:14px;color:var(--accent-text)}.em-go:hover{text-decoration:none;opacity:.8}
.em-steps{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px 0;align-items:baseline}
.em-st{font-size:14.5px;line-height:1.5;color:var(--muted)}
.em-st+.em-st{margin-left:24px;position:relative}.em-st+.em-st::before{content:"→";position:absolute;left:-17px;color:var(--border-strong)}
.em-st b{font-weight:500;color:var(--faint)}
.em-st.k-code{color:var(--text)}.k-guard{color:var(--ask)!important}.k-job{color:var(--warn)!important}.k-service{color:var(--text)!important}.em-st.k-service::after,.em-key .k-service::after{content:" ↗";color:var(--faint)}
.em-st.guess{text-decoration:underline dotted var(--faint);text-underline-offset:4px}
.em-st.more{background:none;color:var(--faint);font-weight:400}
.em-code{display:flex;flex-wrap:wrap;gap:4px 6px;font:12px var(--mono);color:var(--muted)}.em-code a{color:var(--muted)}.em-code i{font-style:normal;color:var(--faint)}.em-code .g{color:var(--ask)}.em-sep{color:var(--faint)}
.em-meta{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:13px;color:var(--faint)}.em-meta code{font-size:12px;background:none;border:0;padding:0;color:var(--faint)}
.em-svcs{color:var(--muted)}.em-share{margin-left:auto;color:var(--muted)}.em-share code{color:var(--muted)!important}
.em-none{margin:0;font-size:12.5px;color:var(--faint)}
.em-key{display:flex;flex-wrap:wrap;gap:8px 20px;font-size:13px;color:var(--muted);margin:6px 0 0}.em-key .guess{text-decoration:underline dotted var(--faint);text-underline-offset:4px}
.em-table{width:100%;border-collapse:collapse;font-size:12.5px;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--panel)}
.em-table th{position:sticky;top:0;background:var(--bg-subtle);text-align:left;font:600 11px var(--font);text-transform:uppercase;letter-spacing:.04em;color:var(--faint);padding:8px 10px;border-bottom:1px solid var(--border)}
.em-table td{padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top}.em-table td code{font-size:11.5px;background:none;border:0;padding:0;overflow-wrap:anywhere}
.em-table .m{font:700 11px var(--mono);color:var(--accent-text)}.em-table .n{color:var(--muted);text-align:right}
@media (max-width:760px){.em-card{padding:10px;overflow-x:auto}.em-map{min-width:760px}.em-cols{min-width:760px}.em-go{margin-left:0}.em-share{margin-left:0}.em-table{display:block;overflow-x:auto}.em-tab span{display:none}}
/* trace page */
.back{display:inline-block;margin-bottom:14px;font-size:13px}
.trace-title code{font-size:.85em;background:none;padding:0}.trace-title .ep-method{font-size:.55em;vertical-align:middle}
.trace-kv{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:18px 0}
.trace-kv div{border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:var(--panel)}.trace-kv b{display:block;font-size:20px}.trace-kv span{font-size:12px;color:var(--faint)}
@media (max-width:640px){.trace-kv{grid-template-columns:repeat(2,minmax(0,1fr))}}
.trace-doc{border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:10px;padding:12px 16px;margin:8px 0 6px;background:var(--panel)}.trace-doc h3{margin:4px 0 6px;font-size:15px}
.twalk{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 10px;position:sticky;top:56px;z-index:4;background:var(--bg);padding:8px 0}
.trace-meta{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:13.5px;color:var(--faint);margin:0 0 18px}.trace-meta code{color:var(--faint)}.trace-meta .src code{color:var(--link)}
.tcols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:28px;align-items:start;border-top:1px solid var(--border);padding-top:20px}
.tcode{position:sticky;top:76px;border-radius:12px;background:var(--bg-subtle);overflow:hidden;max-height:calc(100vh - 100px);display:flex;flex-direction:column}
.tcode-head{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--border);font:500 13px var(--mono)}.tcode-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tcode-full{font:13px var(--font)}
.tcode-body{flex:1;min-height:0;overflow:auto;padding:8px 0}.tcode-body .code{font-size:13px}.tcode-body .loading{padding:14px 18px;color:var(--faint);font-size:13px}
.tcode-note{padding:12px 18px 16px;border-top:1px solid var(--border);font-size:13.5px;color:var(--muted)}
.tsteps{list-style:none;margin:0;padding:0}
.tstep{display:flex;gap:12px;align-items:flex-start;padding:10px 12px 10px calc(12px + var(--d) * 22px);border-radius:8px;cursor:pointer;position:relative}
.tstep:hover{background:var(--hover)}.tstep .tl{font-size:16px;line-height:1.35}.tstep.guard{cursor:default}.tstep.guard .tl{color:var(--ask)}.tstep.guard:hover{background:none}
.tcodeline{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:2px;font-size:12.5px;color:var(--muted)}.tcodeline code{color:var(--muted)}.tcodeline .src{font-size:12.5px}
.tguess{font-size:12px;color:var(--faint);text-decoration:underline dotted;text-underline-offset:3px}.tcond{font-size:12px;color:var(--faint)}

.tstep .tn{flex:none;width:18px;color:var(--faint);font-size:14px;font-weight:600;line-height:1.45}
.tstep.cur{background:var(--bg-subtle)}.tstep.cur .tn{color:var(--link)}.tstep.cur .tl{font-weight:600}
.tstep.repeat{opacity:.6}
.tb{min-width:0;flex:1}.tl{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:13.5px}
.tverb{color:var(--faint);font-size:12px}.tloc{margin-left:auto;font:12px var(--mono);color:var(--faint);height:auto;padding:0;border:0;background:none}.tloc.ext{font-family:var(--font)}

.tapis{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}.tapis.wide{margin-top:0}
.tapi{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-subtle);font-size:11.5px;color:var(--faint)}.tapi code{font-size:11.5px;background:none;padding:0;color:var(--text)}
.seq-scroll{overflow-x:auto;border:1px solid var(--border);border-radius:12px;background:var(--bg-subtle);padding:6px}
svg.seq{display:block;font-family:var(--font)}
svg.seq .lane rect{fill:var(--panel);stroke:var(--border-strong)}svg.seq .lane.ext rect{fill:var(--accent-soft);stroke:var(--accent)}
svg.seq .ln1{font-size:12px;font-weight:600;fill:var(--text)}svg.seq .ln2{font-size:10.5px;fill:var(--faint)}
svg.seq .life{stroke:var(--border-strong);stroke-dasharray:3 4}
svg.seq .arrow line,svg.seq .arrow path{stroke:var(--muted);stroke-width:1.4;fill:none}svg.seq .arrow circle{fill:var(--muted)}
svg.seq .arrow.ext line{stroke:var(--accent);stroke-dasharray:4 3}svg.seq .arrow.guess line,svg.seq .arrow.guess path{stroke-dasharray:2 3}
svg.seq .al{font:11.5px var(--mono);fill:var(--text);paint-order:stroke;stroke:var(--bg-subtle);stroke-width:4px}
svg.seq marker path{fill:var(--muted)}
svg.seq .arrow.cur line,svg.seq .arrow.cur path{stroke:var(--accent);stroke-width:2.4}svg.seq .arrow.cur .al{fill:var(--accent-text);font-weight:700}
.trace-note{margin-top:22px}
a.tapi.linked{color:var(--faint);text-decoration:none;border-color:var(--border-strong)}a.tapi.linked:hover{border-color:var(--accent);background:var(--accent-soft)}
.tapi .ext-ic{font-size:10px;color:var(--faint)}.tapi .renamed,.stack-note .renamed{font-style:normal;font-size:11px;padding:0 5px;border-radius:4px;background:var(--warn-soft);color:var(--warn)}
.stack-note{font-size:12.5px;margin:0 0 10px}
/* learn */
.learn-stack{font-size:14px;color:var(--muted);margin:10px 0 0}
.learn-overall{display:flex;align-items:center;gap:12px;margin:16px 0 0;font-size:14px;color:var(--muted)}.learn-overall .progress{width:120px;height:4px;background:var(--nav-sel)}.learn-overall .progress span{display:block;height:100%;width:0;background:var(--ok);border-radius:99px;transition:width .3s}
.chapters{padding-top:0!important}
.chapter{display:grid;grid-template-columns:260px minmax(0,1fr);gap:32px;padding:28px 0 30px;border-top:1px solid var(--border)}.chapter:first-child{border-top:0}
.ch-num{font-size:13px;font-weight:600;color:var(--faint)}.start-sec .chapter h2{font-size:24px;line-height:1.2;letter-spacing:-.015em;font-weight:600;margin:4px 0 6px}.ch-side p{font-size:15px;line-height:1.45;color:var(--muted);margin:0 0 8px}
.track-progress{font-size:13px;color:var(--faint)}
.lesson-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.lesson-list li+li{border-top:1px solid var(--border)}
.lesson-card{display:flex;gap:14px;align-items:flex-start;padding:12px 0;color:var(--text);text-decoration:none}
.lesson-card:hover{text-decoration:none}.lesson-card:hover .ln-title{text-decoration:underline}
.ln-num{flex:none;width:18px;font-weight:600;font-size:15px;color:var(--faint);line-height:1.4}
.ln-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.ln-title{font-size:17px;line-height:1.35;color:var(--link)}.ln-abstract{font-size:15px;line-height:1.45;color:var(--muted)}.ln-meta{font-size:13px;color:var(--faint)}
.ln-flag{margin-left:8px;font-weight:600}.ln-flag.bad{color:var(--bad)}.ln-flag.warn{color:var(--warn)}
.ln-done{flex:none;font-size:13px;font-weight:500;color:var(--ok);visibility:hidden;line-height:1.6}
.lesson-card.done .ln-done{visibility:visible}
.empty-card{border:1px dashed var(--border-strong);border-radius:12px;padding:18px 20px;background:var(--bg-subtle)}.empty-card h3{margin:0 0 6px}
.lesson .lede{font-size:19px}
.why{border-top:1px solid var(--border);padding-top:28px;margin:32px 0 8px;font-size:17px;line-height:1.47}.why b{display:block;font-size:28px;line-height:1.15;letter-spacing:-.015em;font-weight:700;margin-bottom:10px}
.doc-quote{margin:14px 0;border:0;border-radius:10px;background:var(--bg-subtle);overflow:hidden}
.doc-quote blockquote{margin:0;padding:16px 20px 6px;font-size:19px;line-height:1.45}
.doc-quote figcaption{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;padding:6px 20px 14px;font-size:13.5px}
.doc-quote figcaption a{font-weight:400}.doc-quote .verified{color:var(--ok);font-weight:400}
.drift{border:1px solid color-mix(in srgb,var(--warn) 35%,transparent);background:var(--warn-soft);border-radius:10px;padding:12px 16px;margin:20px 0;font-size:14px}.drift b{color:var(--warn)}
dfn.term{font-style:normal;border-bottom:1.5px dotted var(--accent);cursor:help;position:relative}
dfn.term:hover::after,dfn.term:focus::after{content:attr(data-def);position:absolute;left:0;top:calc(100% + 6px);z-index:30;width:max-content;max-width:300px;padding:9px 11px;border-radius:9px;background:var(--text);color:var(--bg);font-size:12.5px;line-height:1.45;font-weight:400;box-shadow:var(--shadow-pop);white-space:normal}
.glossary{margin:18px 0;border:1px solid var(--border);border-radius:10px;padding:10px 14px;background:var(--panel)}.glossary summary{cursor:pointer;font-weight:600;font-size:14px}
.glossary dl{margin:10px 0 0;display:grid;grid-template-columns:minmax(110px,max-content) 1fr;gap:6px 14px;font-size:13.5px}.glossary dt{font-weight:600}.glossary dd{margin:0;color:var(--muted)}
.predict,.change{margin:32px 0 0;border:0;border-top:1px solid var(--border);border-radius:0;padding:28px 0 0;background:none}.predict h3,.change h3{margin:6px 0 6px;font-size:21px;line-height:1.35;font-weight:600;letter-spacing:-.01em}.predict .eyebrow,.change .eyebrow{font-size:13px;color:var(--faint)}

.pr-options{display:flex;flex-direction:column;gap:0;margin:14px 0 4px;border:1px solid var(--border);border-radius:10px;overflow:hidden}
.pr-opt{display:flex;align-items:flex-start;gap:12px;text-align:left;padding:13px 16px;border:0;border-top:1px solid var(--border);border-radius:0;background:var(--bg);color:var(--text);font:16px/1.4 var(--font);cursor:pointer}.pr-opt:first-child{border-top:0}
.pr-opt:hover:not(:disabled){background:var(--bg-subtle)}.pr-opt:disabled{cursor:default}
.pr-key{flex:none;width:18px;height:18px;margin-top:1px;border-radius:50%;border:1.5px solid var(--border-strong);display:grid;place-items:center;font-size:0;color:transparent}
.pr-opt.right{background:var(--ok-soft)}.pr-opt.right .pr-key{background:var(--ok);border-color:var(--ok)}
.pr-opt.wrong{background:var(--bad-soft)}.pr-opt.wrong .pr-key{background:var(--bad);border-color:var(--bad)}
.pr-reveal{margin-top:12px}.pr-verdict{font-weight:600;margin:0 0 4px}.pr-verdict.ok{color:var(--ok)}.pr-verdict.no{color:var(--warn)}
.ch-files{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:13px;color:var(--muted);margin:10px 0}
.ch-checks{list-style:none;margin:10px 0 14px;padding:0;display:flex;flex-direction:column;gap:0;font-size:15px;border:1px solid var(--border);border-radius:10px;overflow:hidden}
.ch-checks li{display:flex;gap:10px;align-items:baseline;padding:11px 16px;border-top:1px solid var(--border)}.ch-checks li:first-child{border-top:0}.ch-mark{width:16px;text-align:center;color:var(--faint);font-weight:700}.ch-checks li.ok{color:var(--ok)}.ch-checks li.ok .ch-mark{color:var(--ok)}
.ch-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px}.ch-status{font-size:13px}.ch-status.ok{color:var(--ok);font-weight:600}
.change.passed .ch-checks{border-color:var(--ok)}.ch-other{font-size:12.5px;color:var(--warn);margin:8px 0 0}
.tw-guess{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);margin-left:6px;cursor:pointer}
.tguess-box{border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border));border-radius:12px;background:var(--bg-subtle);padding:12px 14px;margin:0 0 10px;font-size:14px}
.tg-opts{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 2px}.tg-opts .pr-opt{padding:7px 12px}
.tsteps.guessing .tstep:not(.seen) .tb{filter:blur(5px);user-select:none}.tsteps.guessing .tstep:not(.seen){pointer-events:none}
svg.seq.guessing .arrow:not(.seen) .al{opacity:0}svg.seq.guessing .arrow:not(.seen) line,svg.seq.guessing .arrow:not(.seen) path{opacity:.25}
pre.cmd{margin:6px 0 0;padding:8px 10px;border-radius:8px;background:var(--panel);border:1px solid var(--border);font:12.5px var(--mono);overflow-x:auto}
.ex-form{display:flex;gap:8px;margin:12px 0 8px}.ex-input{flex:1;min-width:0;height:36px;padding:0 12px;border:1px solid var(--border-strong);border-radius:9px;background:var(--panel);color:var(--text);font:13px var(--mono)}
.ex-result{margin:6px 0;font-size:14px;font-weight:550}.ex-result.ok{color:var(--ok)}.ex-result.near{color:var(--warn)}.ex-result.no{color:var(--bad)}
.ex-hint,.ex-answer{margin-top:8px;font-size:13.5px}.ex-hint summary,.ex-answer summary{cursor:pointer;color:var(--muted)}
.lesson-nav{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:34px}.lesson-nav .next-path{flex-direction:column;align-items:flex-start;gap:2px}.lesson-nav .right{align-items:flex-end;text-align:right}
@media (max-width:640px){.lesson-nav{grid-template-columns:1fr}.lesson-nav .right{align-items:flex-start;text-align:left}}
@media (max-width:820px){.mx-panel{position:absolute;inset:0 0 0 auto;width:min(320px,100%);box-shadow:var(--shadow-pop)}.mx-search{width:120px}}

/* start here */
.start{width:100%}
.start ~ footer.foot{display:none}
.hero-band{background:var(--hero-bg);color:var(--hero-text);padding:64px 72px 60px}
.hero-eyebrow{font-size:15px;font-weight:600;color:var(--hero-muted)}
.hero-title{font-size:48px;line-height:1.08;font-weight:700;letter-spacing:-.02em;margin:6px 0 12px;color:var(--hero-text);overflow-wrap:anywhere}
.hero-lede{font-size:21px;line-height:1.38;color:var(--hero-muted);max-width:720px;margin:0}
.hero-lede code{background:none;border:0;padding:0;color:inherit}
.hero-facts{display:flex;flex-wrap:wrap;gap:6px 22px;list-style:none;margin:22px 0 0;padding:0;font-size:14px;color:var(--hero-muted)}
.start-body{max-width:1044px;padding:52px 72px 72px}
.start-sec{border-top:1px solid var(--border);padding-top:40px;margin-top:52px}
.start-sec.first{border-top:0;padding-top:0;margin-top:0}
.start-sec h2{font-size:32px;line-height:1.125;font-weight:700;letter-spacing:-.01em;margin:0 0 14px}
.start-p{font-size:17px;line-height:1.47;margin:0 0 18px;max-width:720px}
.overall{display:flex;align-items:center;gap:12px;margin:0 0 22px;font-size:14px;color:var(--muted)}
.progress{display:inline-block;height:6px;width:90px;border-radius:99px;background:var(--hover);overflow:hidden;flex:none}
.progress.wide{width:180px}.progress i{display:block;height:100%;width:0;background:var(--ok);border-radius:99px;transition:width .3s}
.start .progress{width:120px;height:4px;background:var(--border)}.start .progress i{background:var(--link)}
.bigsearch{width:100%;max-width:720px;padding:13px 16px;border-radius:12px;font-size:17px;cursor:pointer;text-align:left;color:var(--faint)}
.bigsearch svg{width:18px;height:18px}.bigsearch span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bigsearch kbd{border:0;background:none;padding:0;font:13px var(--font);color:var(--faint)}
.bigsearch:hover{color:var(--muted)}
.topic-group{display:grid;grid-template-columns:220px minmax(0,1fr);gap:24px;border-top:1px solid var(--border);padding:22px 0}
.topic-group:first-of-type{margin-top:22px}
.topic-group h3{margin:0;font-size:17px;line-height:1.47;font-weight:600}
.topic-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:18px}
.topic-title{font-size:17px;line-height:1.47}
.start-label{margin-left:10px;font-size:13px;font-weight:600;color:var(--ok)}
.topic-abstract{margin:2px 0 0;font-size:15px;line-height:1.47;color:var(--muted)}
.topic-meta{margin:3px 0 0;font-size:13px;color:var(--faint)}
.path-done{margin-left:10px;color:var(--muted)}
.questions,.see-also{list-style:none;margin:0;padding:0}
.questions li{border-top:1px solid var(--border)}
.question{display:flex;align-items:baseline;gap:12px;padding:16px 0;font-size:17px;line-height:1.47;color:var(--text)}
.question:hover{text-decoration:none}.question:hover span:last-child{color:var(--link)}
.q-dot{width:7px;height:7px;border-radius:50%;background:var(--ask);flex:none;transform:translateY(-2px)}
.see-also li{margin:0 0 16px}.see-also a{font-size:17px}.see-also p{margin:2px 0 0;font-size:15px;color:var(--muted);max-width:720px}
.start-foot{margin-top:56px;font-size:12px;color:var(--faint)}
.path-section{margin:34px 0 0;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.next-path{display:flex;align-items:center;gap:10px;margin-top:36px;padding:16px 18px;border:1px solid var(--border);border-radius:14px;background:var(--panel);color:var(--text);text-decoration:none}
.next-path:hover{border-color:var(--accent);text-decoration:none}.next-path strong{flex:1}.next-path svg{width:16px;height:16px;color:var(--faint)}

/* items: folding, code, actions, read state */
.prose.fold{max-height:9.5em;overflow:hidden;-webkit-mask-image:linear-gradient(#000 60%,transparent);mask-image:linear-gradient(#000 60%,transparent)}
.prose.fold.open{max-height:none;-webkit-mask-image:none;mask-image:none}
.more{margin-top:4px;border:0;background:none;padding:0;color:var(--accent-text);font-size:13px;font-weight:550;cursor:pointer}
.snippet{margin-top:14px;border:0;border-radius:10px;background:var(--bg-subtle);overflow:hidden}
.snippet summary{display:flex;align-items:center;gap:6px;padding:7px 12px;cursor:pointer;list-style:none;font:12px var(--mono);color:var(--muted)}
.snippet summary::-webkit-details-marker{display:none}
.snippet summary svg{width:12px;height:12px;transition:transform .15s;flex:none}.snippet[open] summary svg{transform:rotate(90deg)}
.snippet summary .file{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.snippet summary .ln{color:var(--faint)}
.snippet[open] summary{border-bottom:0}
.snippet .code{display:block;overflow-x:auto;background:transparent;font-size:13px;padding-bottom:8px}
.snippet-foot{display:flex;justify-content:flex-end;padding:6px 8px;border-top:1px solid var(--border)}
.snippet-foot .src{background:transparent;border-color:transparent}
.actions{display:flex;flex-wrap:wrap;gap:4px;margin-top:10px;opacity:.55;transition:opacity .15s}
.item:hover .actions,.actions:focus-within{opacity:1}
.act{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 9px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--muted);font-size:12.5px;cursor:pointer}
.act:hover{background:var(--hover);color:var(--text)}.act svg{width:14px;height:14px}
.act[aria-pressed="true"]{color:var(--ok)}
.item.is-read h3{color:var(--muted)}
@media (hover:none){.actions{opacity:1}}

@media (max-width:1180px){.doc-layout{grid-template-columns:minmax(0,1fr)}.toc{display:none}}
@media (max-width:900px){.grid2{grid-template-columns:minmax(0,1fr)}.strip{grid-template-columns:repeat(2,minmax(0,1fr))}.strip .cell:nth-child(3){border-left:0}.strip .cell:nth-child(n+3){border-top:1px solid var(--border)}}
@media (max-width:820px){
  .topbar{padding:0 14px}.page{padding:24px 16px 64px}footer.foot{padding:24px 16px}
  h1{font-size:25px}
}
@media (max-width:760px){
  .shell{grid-template-columns:minmax(0,1fr)}
  .sidebar{position:fixed;left:0;top:0;z-index:45;width:min(300px,86vw);transform:translateX(-100%);transition:transform .2s}
  .sidebar.open{transform:none;box-shadow:var(--shadow-pop)}
  .menu-btn{display:inline-grid}
  .searchbtn{width:auto}.searchbtn .lbl,.searchbtn kbd{display:none}
  .hero-band{padding:40px 20px}.hero-title{font-size:36px}.hero-lede{font-size:19px}
  .start-body{padding:32px 20px}
  .topic-group{grid-template-columns:minmax(0,1fr);gap:12px}
  .start-sec h2{font-size:28px}
}
`;

export const THEME_BOOT = `(function(){try{var t=localStorage.getItem("hr-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}})();`;

export const CLIENT_JS = `
(function(){
  var $ = function(s, r){ return (r||document).querySelector(s); };
  var $$ = function(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); };
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }

  // theme: system -> light -> dark
  var themeBtn = $("#theme");
  if (themeBtn) themeBtn.addEventListener("click", function(){
    var cur = document.documentElement.dataset.theme || "system";
    var next = cur === "system" ? "light" : cur === "light" ? "dark" : "system";
    if (next === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
    try { if (next === "system") localStorage.removeItem("hr-theme"); else localStorage.setItem("hr-theme", next); } catch (e) {}
    themeBtn.title = "Theme: " + next;
  });

  // re-check against the code, in the background
  if (/[?&]refresh=/.test(location.search) && history.replaceState) history.replaceState(null, "", location.pathname + location.hash);
  var toastEl = $("#toast"), toastTimer;
  var lastToast = null;
  function toast(text, tone, ms){
    lastToast = { text: text, tone: tone, ms: ms };
    if (!toastEl) return;
    toastEl.textContent = text; toastEl.className = "toast show " + (tone || "");
    clearTimeout(toastTimer); toastTimer = setTimeout(function(){ toastEl.className = "toast " + (tone || ""); }, ms || 3200);
  }
  try {
    var pending = JSON.parse(sessionStorage.getItem("hr-toast") || "null");
    sessionStorage.removeItem("hr-toast");
    if (pending) toast(pending.text, pending.tone, pending.ms);
  } catch (e) {}
  function ago(iso){
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 45) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    return "at " + new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function paintChecked(){ $$("[data-checked-at]").forEach(function(el){ el.textContent = ago(el.dataset.checkedAt); }); }
  paintChecked(); setInterval(paintChecked, 30000);
  var recheckBtn = $("#recheck");
  if (recheckBtn) recheckBtn.addEventListener("click", function(){
    var lbl = $(".lbl", recheckBtn), was = lbl.textContent;
    recheckBtn.disabled = true; recheckBtn.classList.add("busy"); lbl.textContent = "Checking…";
    fetch("/api/recheck", { method: "POST" }).then(function(r){ if (!r.ok) throw new Error(); return r.json(); }).then(function(d){
      var sig = (($('meta[name="houserules-state"]') || {}).content) || "";
      $$("[data-checked-at]").forEach(function(el){ el.dataset.checkedAt = d.checkedAt; }); paintChecked();
      var summary = d.total ? "Checked " + d.total + " item" + (d.total === 1 ? "" : "s") : "Scanned the code";
      if (d.newlyBroken.length) toast(d.newlyBroken.length + " item" + (d.newlyBroken.length === 1 ? " is" : "s are") + " now out of date: " + d.newlyBroken[0] + (d.newlyBroken.length > 1 ? " and more" : ""), "bad", 5000);
      else if (d.fixed) toast(summary + " · " + d.fixed + " fixed since the last check", "", 3600);
      else if (d.broken) toast(summary + " · " + d.broken + " still out of date", "bad");
      else if (d.changed) toast(summary + " · evidence still matches; " + d.changed + " cited file" + (d.changed === 1 ? "" : "s") + " changed", "warn");
      else toast(summary + " · everything still matches the code" + (d.ms > 400 ? " (" + (d.ms / 1000).toFixed(1) + "s)" : ""));
      if (d.sig !== sig) {
        // Results changed: re-render the page, and keep the message on screen across the reload.
        try { sessionStorage.setItem("hr-toast", JSON.stringify(lastToast)); } catch (e) {}
        setTimeout(function(){ location.reload(); }, 900);
      }
    }).catch(function(){ toast("Couldn't run the check. Is the preview still running?", "bad", 5000); }).then(function(){
      recheckBtn.disabled = false; recheckBtn.classList.remove("busy"); lbl.textContent = was;
    });
  });

  // read tracking (per viewer, in this browser only)
  var repoKey = "hr-read:" + ((($('meta[name="houserules-repo"]') || {}).content) || "repo");
  function readSet(){ try { return new Set(JSON.parse(localStorage.getItem(repoKey) || "[]")); } catch (e) { return new Set(); } }
  function saveRead(set){ try { localStorage.setItem(repoKey, JSON.stringify(Array.from(set))); } catch (e) {} }
  var READ_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>';
  var UNREAD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>';
  function paintRead(){
    var set = readSet();
    $$(".item[data-key]").forEach(function(it){
      var on = set.has(it.dataset.key), btn = $(".read-toggle", it);
      it.classList.toggle("is-read", on);
      if (btn) { btn.setAttribute("aria-pressed", on ? "true" : "false"); btn.innerHTML = (on ? READ_ICON : UNREAD_ICON) + "<span>" + (on ? "Read" : "Mark as read") + "</span>"; }
    });
    $$("[data-progress]").forEach(function(p){
      var keys = p.dataset.progress.split(" ").filter(Boolean), done = keys.filter(function(k){ return set.has(k); }).length;
      var bar = $("i", p); if (bar) bar.style.width = (keys.length ? Math.round(done / keys.length * 100) : 0) + "%";
    });
    $$("[data-progress-text]").forEach(function(el){
      var keys = el.dataset.progressText.split(" ").filter(Boolean), done = keys.filter(function(k){ return set.has(k); }).length;
      var t = el.classList.contains("ptext") ? el : $(".ptext", el);
      if (t && done) t.textContent = (done === keys.length ? "All " + keys.length + " read. Nice." : "You've read " + done + " of " + keys.length) + (el.dataset.suffix || "");
    });
    $$("[data-done-keys]").forEach(function(el){
      var keys = el.dataset.doneKeys.split(" ").filter(Boolean), done = keys.filter(function(k){ return set.has(k); }).length;
      el.hidden = !done;
      el.textContent = done === keys.length ? "\u2713 read" : done + " of " + keys.length + " read";
    });
  }
  $$(".read-toggle").forEach(function(btn){
    btn.addEventListener("click", function(){
      var key = btn.closest(".item").dataset.key, set = readSet();
      if (set.has(key)) set.delete(key); else set.add(key);
      saveRead(set); paintRead();
    });
  });
  paintRead();

  // copy prompt / link
  function copy(text, done){
    if (!navigator.clipboard) { toast("Copying isn't available here", "bad"); return; }
    navigator.clipboard.writeText(text).then(function(){ toast(done); }, function(){ toast("Couldn't copy", "bad"); });
  }
  $$("[data-copy]").forEach(function(b){ b.addEventListener("click", function(){ copy(b.dataset.copy, b.dataset.done || "Copied"); }); });
  $$("[data-copy-link]").forEach(function(b){ b.addEventListener("click", function(){ copy(location.origin + location.pathname + b.dataset.copyLink, "Link copied"); }); });

  // fold long explanations
  $$(".more").forEach(function(b){
    b.addEventListener("click", function(){
      var p = b.previousElementSibling, open = p.classList.toggle("open");
      b.textContent = open ? "Show less" : "Show more";
    });
  });

  // Mermaid diagrams written by the agent: load the renderer only when a page has one.
  var mermaidBlocks = $$("pre > code.language-mermaid");
  if (mermaidBlocks.length) {
    var dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    var s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js";
    s.onload = function(){
      window.mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", fontFamily: getComputedStyle(document.body).fontFamily, securityLevel: "strict" });
      mermaidBlocks.forEach(function(code){
        var div = document.createElement("div"); div.className = "mermaid"; div.textContent = code.textContent;
        code.parentNode.replaceWith(div);
      });
      window.mermaid.run({ querySelector: ".mermaid" });
    };
    s.onerror = function(){ mermaidBlocks.forEach(function(code){ code.parentNode.setAttribute("title", "Offline: showing the diagram source"); }); };
    document.head.appendChild(s);
  }

  // ----- map explorer: levels, lenses, focus + blast radius, search, flow walkthrough, zoom/pan, full screen -----
  // (lens colours never fill the node: a strip, a light tint and a number keep every label readable)
  var mx = $("#map-explorer"), mapData = null;
  try { mapData = JSON.parse(($("#map-data") || {}).textContent || "null"); } catch (e) {}
  if (mx && mapData) (function(){
    var svg = $('.mx-level[data-for="modules"] svg.arch', mx);
    var panel = $(".mx-panel", mx), caption = $(".mx-caption", mx), legend = $(".mx-legend", mx);
    var nodes = {}; $$(".node", svg).forEach(function(n){ nodes[n.dataset.id] = n; });
    var out = {}, inn = {};
    mapData.edges.forEach(function(e){ (out[e.from] = out[e.from] || []).push(e.to); (inn[e.to] = inn[e.to] || []).push(e.from); });
    function closure(start, graph){ var seen = {}, stack = [start]; while (stack.length) { var c = stack.pop(); (graph[c] || []).forEach(function(n){ if (!seen[n] && n !== start) { seen[n] = 1; stack.push(n); } }); } return Object.keys(seen); }
    function press(group, value){ $$('[data-' + group + ']', mx).forEach(function(b){ if (b.tagName === "BUTTON" && b.closest(".seg")) b.setAttribute("aria-pressed", b.dataset[group] === value ? "true" : "false"); }); }

    // zoom + pan on the visible level, by moving the viewBox
    function vb(s){ return s.viewBox.baseVal; }
    function fit(s){ s = s || current(); var w = +s.dataset.w, h = +s.dataset.h; s.setAttribute("viewBox", "0 0 " + w + " " + h); zoomed = false; if (typeof refreshState === "function" && resetBtn) refreshState(); }
    function current(){ return $('.mx-level:not([hidden]) svg.arch', mx); }
    function zoom(s, factor, cx, cy){
      var v = vb(s); var nw = Math.min(Math.max(v.width * factor, 120), +s.dataset.w * 4), nh = nw * v.height / v.width;
      cx = cx == null ? v.x + v.width / 2 : cx; cy = cy == null ? v.y + v.height / 2 : cy;
      s.setAttribute("viewBox", [cx - (cx - v.x) * nw / v.width, cy - (cy - v.y) * nh / v.height, nw, nh].join(" "));
      zoomed = true; refreshState();
    }
    function toSvg(s, ev){ var r = s.getBoundingClientRect(), v = vb(s); return { x: v.x + (ev.clientX - r.left) / r.width * v.width, y: v.y + (ev.clientY - r.top) / r.height * v.height }; }
    $$("svg.arch", mx).forEach(function(s){
      s.addEventListener("wheel", function(ev){
        if (!mx.classList.contains("fullscreen") && !ev.ctrlKey && !ev.metaKey) return; // don't hijack page scrolling
        ev.preventDefault(); var p = toSvg(s, ev); zoom(s, ev.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y);
      }, { passive: false });
      var drag = null, moved = false;
      s.addEventListener("pointerdown", function(ev){ drag = { x: ev.clientX, y: ev.clientY, v: vb(s) && [vb(s).x, vb(s).y] }; moved = false; });
      window.addEventListener("pointermove", function(ev){
        if (!drag || !ev.buttons) return; var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        moved = true; s.classList.add("dragging");
        var r = s.getBoundingClientRect(), v = vb(s);
        s.setAttribute("viewBox", [drag.v[0] - dx / r.width * v.width, drag.v[1] - dy / r.height * v.height, v.width, v.height].join(" "));
      });
      window.addEventListener("pointerup", function(){ drag = null; s.classList.remove("dragging"); });
      s.addEventListener("click", function(ev){ if (moved) { ev.preventDefault(); ev.stopPropagation(); moved = false; } }, true);
    });
    $$("[data-zoom]", mx).forEach(function(b){ b.addEventListener("click", function(){ var s = current(); if (b.dataset.zoom === "fit") fit(s); else zoom(s, b.dataset.zoom === "in" ? 1 / 1.25 : 1.25); }); });
    var expand = $(".mx-expand", mx), stateBar = $(".mx-state", mx), resetBtn = $(".mx-reset", mx), zoomed = false;
    function setFull(on){ mx.classList.toggle("fullscreen", on); expand.textContent = on ? "← Back to page" : "Expand"; document.body.style.overflow = on ? "hidden" : ""; fit(); refreshState(); }
    // What's active, each clearable, plus one "Reset view" to get back to the plain map.
    function refreshState(){
      var parts = [];
      if (typeof lens !== "undefined" && lens !== "structure") parts.push(["lens", "Colour by", ({ size: "Size", docs: "Doc coverage", attention: "Needs attention" })[lens]]);
      if (typeof selected !== "undefined" && selected) parts.push(["focus", "Focused", label(selected)]);
      if (typeof flow !== "undefined" && flow) parts.push(["walk", "Walking", flow.title]);
      if (typeof search !== "undefined" && search.value.trim()) parts.push(["search", "Search", search.value.trim()]);
      if (zoomed) parts.push(["zoom", "Zoomed", "in"]);
      resetBtn.hidden = !parts.length;
      guide();
      stateBar.hidden = !parts.length && !mx.classList.contains("fullscreen");
      stateBar.innerHTML = parts.map(function(p){ return '<span class="st">' + p[1] + ": <b>" + esc(p[2]) + '</b><button type="button" data-clear="' + p[0] + '" aria-label="Clear ' + p[1] + '">×</button></span>'; }).join("") +
        (mx.classList.contains("fullscreen") ? '<span class="hint">Esc to go back · scroll to zoom · drag to move</span>' : "");
      $$("[data-clear]", stateBar).forEach(function(b){ b.addEventListener("click", function(){ clearPart(b.dataset.clear); }); });
    }
    function clearPart(what){
      if (what === "lens") { lens = "structure"; press("lens", lens); applyLens(); }
      else if (what === "focus") select(null);
      else if (what === "walk") stopWalk();
      else if (what === "search") { search.value = ""; search.dispatchEvent(new Event("input")); }
      else if (what === "zoom") { fit(); }
      refreshState();
    }
    resetBtn.addEventListener("click", function(){ ["walk", "focus", "lens", "search", "zoom"].forEach(clearPart); });
    expand.addEventListener("click", function(){ setFull(!mx.classList.contains("fullscreen")); });
    document.addEventListener("keydown", function(ev){
      if (/INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || "")) return;
      if (!mx.classList.contains("fullscreen") && ev.key !== "f") return;
      if (ev.key === "Escape") setFull(false);
      else if (ev.key === "f") setFull(!mx.classList.contains("fullscreen"));
      else if (ev.key === "+" || ev.key === "=") zoom(current(), 1 / 1.25);
      else if (ev.key === "-") zoom(current(), 1.25);
      else if (ev.key === "0") fit();
    });

    // A plain-words line saying what the current view shows and what to do next.
    var guideEl = $(".mx-guide", mx);
    var KEY = '<span class="key"><i></i>folder of code</span><span class="key"><i class="arr"></i>imports (thicker = more)</span><span class="key"><i class="svc"></i>outside service</span>';
    function guide(){
      if (!guideEl) return;
      var sys = mx.dataset.level === "system", l = typeof lens === "undefined" ? "structure" : lens;
      var msg = sys ? "<b>The big picture:</b> who uses the app, and the data and outside services it talks to. Switch to <b>Modules</b> to look inside."
        : typeof flow !== "undefined" && flow ? "<b>Walking a flow:</b> the blue box is where the current step runs; numbers show which steps happen in each folder."
        : typeof selected !== "undefined" && selected ? "<b>" + esc(label(selected)) + "</b> and its direct neighbours are highlighted. Faded boxes aren't connected to it. Click empty space or × to clear."
        : l === "size" ? "<b>Colour by size:</b> the darker the box, the more lines of code in it."
        : l === "docs" ? "<b>Colour by doc coverage:</b> darker = more doc items explain this module. Pale boxes have little written about them."
        : l === "attention" ? "<b>Colour by needs attention:</b> red = doc items here no longer match the code."
        : "<b>How to read this:</b> each box is a folder, each arrow means one folder imports another. Hover a box to trace its links; click it for details.";
      guideEl.innerHTML = "<span>" + msg + "</span>" + (sys ? "" : KEY);
    }

    // levels: system context vs modules
    $$("[data-level]", mx).forEach(function(b){ if (b.tagName !== "BUTTON") return; b.addEventListener("click", function(){
      press("level", b.dataset.level); mx.dataset.level = b.dataset.level;
      $$(".mx-level", mx).forEach(function(l){ l.hidden = l.dataset.for !== b.dataset.level; });
      $$(".mx-lenses, .mx-flow, .mx-search", mx).forEach(function(el){ el.style.display = b.dataset.level === "modules" ? "" : "none"; });
      fit(); guide();
    }); });

    // lenses: one dimension at a time
    var lens = "structure";
    function applyLens(){
      var vals = {}, max = 0;
      Object.keys(mapData.modules).forEach(function(id){
        var m = mapData.modules[id];
        var v = lens === "size" ? m.lines : lens === "docs" ? m.docs.length : lens === "attention" ? m.attention : 0;
        vals[id] = v; max = Math.max(max, v);
      });
      svg.classList.toggle("lens-on", lens !== "structure");
      Object.keys(nodes).forEach(function(id){
        var r = $("rect", nodes[id]), heat = $(".heat", nodes[id]), badge = $(".hv", nodes[id]);
        var color = lens === "attention" ? "var(--bad)" : "var(--accent)";
        if (lens === "structure" || !max || !vals[id]) { r.style.fill = ""; heat.style.stroke = ""; badge.textContent = ""; return; }
        var t = vals[id] / max;
        r.style.fill = "color-mix(in srgb, " + color + " " + Math.round(4 + t * 14) + "%, var(--panel))";
        heat.style.stroke = "color-mix(in srgb, " + color + " " + Math.round(35 + t * 65) + "%, transparent)";
        badge.textContent = lens === "size" ? "" : lens === "docs" ? vals[id] + " doc" + (vals[id] === 1 ? "" : "s") : vals[id] + " stale";
        badge.style.fill = color;
      });
      legend.innerHTML = lens === "structure" ? "" :
        lens === "size" ? 'Colour = lines of code <span class="ramp"></span> largest: ' + max.toLocaleString() + " lines" :
        lens === "docs" ? 'Colour = doc items citing the module <span class="ramp"></span> most: ' + max + (max ? "" : " (no docs yet)") :
        (max ? 'Colour = out-of-date doc items <span class="ramp bad"></span> most: ' + max : "Nothing out of date: every doc item still matches the code.");
    }
    $$("[data-lens]", mx).forEach(function(b){ b.addEventListener("click", function(){ lens = b.dataset.lens; press("lens", lens); applyLens(); refreshState(); }); });

    // focus: click a module to see what it depends on, what depends on it, and the blast radius
    var selected = null;
    function label(id){ return (mapData.modules[id] || {}).label || (mapData.services.filter(function(s){ return s.id === id; })[0] || {}).name || id; }
    function chips(ids){ return ids.length ? '<div class="chipline">' + ids.map(function(i){ return '<button type="button" class="mchip" data-go="' + i + '">' + esc(label(i)) + "</button>"; }).join("") + "</div>" : '<p class="faint">None</p>'; }
    function select(id){
      selected = id; svg.dataset.locked = id ? "1" : ""; svg.classList.remove("focus");
      var keep = {}; if (id) { keep[id] = 1; (out[id] || []).concat(inn[id] || []).forEach(function(n){ keep[n] = 1; }); }
      Object.keys(nodes).forEach(function(n){ nodes[n].classList.remove("hl"); nodes[n].classList.toggle("sel", n === id); nodes[n].classList.toggle("dim", Boolean(id) && !keep[n]); });
      $$(".edge", svg).forEach(function(e){ var on = !id || e.dataset.from === id || e.dataset.to === id; e.classList.toggle("dim", !on); e.classList.toggle("hl", Boolean(id) && on); });
      refreshState();
      if (!id) { panel.hidden = true; return; }
      var m = mapData.modules[id], blast = closure(id, inn), uses = mapData.services.filter(function(s){ return s.usedBy.indexOf(id) >= 0; });
      panel.innerHTML = '<button type="button" class="mx-close" aria-label="Close">×</button><h4>' + esc(m.label) + '</h4><div class="dir">' + esc(m.dir || "(repo root)") + "</div>" +
        '<div class="kv"><div><b>' + m.files + "</b><span>files</span></div><div><b>" + m.lines.toLocaleString() + "</b><span>lines</span></div><div><b>" + m.docs.length + "</b><span>doc items</span></div></div>" +
        (blast.length ? '<div class="blast"><b>Blast radius:</b> changing this can affect ' + blast.length + " other module" + (blast.length === 1 ? "" : "s") + ".</div>" : '<div class="blast" style="background:var(--ok-soft);color:var(--ok)">Nothing else imports this module, so changes stay local.</div>') +
        "<h5>Imported by</h5>" + chips(inn[id] || []) + "<h5>Imports</h5>" + chips(out[id] || []) +
        (uses.length ? "<h5>Third-party services</h5><p>" + uses.map(function(s){ return esc(s.name); }).join(", ") + "</p>" : "") +
        "<h5>Key files</h5><ul>" + m.topFiles.map(function(f){ return '<li><a class="src" href="/source?path=' + encodeURIComponent(f.path) + '" data-path="' + esc(f.path) + '"><span class="file">' + esc(f.path.split("/").pop()) + "</span></a>" + (f.importers ? ' <span class="faint">· ' + f.importers + " importers</span>" : "") + "</li>"; }).join("") + "</ul>" +
        (m.docs.length ? "<h5>What the docs say about it</h5><ul>" + m.docs.slice(0, 8).map(function(d){ return '<li><a href="' + d.href + '">' + esc(d.title) + "</a></li>"; }).join("") + "</ul>" : "") +
        '<p style="margin-top:14px"><a href="/source?path=' + encodeURIComponent(m.dir) + '">Open the folder →</a></p>';
      panel.hidden = false;
      $(".mx-close", panel).addEventListener("click", function(){ select(null); });
      $$("[data-go]", panel).forEach(function(c){ c.addEventListener("click", function(){ if (mapData.modules[c.dataset.go]) select(c.dataset.go); }); });
      $$(".src[data-path]", panel).forEach(function(a){ a.addEventListener("click", function(ev){ if (openSource(a.dataset.path)) ev.preventDefault(); }); });
    }
    Object.keys(nodes).forEach(function(id){ nodes[id].addEventListener("click", function(ev){ ev.preventDefault(); select(selected === id ? null : id); }); });
    svg.addEventListener("click", function(ev){ if (selected && !flow && !ev.target.closest(".node,.svc-node")) select(null); }); // empty space clears the focus
    guide();

    // search
    var search = $(".mx-search", mx);
    search.addEventListener("input", function(){
      var q = search.value.trim().toLowerCase(), first = null;
      Object.keys(nodes).forEach(function(id){ var hit = q && mapData.modules[id].label.toLowerCase().indexOf(q) >= 0; nodes[id].classList.toggle("match", Boolean(hit)); if (hit && !first) first = id; });
      refreshState();
    });
    search.addEventListener("keydown", function(ev){ if (ev.key === "Enter") { var m = $(".node.match", svg); if (m) select(m.dataset.id); } });

    // guided walkthrough of a traced flow across the modules
    var flowSel = $(".mx-flow", mx), flow = null, stepIdx = 0, timer = null;
    var cur0 = null;
    function pause(){ clearInterval(timer); timer = null; }
    function showStep(){
      var steps = flow.steps, s = steps[stepIdx]; svg.dataset.locked = "1"; svg.classList.remove("focus");
      Object.keys(nodes).forEach(function(n){ nodes[n].classList.remove("step", "visited"); nodes[n].classList.add("dim"); });
      $$(".edge", svg).forEach(function(e){ e.classList.remove("walk"); e.classList.add("dim"); });
      for (var i = 0; i <= stepIdx; i++) { var mm = steps[i].module; if (mm && nodes[mm]) { nodes[mm].classList.remove("dim"); nodes[mm].classList.toggle("visited", i < stepIdx); if (i === stepIdx) nodes[mm].classList.add("step"); }
        if (i > 0 && steps[i - 1].module !== steps[i].module) $$(".edge", svg).forEach(function(e){ if (e.dataset.from === steps[i - 1].module && e.dataset.to === steps[i].module) { e.classList.remove("dim"); e.classList.add("walk"); } }); }
      caption.hidden = false;
      // Number each box with the steps that happen in it, so steps inside one folder still read as progress.
      var nums = {}; steps.forEach(function(st, i){ if (st.module) (nums[st.module] = nums[st.module] || []).push(i + 1); });
      Object.keys(nodes).forEach(function(n){ var b = $(".hv", nodes[n]); if (!b) return; b.textContent = nums[n] ? (nums[n].length > 1 && nums[n][nums[n].length - 1] - nums[n][0] === nums[n].length - 1 ? nums[n][0] + "–" + nums[n][nums[n].length - 1] : nums[n].join(",")) : ""; b.style.fill = "var(--accent)"; });
      if (cur0 = s.module && nodes[s.module]) { cur0.classList.remove("pulse"); void cur0.getBBox(); cur0.classList.add("pulse"); }
      caption.innerHTML = '<span class="num">' + (stepIdx + 1) + '</span><div class="txt"><b><code>' + esc(s.label) + "</code></b> in " + esc(s.file.split("/").pop()) + (s.line ? ":" + s.line : "") +
        "<small>Step " + (stepIdx + 1) + " of " + steps.length + (s.module ? " · in " + esc(label(s.module)) : "") + " · " + esc(flow.title) + "</small></div>" +
        '<div class="ctl"><button type="button" class="btn" data-step="prev"' + (stepIdx === 0 ? " disabled" : "") + '>← Back</button>' +
        '<button type="button" class="btn" data-step="play" title="Move to the next step every 2 seconds">' + (timer ? "❚❚ Pause" : stepIdx === steps.length - 1 ? "↻ Replay" : "▶ Auto-play") + "</button>" +
        '<button type="button" class="btn primary" data-step="next">' + (stepIdx === steps.length - 1 ? "Finish" : "Next →") + '</button><button type="button" class="btn ghost" data-step="code">Open code</button></div>' +
        '<div class="mx-dots">' + steps.map(function(st, i){ return '<button type="button" data-go-step="' + i + '" class="' + (i === stepIdx ? "cur" : i < stepIdx ? "done" : "") + '" title="Step ' + (i + 1) + ": " + esc(st.label) + '"></button>'; }).join("") + "</div>" +
        '<span class="mx-timer' + (timer ? " run" : "") + '"></span>';
      $$("[data-step]", caption).forEach(function(b){ b.addEventListener("click", function(){ step(b.dataset.step); }); });
      $$("[data-go-step]", caption).forEach(function(b){ b.addEventListener("click", function(){ pause(); stepIdx = +b.dataset.goStep; showStep(); }); });
      // Keep the current step in view: pan the map when full screen, scroll the page otherwise.
      var cur = cur0;
      if (cur) {
        if (mx.classList.contains("fullscreen")) {
          var bb = cur.getBBox ? $("g", cur).getBBox() : null, t = $("g", cur).transform.baseVal.consolidate(), v = vb(svg);
          if (t) { var cx = t.matrix.e + (bb ? bb.width / 2 : 90), cy = t.matrix.f + (bb ? bb.height / 2 : 27); svg.setAttribute("viewBox", [cx - v.width / 2, cy - v.height / 2, v.width, v.height].join(" ")); }
        } else {
          var r = cur.getBoundingClientRect(), barBottom = caption.getBoundingClientRect().bottom; if (r.top < barBottom + 10 || r.bottom > innerHeight - 20) window.scrollBy({ top: r.top - (barBottom + innerHeight) / 2 + r.height / 2, behavior: "smooth" });
        }
      }
    }
    function stopWalk(){ clearInterval(timer); timer = null; flow = null; applyLens(); svg.dataset.locked = ""; setTimeout(refreshState, 0); caption.hidden = true; flowSel.value = ""; select(null); Object.keys(nodes).forEach(function(n){ nodes[n].classList.remove("step", "visited", "dim"); }); $$(".edge", svg).forEach(function(e){ e.classList.remove("walk", "dim"); }); }
    function step(what){
      if (!flow) return;
      if (what === "code") { var s = flow.steps[stepIdx]; openSource(s.file, s.line, null, flow.title); return; }
      if (what === "play") {
        if (timer) pause();
        else {
          if (stepIdx === flow.steps.length - 1) stepIdx = 0; // replay from the start
          timer = setInterval(function(){ if (stepIdx < flow.steps.length - 1) stepIdx++; if (stepIdx === flow.steps.length - 1) pause(); showStep(); }, 1800);
        }
        showStep(); return;
      }
      pause();
      if (what === "next") { if (stepIdx === flow.steps.length - 1) return stopWalk(); stepIdx++; }
      if (what === "prev" && stepIdx > 0) stepIdx--;
      showStep();
    }
    if (flowSel) flowSel.addEventListener("change", function(){
      if (flowSel.value === "") return stopWalk();
      select(null); flow = mapData.flows[+flowSel.value]; stepIdx = 0; showStep(); refreshState();
    });
  })();

  // architecture map: highlight a module's connections on hover
  $$("svg.arch").forEach(function(svg){
    function focus(id){
      if (svg.dataset.locked) return; // a selection or walkthrough owns the highlighting
      svg.classList.toggle("focus", Boolean(id));
      $$(".edge", svg).forEach(function(e){ e.classList.toggle("hl", Boolean(id) && (e.dataset.from === id || e.dataset.to === id)); });
      $$(".node", svg).forEach(function(n){
        var linked = id && (n.dataset.id === id || $$(".edge.hl", svg).some(function(e){ return e.dataset.from === n.dataset.id || e.dataset.to === n.dataset.id; }));
        n.classList.toggle("hl", Boolean(linked));
      });
    }
    $$(".node,.svc-node", svg).forEach(function(n){
      n.addEventListener("mouseenter", function(){ focus(n.dataset.id); });
      n.addEventListener("mouseleave", function(){ focus(null); });
    });
  });

  // entry points: Simplified/Expert tabs, the who → area → service map, and a story per way in
  var em = $(".em");
  if (em) (function(){
    var VIEW = "hr-ep-view", MAP = "hr-ep-map", START = "hr-ep-start";
    var map = $(".em-map", em), wrap = $(".em-svgwrap", em), tip = $(".em-tip", em), list = $(".em-list", em), table = $(".em-table", em);
    var search = $(".em-search", em), empty = $(".em-empty", em), chipsBox = $(".em-chips", em);
    var areas = JSON.parse($(".em-areas", em).textContent);
    var st = { area: em.dataset.area, aud: "", q: "", mode: "stories" };
    function store(k, v){ try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
    function read(k){ try { return localStorage.getItem(k); } catch (e) { return null; } }
    function setView(v){
      em.dataset.view = v;
      $$(".em-tab", em).forEach(function(t){ t.setAttribute("aria-selected", t.dataset.view === v ? "true" : "false"); });
      store(VIEW, v);
      if (v === "simple") setMode("stories");
    }
    function setMode(m){
      st.mode = m;
      $$(".em-mode button", em).forEach(function(b){ b.setAttribute("aria-pressed", b.dataset.mode === m ? "true" : "false"); });
      apply();
    }
    function pressChips(){ $$(".em-chip", chipsBox).forEach(function(c){ c.setAttribute("aria-pressed", c.dataset.aud === st.aud ? "true" : "false"); }); }
    function selectArea(id){
      var a = areas.filter(function(x){ return x.id === id; })[0];
      if (!a) return;
      st.area = id; st.aud = "";
      em.dataset.area = id;
      $(".em-eyebrow", em).textContent = a.order != null ? "Step " + a.order + " of the customer journey" : "Area";
      $(".em-title", em).innerHTML = "";
      $(".em-title", em).appendChild(document.createTextNode(a.title + " "));
      var n = document.createElement("span"); n.textContent = a.count + " ways in"; $(".em-title", em).appendChild(n);
      $(".em-blurb", em).textContent = a.blurb;
      chipsBox.innerHTML = a.chips;
      highlight(); apply();
    }
    function highlight(){
      map.classList.add("focused");
      var auds = {}, svcs = {};
      $$(".em-link", map).forEach(function(l){
        var hot = l.dataset.area === st.area && (!st.aud || !l.dataset.aud || l.dataset.aud === st.aud);
        l.classList.toggle("hot", hot);
        if (hot && l.dataset.aud) auds[l.dataset.aud] = 1;
        if (hot && l.dataset.svc) svcs[l.dataset.svc] = 1;
      });
      $$(".em-areanode", map).forEach(function(g){ g.classList.toggle("sel", g.dataset.area === st.area); });
      $$(".em-who", map).forEach(function(g){ g.classList.toggle("hot", !!auds[g.dataset.aud]); });
      $$(".em-svc", map).forEach(function(g){ g.classList.toggle("hot", !!svcs[g.dataset.svc]); });
    }
    function apply(){
      var q = st.q, shown = 0, rows = st.mode === "table";
      em.classList.toggle("searching", !!q);
      list.hidden = rows; table.hidden = !rows;
      (rows ? $$("tbody tr", table) : $$(".em-story", list)).forEach(function(el){
        var on = (q ? el.dataset.q.indexOf(q) >= 0 : el.dataset.area === st.area) && (!st.aud || el.dataset.aud === st.aud);
        el.hidden = !on; if (on) shown++;
      });
      empty.hidden = shown > 0;
      pressChips();
    }
    function goTo(id){
      var el = document.getElementById("ep-" + id);
      if (!el) return;
      search.value = ""; st.q = "";
      if (st.mode === "table") setMode("stories");
      selectArea(el.dataset.area);
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("flash");
      setTimeout(function(){ el.classList.remove("flash"); }, 1600);
    }
    $$(".em-tab", em).forEach(function(t){ t.addEventListener("click", function(){ setView(t.dataset.view); }); });
    $$(".em-mode button", em).forEach(function(b){ b.addEventListener("click", function(){ setMode(b.dataset.mode); }); });
    chipsBox.addEventListener("click", function(e){
      var c = e.target.closest(".em-chip"); if (!c) return;
      st.aud = c.dataset.aud; highlight(); apply();
    });
    search.addEventListener("input", function(){ st.q = search.value.trim().toLowerCase(); apply(); });
    em.addEventListener("click", function(e){
      var g = e.target.closest("[data-goto]");
      if (g) { e.preventDefault(); goTo(g.dataset.goto); }
    });
    function act(g){
      if (g.classList.contains("em-areanode")) { search.value = ""; st.q = ""; selectArea(g.dataset.area); }
      else if (g.classList.contains("em-who")) { st.aud = st.aud === g.dataset.aud ? "" : g.dataset.aud; highlight(); apply(); }
      else if (g.classList.contains("em-svc")) { var first = g.dataset.areas.split(" ")[0]; if (first) selectArea(first); }
    }
    map.addEventListener("click", function(e){ var g = e.target.closest("g"); if (g) act(g); });
    map.addEventListener("keydown", function(e){ var g = e.target.closest("g"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); act(g); } });
    map.addEventListener("mouseover", function(e){
      var g = e.target.closest(".em-svc");
      if (!g) { tip.hidden = true; return; }
      tip.textContent = g.dataset.tip; tip.hidden = false;
      var r = g.getBoundingClientRect(), w = wrap.getBoundingClientRect();
      tip.style.left = Math.max(0, r.left - w.left - tip.offsetWidth - 10) + "px";
      tip.style.top = (r.top - w.top) + "px";
    });
    map.addEventListener("mouseleave", function(){ tip.hidden = true; });
    var hide = $(".em-hide", em), start = $(".em-start", em);
    if (start && read(START) === "hidden") start.hidden = true;
    if (hide) hide.addEventListener("click", function(){ start.hidden = true; store(START, "hidden"); });
    var mapBtn = $(".em-mapbtn", em);
    function mapOpen(on){ em.classList.toggle("map-open", on); mapBtn.textContent = on ? "Hide map" : "Show map"; store(MAP, on ? "open" : null); }
    mapBtn.addEventListener("click", function(){ mapOpen(!em.classList.contains("map-open")); });
    mapOpen(read(MAP) === "open");
    setView(read(VIEW) === "expert" ? "expert" : "simple");
    var want = location.hash.match(/^#ep-(.+)$/);
    if (want) goTo(decodeURIComponent(want[1])); else selectArea(st.area);
  })();

  // trace: walk the steps; the current one is highlighted in the list and the sequence diagram
  var tsteps = $$(".tstep:not(.guard)");
  if (tsteps.length) (function(){
    var cur = -1, timer = null, pos = $(".twalk-pos"), playBtn = $('[data-tw="play"]'), panel = $(".tcode");
    // The code panel beside the steps follows the current step.
    function loadCode(r){
      var path = r.dataset.path, line = +r.dataset.line || 0, end = +r.dataset.end || line;
      var head = $(".tcode-path", panel), body = $(".tcode-body", panel), full = $(".tcode-full", panel), note = $(".tcode-note", panel);
      head.textContent = path; var q = "path=" + encodeURIComponent(path) + (line ? "&line=" + line + "&end=" + end : "");
      full.href = "/source?" + q; full.hidden = false;
      var g = $(".tguess", r); note.hidden = !g; if (g) note.textContent = "Matched by method name only, so this step is a best guess. Check it if more than one class has a method with this name.";
      body.innerHTML = '<div class="loading">Loading…</div>';
      fetch("/api/source?" + q).then(function(x){ return x.json(); }).then(function(d){
        if (d.error || d.kind !== "file") { body.innerHTML = '<div class="loading">' + esc(d.error || "Not a file") + '</div>'; return; }
        var rows = [];
        for (var i = 0; i < d.lines.length; i++) { var n = d.start + i, hit = line && n >= line && n <= Math.max(end, line); rows.push('<tr class="' + (hit ? "hit" : "") + '"><td class="n">' + n + '</td><td>' + (esc(d.lines[i]) || " ") + '</td></tr>'); }
        body.innerHTML = '<table class="code">' + rows.join("") + '</table>';
        var hit = $("tr.hit", body); if (hit) body.scrollTop = Math.max(0, hit.offsetTop - 60);
      }).catch(function(){ body.innerHTML = '<div class="loading">Couldn\\'t load this file.</div>'; });
    }
    function show(i, open){
      cur = Math.max(0, Math.min(tsteps.length - 1, i));
      tsteps.forEach(function(r, n){ r.classList.toggle("cur", n === cur); if (n <= cur) r.classList.add("seen"); });
      $$(".seq .arrow").forEach(function(a){ a.classList.toggle("cur", +a.dataset.i === cur); if (+a.dataset.i <= cur) a.classList.add("seen"); });
      var r = tsteps[cur], bar = $(".twalk"), rect = r.getBoundingClientRect(), top = bar ? bar.getBoundingClientRect().bottom : 70;
      if (rect.top < top + 6 || rect.bottom > innerHeight - 20) window.scrollBy({ top: rect.top - top - 80, behavior: "smooth" });
      if (pos) pos.textContent = "Step " + (cur + 1) + " of " + tsteps.length;
      if (panel && r.dataset.path) loadCode(r);
      else if (open && r.dataset.path) openSource(r.dataset.path, r.dataset.line || null, null, document.title);
      if (playBtn) playBtn.textContent = timer ? "❚❚ Pause" : cur === tsteps.length - 1 ? "↻ Replay" : "▶ Play";
    }
    function stop(){ clearInterval(timer); timer = null; }
    // Guess mode: before each step is revealed, pick what runs next from three names (PRIMM's "predict").
    var guessOn = $(".tw-guess-on"), guessBox = $(".tguess-box"), list = $(".tsteps"), score = { right: 0, total: 0 };
    function stepName(n){ var c = $(".tl code", tsteps[n]); return c ? c.textContent : ""; }
    function guessNext(){
      var target = cur + 1, want = stepName(target);
      var pool = tsteps.map(function(_, n){ return stepName(n); }).filter(function(x, n, a){ return x && x !== want && a.indexOf(x) === n; });
      for (var i = pool.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
      var opts = pool.slice(0, 2).concat([want]).sort(function(){ return Math.random() - 0.5; });
      var from = cur >= 0 ? stepName(cur) : "the handler";
      guessBox.hidden = false;
      guessBox.innerHTML = "<b>What runs next" + (cur >= 0 ? " after <code>" + esc(from) + "</code>" : "") + "?</b><div class='tg-opts'>" + opts.map(function(o){ return "<button type='button' class='pr-opt tg-opt'><code>" + esc(o) + "</code></button>"; }).join("") + "</div>";
      $$(".tg-opt", guessBox).forEach(function(b){ b.addEventListener("click", function(){
        var right = b.textContent === want; score.total++; if (right) score.right++;
        $$(".tg-opt", guessBox).forEach(function(o){ o.disabled = true; o.classList.toggle("right", o.textContent === want); });
        if (!right) b.classList.add("wrong");
        guessBox.insertAdjacentHTML("beforeend", "<p class='pr-verdict " + (right ? "ok" : "no") + "'>" + (right ? "✓ Right." : "It's <code>" + esc(want) + "</code>.") + " Score: " + score.right + " / " + score.total + "</p>");
        setTimeout(function(){ guessBox.hidden = true; show(target, true); }, right ? 700 : 1600);
      }); });
    }
    if (guessOn) guessOn.addEventListener("change", function(){ list.classList.toggle("guessing", guessOn.checked); $$("svg.seq").forEach(function(sv){ sv.classList.toggle("guessing", guessOn.checked); }); guessBox.hidden = true; if (guessOn.checked) { stop(); cur = -1; tsteps.forEach(function(r){ r.classList.remove("cur", "seen"); }); $$(".seq .arrow").forEach(function(a){ a.classList.remove("cur", "seen"); }); } });
    $$("[data-tw]").forEach(function(b){ b.addEventListener("click", function(){
      var w = b.dataset.tw;
      if (guessOn && guessOn.checked && w === "next" && cur < tsteps.length - 1) { stop(); guessNext(); return; }
      if (w === "play") {
        if (timer) stop();
        else { if (cur >= tsteps.length - 1) cur = -1; timer = setInterval(function(){ if (cur >= tsteps.length - 1) { stop(); show(cur); } else show(cur + 1); }, 1600); show(cur + 1); return; }
        show(cur); return;
      }
      stop(); show(w === "next" ? cur + 1 : cur - 1, true);
    }); });
    tsteps.forEach(function(r, n){ r.addEventListener("click", function(ev){ if (ev.target.closest("a")) return; stop(); show(n, true); }); });
    $$(".seq .arrow").forEach(function(a){ a.style.cursor = "pointer"; a.addEventListener("click", function(){ stop(); show(+a.dataset.i, true); }); });
    if (pos) pos.textContent = tsteps.length + " steps";
    if (panel) { tsteps[0].classList.add("cur"); loadCode(tsteps[0]); }
  })();

  // framework API chips → the latest official docs page, with renames and installed-vs-latest versions
  var apiChips = $$(".tapi[data-api]");
  if (apiChips.length) {
    var names = apiChips.map(function(c){ return c.dataset.api; }).filter(function(n, i, a){ return a.indexOf(n) === i; });
    fetch("/api/docs?" + names.map(function(n){ return "api=" + encodeURIComponent(n); }).join("&")).then(function(r){ return r.json(); }).then(function(d){
      apiChips.forEach(function(c){
        var p = d.pages[c.dataset.api]; if (!p) return;
        var a = document.createElement("a");
        a.className = c.className + " linked"; a.href = p.url; a.target = "_blank"; a.rel = "noopener";
        a.title = "Official docs" + (p.version ? " (v" + p.version + ")" : "") + ": " + p.title;
        a.innerHTML = c.innerHTML + (p.renamedFrom ? ' <em class="renamed">now ' + esc(p.title) + "</em>" : "") + ' <span class="ext-ic">↗</span>';
        c.replaceWith(a);
      });
      var note = $(".stack-note");
      if (note && d.stack && d.stack.length) {
        note.hidden = false;
        note.innerHTML = d.stack.map(function(s){ return "<b>" + esc(s.name) + "</b> " + (s.installed ? esc(s.installed) + " here" : "") + (s.latest ? " · official docs describe " + esc(s.latest) : ""); }).join(" &nbsp;·&nbsp; ") +
          '. Chips marked <em class="renamed">now …</em> use an older name than the latest docs.';
      }
    }).catch(function(){});
  }

  // learn: progress (kept in this browser only), exercise checking, installed-vs-latest versions
  var DONE_KEY = "houserules-lessons-done:" + (document.querySelector('meta[name="houserules-repo"]') || {}).content;
  function doneSet(){ try { return JSON.parse(localStorage.getItem(DONE_KEY) || "[]"); } catch (e) { return []; } }
  function markDone(id){ var d = doneSet(); if (d.indexOf(id) < 0) d.push(id); try { localStorage.setItem(DONE_KEY, JSON.stringify(d)); } catch (e) {} }
  var lessonIds = null; try { lessonIds = JSON.parse(($("#lesson-ids") || {}).textContent || "null"); } catch (e) {}
  if (lessonIds) {
    var done = doneSet(), n = 0;
    $$(".lesson-card").forEach(function(c){ var on = done.indexOf(c.dataset.lesson) >= 0; c.classList.toggle("done", on); if (on) n++; });
    $("[data-overall]").textContent = n + " of " + lessonIds.length + " done";
    $("[data-overall-bar]").style.width = Math.round(n / lessonIds.length * 100) + "%";
    $$("[data-progress]").forEach(function(p){ var ids = lessonIds.filter(function(l){ return l.track === p.dataset.progress; }); var k = ids.filter(function(l){ return done.indexOf(l.id) >= 0; }).length; p.textContent = k + " / " + ids.length; });
  }
  var stackEl = $("[data-stack]");
  if (stackEl) fetch("/api/docs").then(function(r){ return r.json(); }).then(function(d){
    if (!d.stack || !d.stack.length) return;
    stackEl.hidden = false;
    stackEl.innerHTML = "Sources: " + d.stack.map(function(s){ return "<b>" + esc(s.name) + "</b> docs " + (s.latest ? "v" + esc(s.latest) : "(latest)") + (s.installed ? " (this repo: " + esc(s.installed) + ")" : ""); }).join(" · ");
  }).catch(function(){});
  // predict: answer before the explanation is revealed
  var lessonEl = $(".lesson"), lessonKey = lessonEl ? lessonEl.dataset.lesson : "";
  var pendingChanges = lessonEl ? +lessonEl.dataset.changes : 0;
  $$(".predict").forEach(function(p){
    var answer = +p.dataset.answer;
    $$(".pr-opt", p).forEach(function(b){ b.addEventListener("click", function(){
      if (p.classList.contains("answered")) return;
      var n = +b.dataset.n, right = n === answer;
      p.classList.add("answered");
      $$(".pr-opt", p).forEach(function(o){ var k = +o.dataset.n; o.classList.toggle("right", k === answer); o.classList.toggle("wrong", k === n && !right); o.disabled = true; });
      var v = $(".pr-verdict", p); v.className = "pr-verdict " + (right ? "ok" : "no"); v.textContent = right ? "✓ Right. Here's why:" : "Not quite, and that's the useful part. Here's what really happens:";
      $(".pr-reveal", p).hidden = false;
      if (!pendingChanges) markDone(lessonKey);
    }); });
  });

  // change: re-check the learner's files every couple of seconds, like a test watcher
  $$(".change").forEach(function(c){
    var btn = $(".ch-watch", c), status = $(".ch-status", c), other = $(".ch-other", c), timer = null, done = false;
    function check(){
      fetch("/api/exercise?lesson=" + encodeURIComponent(lessonKey) + "&i=" + c.dataset.ex).then(function(r){ return r.json(); }).then(function(d){
        if (!d.results) return;
        $$(".ch-checks li", c).forEach(function(li, n){ var ok = d.results[n] && d.results[n].ok; li.classList.toggle("ok", !!ok); $(".ch-mark", li).textContent = ok ? "✓" : "○"; });
        var k = d.results.filter(function(r){ return r.ok; }).length;
        other.hidden = !d.otherFiles.length;
        other.textContent = d.otherFiles.length ? "You've also changed " + d.otherFiles.join(", ") + ". Fine if intended; the task only needs the files above." : "";
        if (d.passed) {
          clearInterval(timer); timer = null; done = true;
          c.classList.add("passed"); status.textContent = "✓ All checks pass. Nicely done."; status.className = "ch-status ok";
          btn.textContent = "Check again"; pendingChanges--; if (pendingChanges <= 0) markDone(lessonKey);
        } else status.textContent = "Watching your files… " + k + " of " + d.results.length + " checks pass";
      }).catch(function(){ status.textContent = "Couldn't reach the preview server."; });
    }
    btn.addEventListener("click", function(){
      if (timer) { clearInterval(timer); timer = null; btn.textContent = "Start checking as I save"; status.textContent = "Paused."; return; }
      check(); if (!done) { timer = setInterval(check, 2000); btn.textContent = "Pause"; }
    });
  });

  // data model: filter, show all, jump to related entity
  var filter = $(".model-filter");
  if (filter) filter.addEventListener("input", function(){
    var q = filter.value.trim().toLowerCase(), box = $(".entities");
    if (q) box.classList.remove("limited");
    $$(".entity").forEach(function(e){ e.style.display = !q || e.dataset.name.indexOf(q) >= 0 ? "" : "none"; });
  });
  var showAll = $(".show-all-entities");
  if (showAll) showAll.addEventListener("click", function(){ $(".entities").classList.remove("limited"); showAll.remove(); });
  $$(".rel").forEach(function(r){
    r.addEventListener("click", function(e){
      var t = document.getElementById(r.dataset.target); if (!t) return;
      e.preventDefault(); $(".entities").classList.remove("limited"); t.style.display = "";
      t.scrollIntoView({ behavior: "smooth", block: "center" });
      t.classList.add("flash"); setTimeout(function(){ t.classList.remove("flash"); }, 1400);
    });
  });

  // mobile sidebar
  var sidebar = $(".sidebar"), overlay = $("#overlay");
  var menu = $("#menu");
  if (menu) menu.addEventListener("click", function(){ sidebar.classList.add("open"); overlay.classList.add("open"); });

  // navigator: disclosure state remembered per browser, and a client-side filter
  var NAV_KEY = "hr-nav";
  function navSaved(){ try { return JSON.parse(localStorage.getItem(NAV_KEY) || "{}") || {}; } catch (e) { return {}; } }
  var navGroups = $$(".nv[data-nav]").filter(function(g){ return $(".nv-kids", g); });
  function setOpen(g, on){ g.classList.toggle("open", on); var b = $("button.nv-tog", g); if (b) b.setAttribute("aria-expanded", on ? "true" : "false"); }
  var saved = navSaved();
  navGroups.forEach(function(g){
    var cur = !!$(".nv-row.cur", g);
    if (!cur && Object.prototype.hasOwnProperty.call(saved, g.dataset.nav)) setOpen(g, !!saved[g.dataset.nav]);
    var b = $("button.nv-tog", g);
    if (b) b.addEventListener("click", function(){
      var on = !g.classList.contains("open"); setOpen(g, on);
      var st = navSaved(); st[g.dataset.nav] = on;
      try { localStorage.setItem(NAV_KEY, JSON.stringify(st)); } catch (e) {}
    });
  });
  var navFilter = $("#navfilter");
  if (navFilter) navFilter.addEventListener("input", function(){
    var q = navFilter.value.trim().toLowerCase(), any = false;
    function hit(el){ return !q || ($(".nv-label", el) || el).textContent.toLowerCase().indexOf(q) >= 0; }
    $$(".nv[data-nav]").forEach(function(g){
      var self = hit($(".nv-row", g)), kidHit = false;
      $$(".nv-kid", g).forEach(function(k){ var h = !q || self || hit(k); if (q && !self && h) kidHit = true; k.hidden = !h; });
      g.hidden = !(self || kidHit);
      if (q && kidHit) g.classList.add("open");
      if (!g.hidden) any = true;
    });
    if (!q) { var st = navSaved(); navGroups.forEach(function(g){ var cur = !!$(".nv-row.cur", g); setOpen(g, cur || !!st[g.dataset.nav]); }); }
    $$(".nv-sec").forEach(function(sec){ sec.hidden = !$$(".nv[data-nav]", sec).some(function(g){ return !g.hidden; }); });
    var none = $(".nv-none"); if (none) none.hidden = any;
  });

  // evidence drawer
  var drawer = $("#drawer");
  function closeAll(){ drawer && drawer.classList.remove("open"); sidebar && sidebar.classList.remove("open"); overlay && overlay.classList.remove("open"); closePalette(); }
  if (overlay) overlay.addEventListener("click", closeAll);
  var closeBtn = $("#drawer-close"); if (closeBtn) closeBtn.addEventListener("click", closeAll);
  var copyBtn = $("#drawer-copy");
  if (copyBtn) copyBtn.addEventListener("click", function(){
    var p = drawer.dataset.path || "";
    if (navigator.clipboard) navigator.clipboard.writeText(p).then(function(){ copyBtn.textContent = "Copied"; setTimeout(function(){ copyBtn.textContent = "Copy path"; }, 1200); });
  });
  function openSource(path, line, end, citedBy){
    if (!drawer) return false;
    drawer.dataset.path = path;
    $("#drawer-path").textContent = path;
    $("#drawer-sub").textContent = (line ? ("Line " + line + (end && end != line ? "–" + end : "")) : "Whole file") + (citedBy ? " · cited by “" + citedBy + "”" : "");
    var full = "/source?path=" + encodeURIComponent(path) + (line ? "&line=" + line : "") + (end ? "&end=" + end : "");
    $("#drawer-full").href = full;
    var body = $("#drawer-body");
    body.innerHTML = '<div class="loading">Loading…</div>';
    drawer.classList.add("open"); overlay.classList.add("open");
    fetch("/api/source?" + full.split("?")[1]).then(function(r){ return r.json(); }).then(function(d){
      if (d.error) { body.innerHTML = '<div class="loading">' + esc(d.error) + '</div>'; return; }
      var from = d.line || 0, to = d.end || from, rows = [];
      if (d.kind === "dir") {
        body.innerHTML = '<div class="loading">' + esc(path) + '/ is a directory with ' + d.files.length + ' source files.</div>';
        return;
      }
      for (var i = 0; i < d.lines.length; i++) {
        var n = d.start + i, hit = from && n >= from && n <= to;
        rows.push('<tr id="d' + n + '" class="' + (hit ? "hit" : "") + '"><td class="n">' + n + '</td><td>' + (esc(d.lines[i]) || " ") + '</td></tr>');
      }
      var note = d.start > 1 || d.start + d.lines.length - 1 < d.total ? '<div class="loading">Showing lines ' + d.start + '–' + (d.start + d.lines.length - 1) + ' of ' + d.total + '. <a href="' + full + '">Open the full file</a></div>' : "";
      body.innerHTML = note + '<table class="code">' + rows.join("") + '</table>';
      var target = $("#d" + Math.max(d.start, from - 6), body);
      if (target) target.scrollIntoView({ block: "start" });
    }).catch(function(){ body.innerHTML = '<div class="loading">Couldn\\'t load this file.</div>'; });
    return true;
  }
  $$(".src[data-path]").forEach(function(a){
    a.addEventListener("click", function(e){
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (openSource(a.dataset.path, a.dataset.line, a.dataset.end, a.dataset.item)) e.preventDefault();
    });
  });

  // filters on doc pages
  var chips = $$(".chip[data-filter]");
  chips.forEach(function(c){
    c.addEventListener("click", function(){
      chips.forEach(function(x){ x.setAttribute("aria-pressed", x === c ? "true" : "false"); });
      var f = c.dataset.filter;
      $$(".item").forEach(function(it){
        var show = f === "all" || it.dataset.conf === f || (f === "attention" && it.dataset.state !== "ok");
        it.hidden = !show;
      });
      $$("section.doc-section").forEach(function(sec){ sec.hidden = !$$(".item", sec).some(function(it){ return !it.hidden; }); });
    });
  });

  // on-this-page highlighting
  var tocLinks = $$(".toc a");
  if (tocLinks.length && "IntersectionObserver" in window) {
    var byId = {}; tocLinks.forEach(function(a){ byId[a.getAttribute("href").slice(1)] = a; });
    var visible = {};
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){ visible[en.target.id] = en.isIntersecting; });
      var first = tocLinks.map(function(a){ return a.getAttribute("href").slice(1); }).find(function(id){ return visible[id]; });
      if (first) { tocLinks.forEach(function(a){ a.classList.remove("active"); }); byId[first].classList.add("active"); }
    }, { rootMargin: "-72px 0px -65% 0px" });
    Object.keys(byId).forEach(function(id){ var el = document.getElementById(id); if (el) io.observe(el); });
  }

  // search palette
  var palette = $("#palette"), input = $("#palette-input"), results = $("#results");
  var index = []; try { index = JSON.parse(($("#search-index") || {}).textContent || "[]"); } catch (e) {}
  var sel = 0, shown = [];
  function render(){
    var q = input.value.trim().toLowerCase();
    // Grouped: the team\'s saved answers first, then Docs, Ways in and Lessons; title matches first within each group.
    var groups = ["Answers", "Docs", "Ways in", "Lessons"], html = [];
    shown = [];
    groups.forEach(function(g){
      var hits = index.filter(function(x){ return x.g === g && (!q || (x.t + " " + x.b + " " + x.s).toLowerCase().indexOf(q) >= 0); });
      hits.sort(function(a, b){ return (b.t.toLowerCase().indexOf(q) >= 0) - (a.t.toLowerCase().indexOf(q) >= 0); });
      hits = hits.slice(0, q ? 6 : 4);
      if (!hits.length) return;
      html.push('<div class="rgroup">' + g + '</div>');
      hits.forEach(function(x){ html.push('<a class="result' + (shown.length === sel ? " sel" : "") + '" href="' + x.u + '"><div class="rt">' + esc(x.t) + '</div><div class="rs">' + esc(x.s) + '</div></a>'); shown.push(x); });
    });
    sel = Math.min(sel, Math.max(shown.length - 1, 0));
    results.innerHTML = shown.length ? html.join("") : '<div class="noresult">Nothing matches.</div>';
  }
  function openPalette(){ if (!palette) return; palette.classList.add("open"); input.value = ""; sel = 0; render(); input.focus(); }
  function closePalette(){ if (palette) palette.classList.remove("open"); }
  var sb = $("#searchbtn"); if (sb) sb.addEventListener("click", openPalette);
  $$(".open-search").forEach(function(b){ b.addEventListener("click", openPalette); });
  if (palette) palette.addEventListener("click", function(e){ if (e.target === palette) closePalette(); });
  if (input) {
    input.addEventListener("input", function(){ sel = 0; render(); });
    input.addEventListener("keydown", function(e){
      if (e.key === "ArrowDown") { sel = Math.min(sel + 1, shown.length - 1); render(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
      else if (e.key === "Enter" && shown[sel]) { location.href = shown[sel].u; }
    });
  }
  document.addEventListener("keydown", function(e){
    var typing = /INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || "");
    if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); openPalette(); }
    else if (e.key === "Escape") closeAll();
  });
})();
`;
