import type { CSSProperties } from 'react';
import {
  Archive,
  ArrowRight,
  BookOpen,
  CircleAlert,
  Compass,
  LayoutDashboard,
  Lightbulb,
  Network,
  ShieldCheck,
  Ticket,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, SectionHeader } from '../components/ui';
import { getWikiManualPage, WIKI_MANUAL_BY_SLUG, WIKI_MANUAL_GROUPS } from '../lib/wikiManual';
import { wikiUrl } from '../lib/wiki';

const s: Record<string, CSSProperties> = {
  hero: {
    background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 18%, var(--bg-card)), color-mix(in srgb, var(--accent) 4%, var(--bg-card-soft)))',
    border: '1px solid color-mix(in srgb, var(--accent) 22%, var(--border-soft))',
    borderRadius: 'var(--radius-md)',
    padding: 24,
    marginBottom: 18,
    display: 'grid',
    gridTemplateColumns: '1.4fr .9fr',
    gap: 18,
  },
  heroTitle: { fontSize: 28, fontWeight: 800, lineHeight: 1.1, margin: '0 0 10px', color: 'var(--text)' },
  heroCopy: { fontSize: 14, lineHeight: 1.6, color: 'var(--text-dim)', margin: 0 },
  heroPanel: {
    borderRadius: 'var(--radius-md)',
    padding: 18,
    background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-card) 88%, transparent), color-mix(in srgb, var(--bg-card-soft) 92%, transparent))',
    border: '1px solid var(--border-soft)',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  heroPanelLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-dim)' },
  heroPanelValue: { fontSize: 16, fontWeight: 700, color: 'var(--text)' },
  layout: { display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: 18, alignItems: 'start' },
  sideWrap: { display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 16 },
  sideTitle: { fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 8 },
  sideText: { fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-dim)', margin: 0 },
  sideList: { display: 'flex', flexDirection: 'column', gap: 8 },
  sideLink: {
    textDecoration: 'none',
    border: '1px solid var(--border-soft)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
    background: 'var(--bg-card-soft)',
    color: 'var(--text)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  groupDescription: { fontSize: 11.5, color: 'var(--text-dim)', margin: '0 0 8px' },
  articleWrap: { display: 'flex', flexDirection: 'column', gap: 16 },
  summaryCard: {
    background: 'linear-gradient(180deg, var(--bg-card), color-mix(in srgb, var(--bg-card-soft) 78%, transparent))',
    border: '1px solid var(--border-soft)',
  },
  articleLead: { fontSize: 14, lineHeight: 1.65, color: 'var(--text-dim)', margin: 0 },
  keyFacts: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 14 },
  keyFact: {
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-soft)',
    background: 'var(--bg-card-soft)',
    padding: 12,
  },
  keyLabel: { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-dim)', marginBottom: 6 },
  keyValue: { fontSize: 13.5, color: 'var(--text)', lineHeight: 1.5 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  checklist: { display: 'grid', gap: 10 },
  checklistItem: {
    display: 'grid',
    gridTemplateColumns: '22px 1fr',
    gap: 10,
    alignItems: 'start',
    fontSize: 13,
    lineHeight: 1.55,
    color: 'var(--text)',
  },
  sectionCard: { padding: 18, display: 'flex', flexDirection: 'column', gap: 14 },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionTitle: { margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' },
  sectionBody: { fontSize: 13.5, lineHeight: 1.7, color: 'var(--text-dim)', margin: 0 },
  steps: { display: 'grid', gap: 10 },
  step: {
    display: 'grid',
    gridTemplateColumns: '36px 1fr',
    gap: 12,
    alignItems: 'start',
    padding: 14,
    borderRadius: 'var(--radius-sm)',
    background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 6%, var(--bg-card-soft)), var(--bg-card-soft))',
    border: '1px solid color-mix(in srgb, var(--accent) 14%, var(--border-soft))',
  },
  stepNumber: {
    width: 36,
    height: 36,
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--accent)',
    color: 'var(--bg-base)',
    fontWeight: 800,
    fontSize: 13,
  },
  stepText: { fontSize: 13.5, color: 'var(--text)', lineHeight: 1.6, paddingTop: 3 },
  bullets: { display: 'grid', gap: 8 },
  bullet: {
    display: 'grid',
    gridTemplateColumns: '18px 1fr',
    gap: 10,
    alignItems: 'start',
    fontSize: 13,
    color: 'var(--text)',
    lineHeight: 1.55,
  },
  bulletDot: {
    width: 8,
    height: 8,
    marginTop: 7,
    borderRadius: 999,
    background: 'var(--accent)',
    boxShadow: '0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent)',
  },
  relatedWrap: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 },
  relatedCard: {
    textDecoration: 'none',
    color: 'inherit',
    border: '1px solid var(--border-soft)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-card-soft)',
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  relatedTitle: { fontSize: 13.5, fontWeight: 700, color: 'var(--text)' },
  relatedBody: { fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-dim)' },
  sectionMeta: { fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 },
  visualGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 },
  visualCard: {
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-soft)',
    background: 'linear-gradient(180deg, var(--bg-card-soft), color-mix(in srgb, var(--accent) 4%, var(--bg-card)))',
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  visualHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  visualTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  visualSub: { fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-dim)' },
  miniFrame: {
    borderRadius: 12,
    border: '1px solid color-mix(in srgb, var(--accent) 10%, var(--border-soft))',
    background: 'linear-gradient(180deg, rgba(255,255,255,0.05), transparent)',
    minHeight: 118,
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  miniBar: { height: 10, borderRadius: 999, background: 'color-mix(in srgb, var(--accent) 20%, transparent)', width: '55%' },
  miniRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 },
  miniBox: { height: 28, borderRadius: 8, border: '1px solid var(--border-soft)', background: 'rgba(255,255,255,0.04)' },
  miniTicket: { height: 16, borderRadius: 999, background: 'rgba(255,255,255,0.06)' },
  bulb: { display: 'inline-flex', alignItems: 'center', color: 'var(--warning)' },
  demoShell: {
    borderRadius: 14,
    border: '1px solid color-mix(in srgb, var(--accent) 10%, var(--border-soft))',
    background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  demoTabs: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  demoTabOn: {
    borderRadius: 10,
    padding: '6px 10px',
    fontSize: 11.5,
    fontWeight: 700,
    color: 'var(--bg-base)',
    background: 'var(--accent)',
  },
  demoTabOff: {
    borderRadius: 10,
    padding: '6px 10px',
    fontSize: 11.5,
    fontWeight: 600,
    color: 'var(--text)',
    border: '1px solid var(--border-soft)',
    background: 'rgba(255,255,255,0.03)',
  },
  demoFields: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  demoFieldWide: { gridColumn: '1 / -1' },
  demoField: { display: 'flex', flexDirection: 'column', gap: 5 },
  demoLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 10.5,
    fontWeight: 700,
    color: 'var(--text-dim)',
    textTransform: 'uppercase',
    letterSpacing: 0.45,
  },
  demoInput: {
    height: 34,
    borderRadius: 10,
    border: '1px solid var(--border-soft)',
    background: 'rgba(255,255,255,0.05)',
    color: 'var(--text)',
    display: 'flex',
    alignItems: 'center',
    padding: '0 10px',
    fontFamily: 'var(--font-mono)',
    fontSize: 11.5,
  },
  demoInputMuted: { color: 'var(--text-dim)' },
  demoButton: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    padding: '8px 12px',
    background: 'color-mix(in srgb, var(--accent) 82%, white 5%)',
    color: 'var(--bg-base)',
    fontSize: 11.5,
    fontWeight: 800,
  },
  demoHintList: { display: 'flex', flexDirection: 'column', gap: 8 },
  demoHintItem: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 8,
    alignItems: 'center',
    borderRadius: 10,
    border: '1px solid var(--border-soft)',
    background: 'rgba(255,255,255,0.03)',
    padding: '8px 10px',
  },
  demoHintCopy: { display: 'flex', flexDirection: 'column', gap: 3 },
  demoHintTitle: { fontSize: 11.5, fontWeight: 700, color: 'var(--text)' },
  demoHintBody: { fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.45 },
};

function slugFromPath(pathname: string): string {
  return pathname.replace(/^\/wiki\/?/, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function pageTitle(slug: string): string {
  if (!slug) return 'Internes Wiki';
  return getWikiManualPage(slug)?.title ?? 'Wiki-Eintrag nicht gefunden';
}

function pageSummary(slug: string): string {
  if (!slug) return 'Bedienungsanleitung für Nexora: klar, intern und ohne Dokuwand.';
  return getWikiManualPage(slug)?.summary ?? 'Zu diesem Thema gibt es noch keinen ausgearbeiteten internen Eintrag.';
}

function QuickStartVisual() {
  const steps = [
    {
      title: '1. Dashboard öffnen',
      body: 'Hier siehst du zuerst, ob etwas rot, kritisch oder neu hoch priorisiert ist.',
      icon: <LayoutDashboard size={15} color="var(--accent)" />,
      frame: (
        <>
          <div style={s.miniBar} />
          <div style={s.miniRow}>
            <div style={{ ...s.miniBox, borderColor: 'var(--danger)' }} />
            <div style={s.miniBox} />
          </div>
          <div style={{ ...s.miniTicket, width: '70%', background: 'color-mix(in srgb, var(--danger) 22%, transparent)' }} />
          <div style={{ ...s.miniTicket, width: '92%' }} />
        </>
      ),
    },
    {
      title: '2. Tickets öffnen',
      body: 'Ziehe dir die offenen oder priorisierten Fälle zuerst nach vorne.',
      icon: <Ticket size={15} color="var(--accent)" />,
      frame: (
        <>
          <div style={s.miniBar} />
          <div style={s.miniRow}>
            <div style={{ ...s.miniBox, height: 22 }} />
            <div style={{ ...s.miniBox, height: 22 }} />
          </div>
          <div style={{ ...s.miniTicket, width: '88%' }} />
          <div style={{ ...s.miniTicket, width: '77%' }} />
          <div style={{ ...s.miniTicket, width: '91%' }} />
        </>
      ),
    },
    {
      title: '3. Ticket lesen',
      body: 'Erst Zusammenfassung, Quelle und Status lesen, dann über Maßnahmen nachdenken.',
      icon: <Lightbulb size={15} color="var(--warning)" />,
      frame: (
        <>
          <div style={{ ...s.miniBar, width: '72%' }} />
          <div style={{ ...s.miniBox, height: 34 }} />
          <div style={{ ...s.miniTicket, width: '96%' }} />
          <div style={{ ...s.miniTicket, width: '84%' }} />
        </>
      ),
    },
    {
      title: '4. Evidence prüfen',
      body: 'Danach erst in die Belege wechseln und verifizieren, ob der Fall wirklich Substanz hat.',
      icon: <Archive size={15} color="var(--accent)" />,
      frame: (
        <>
          <div style={s.miniBar} />
          <div style={s.miniRow}>
            <div style={{ ...s.miniBox, height: 46 }} />
            <div style={{ ...s.miniBox, height: 46 }} />
          </div>
          <div style={{ ...s.miniTicket, width: '80%' }} />
        </>
      ),
    },
  ];

  return (
    <Card style={s.sectionCard}>
      <div style={s.sectionHeader}>
        <h3 style={s.sectionTitle}>Schnellstart mit Bildern</h3>
        <Badge tone="accent">4 Klicks</Badge>
      </div>
      <div style={s.visualGrid}>
        {steps.map((step) => (
          <div key={step.title} style={s.visualCard}>
            <div style={s.visualHead}>
              <div style={s.visualTitle}>{step.title}</div>
              {step.icon}
            </div>
            <div style={s.miniFrame}>{step.frame}</div>
            <div style={s.visualSub}>{step.body}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function DeploymentVisual() {
  return (
    <Card style={s.sectionCard}>
      <div style={s.sectionHeader}>
        <h3 style={s.sectionTitle}>Beispiel: Deployment-Felder verstehen</h3>
        <Badge tone="warning">mit Glühbirnen</Badge>
      </div>
      <div style={s.visualGrid}>
        <div style={s.visualCard}>
          <div style={s.visualHead}>
            <div style={s.visualTitle}>Connector-Bereich</div>
            <Network size={15} color="var(--accent)" />
          </div>
          <div style={s.demoShell}>
            <div style={s.demoTabs}>
              <span style={s.demoTabOn}>Proxmox</span>
              <span style={s.demoTabOff}>SSH (Linux-Client)</span>
            </div>
            <div style={s.demoFields}>
              <div style={s.demoField}>
                <div style={s.demoLabel}>Name <span style={s.bulb}><Lightbulb size={11} /></span></div>
                <div style={s.demoInput}>Lab-Proxmox-Nord</div>
              </div>
              <div style={s.demoField}>
                <div style={s.demoLabel}>Host (IP/DNS) <span style={s.bulb}><Lightbulb size={11} /></span></div>
                <div style={s.demoInput}>10.0.10.20</div>
              </div>
              <div style={s.demoField}>
                <div style={s.demoLabel}>Ziel-Node <span style={s.bulb}><Lightbulb size={11} /></span></div>
                <div style={s.demoInput}>pve</div>
              </div>
              <div style={s.demoField}>
                <div style={s.demoLabel}>API-Token <span style={s.bulb}><Lightbulb size={11} /></span></div>
                <div style={{ ...s.demoInput, ...s.demoInputMuted }}>pve!nexora=********</div>
              </div>
              <div style={{ ...s.demoField, ...s.demoFieldWide }}>
                <div style={s.demoLabel}>Passwort-Bestätigung <span style={s.bulb}><Lightbulb size={11} /></span></div>
                <div style={{ ...s.demoInput, ...s.demoInputMuted }}>Aktuelles Passwort</div>
              </div>
            </div>
            <div style={s.demoButton}>+ Connector anlegen</div>
          </div>
          <div style={s.visualSub}>Das soll wie das echte Formular aussehen: gleiche Felder, gleiche Reihenfolge, aber mit harmlosen Dummy-Daten zum Lernen.</div>
        </div>
        <div style={s.visualCard}>
          <div style={s.visualHead}>
            <div style={s.visualTitle}>Was die Glühbirnen erklären</div>
            <span style={s.bulb}><Lightbulb size={15} /></span>
          </div>
          <div style={s.demoShell}>
            <div style={s.demoHintList}>
              <div style={s.demoHintItem}>
                <div style={s.demoHintCopy}>
                  <div style={s.demoHintTitle}>Host (IP/DNS)</div>
                  <div style={s.demoHintBody}>Die echte Management-Adresse des Proxmox-Hosts oder Linux-Ziels, die Nexora wirklich erreichen kann.</div>
                </div>
                <span style={s.bulb}><Lightbulb size={14} /></span>
              </div>
              <div style={s.demoHintItem}>
                <div style={s.demoHintCopy}>
                  <div style={s.demoHintTitle}>Ziel-Node</div>
                  <div style={s.demoHintBody}>Der exakte Node-Name aus Proxmox, also zum Beispiel `pve` oder `proxmox-02`.</div>
                </div>
                <span style={s.bulb}><Lightbulb size={14} /></span>
              </div>
              <div style={s.demoHintItem}>
                <div style={s.demoHintCopy}>
                  <div style={s.demoHintTitle}>Passwort-Bestätigung</div>
                  <div style={s.demoHintBody}>Sicherheitsstufe vor dem Speichern. Ohne dieses Feld wird kein Connector mit Secret-Daten angelegt.</div>
                </div>
                <span style={s.bulb}><Lightbulb size={14} /></span>
              </div>
            </div>
          </div>
          <div style={s.visualSub}>Die rechte Karte erklärt nicht nur, dass es Tooltips gibt, sondern wofür diese drei häufigen Felder konkret stehen.</div>
        </div>
      </div>
    </Card>
  );
}

export function WikiPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const slug = slugFromPath(location.pathname);
  const page = getWikiManualPage(slug);

  return (
    <div>
      <SectionHeader
        title={pageTitle(slug)}
        subtitle={pageSummary(slug)}
        onBack={() => navigate(-1)}
        actions={<Button variant="ghost" size="sm" icon={<Compass size={14} />} onClick={() => navigate('/wiki')}>Wiki Startseite</Button>}
      />

      <div style={s.hero}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Badge tone="accent" dot>Internes Manual</Badge>
            <Badge>Kein iFrame</Badge>
          </div>
          <h1 style={s.heroTitle}>Bedienung für Menschen, nicht für Maschinen.</h1>
          <p style={s.heroCopy}>
            Dieses Wiki ist absichtlich keine Vollständigkeits-Doku. Es erklärt in einfachen Schritten,
            was du in Nexora auf einer Seite tun sollst, wann du vorsichtig sein musst und wo du als Nächstes hingehst.
          </p>
        </div>
        <div style={s.heroPanel}>
          <div style={s.heroPanelLabel}>Worum es hier geht</div>
          <div style={s.heroPanelValue}>Interne Bedienungsanleitung für den echten Betrieb</div>
          <p style={{ ...s.sideText, marginTop: 2 }}>
            Erst verstehen, dann klicken. Besonders bei Admin-, KI- und Service-Funktionen.
          </p>
        </div>
      </div>

      <div style={s.layout}>
        <aside style={s.sideWrap}>
          <Card className="card-pad">
            <div style={s.sideTitle}>So benutzt du dieses Wiki</div>
            <p style={s.sideText}>Suche links das Thema, öffne den Eintrag und arbeite die Schritte von oben nach unten ab.</p>
          </Card>

          {WIKI_MANUAL_GROUPS.map((group) => (
            <Card key={group.id} className="card-pad">
              <div style={s.sideTitle}>{group.title}</div>
              <p style={s.groupDescription}>{group.description}</p>
              <div style={s.sideList}>
                {group.slugs.map((entrySlug) => {
                  const entry = WIKI_MANUAL_BY_SLUG[entrySlug];
                  if (!entry) return null;
                  return (
                    <a key={entry.slug} href={wikiUrl(entry.slug)} style={s.sideLink}>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{entry.title}</span>
                        <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{entry.summary}</span>
                      </span>
                      <ArrowRight size={14} color="var(--text-dim)" />
                    </a>
                  );
                })}
              </div>
            </Card>
          ))}
        </aside>

        <main style={s.articleWrap}>
          {!slug && <WikiHome />}
          {slug && !page && <WikiMissing />}
          {page && <WikiArticle slug={slug} />}
        </main>
      </div>
    </div>
  );
}

function WikiHome() {
  return (
    <>
      <Card className="card-pad" style={s.summaryCard}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <BookOpen size={18} color="var(--accent)" />
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>Was du hier findest</div>
        </div>
        <p style={s.articleLead}>
          Dieses interne Wiki ist für die Bedienung von Nexora gedacht. Keine Architekturvorlesung,
          keine Fremdseite, kein eingebettetes Handbuch. Nur die Frage: Was mache ich auf dieser Seite konkret?
        </p>
        <div style={s.keyFacts}>
          <div style={s.keyFact}>
            <div style={s.keyLabel}>Für Einsteiger</div>
            <div style={s.keyValue}>Beginne mit „Erste Schritte“, „Tickets“ und „Evidence Center“.</div>
          </div>
          <div style={s.keyFact}>
            <div style={s.keyLabel}>Für Admins</div>
            <div style={s.keyValue}>Arbeite Integrationen, Sicherheit und Services nur in kleinen, testbaren Schritten ab.</div>
          </div>
        </div>
      </Card>

      <QuickStartVisual />

      {WIKI_MANUAL_GROUPS.map((group) => (
        <Card key={group.id} style={s.sectionCard}>
          <div style={s.sectionHeader}>
            <div>
              <div style={s.sectionMeta}>{group.description}</div>
              <h3 style={s.sectionTitle}>{group.title}</h3>
            </div>
            <Badge>{group.slugs.length} Einträge</Badge>
          </div>
          <div style={s.relatedWrap}>
            {group.slugs.map((slug) => {
              const page = WIKI_MANUAL_BY_SLUG[slug];
              if (!page) return null;
              return (
                <a key={slug} href={wikiUrl(slug)} style={s.relatedCard}>
                  <div style={s.relatedTitle}>{page.title}</div>
                  <div style={s.relatedBody}>{page.summary}</div>
                </a>
              );
            })}
          </div>
        </Card>
      ))}
    </>
  );
}

function WikiArticle({ slug }: { slug: string }) {
  const page = WIKI_MANUAL_BY_SLUG[slug];
  return (
    <>
      <Card className="card-pad" style={s.summaryCard}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <ShieldCheck size={16} color="var(--accent)" />
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>Kurz vorweg</div>
        </div>
        <p style={s.articleLead}>{page.goal}</p>
        <div style={s.keyFacts}>
          <div style={s.keyFact}>
            <div style={s.keyLabel}>Zielgruppe</div>
            <div style={s.keyValue}>{page.audience}</div>
          </div>
          <div style={s.keyFact}>
            <div style={s.keyLabel}>Worum es geht</div>
            <div style={s.keyValue}>{page.summary}</div>
          </div>
        </div>
        <div style={s.chips}>
          <Badge tone="accent">Schritt für Schritt</Badge>
          <Badge>Interne Bedienung</Badge>
          <Badge>Mit visuellen Hilfen</Badge>
        </div>
      </Card>

      {slug === 'start/erste-schritte' && <QuickStartVisual />}
      {slug === 'bedienung/deployment-center' && <DeploymentVisual />}

      <Card style={s.sectionCard}>
        <div style={s.sectionHeader}>
          <h3 style={s.sectionTitle}>Bevor du loslegst</h3>
          <Badge tone="warning">Erst lesen</Badge>
        </div>
        <div style={s.checklist}>
          {page.beforeYouStart.map((item) => (
            <div key={item} style={s.checklistItem}>
              <CircleAlert size={16} color="var(--accent)" style={{ marginTop: 2 }} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </Card>

      {page.sections.map((section) => (
        <Card key={section.title} style={s.sectionCard}>
          <div style={s.sectionHeader}>
            <h3 style={s.sectionTitle}>{section.title}</h3>
            {section.steps ? <Badge tone="success">Ablauf</Badge> : <Badge>Hinweis</Badge>}
          </div>
          <p style={s.sectionBody}>{section.body}</p>
          {section.steps && (
            <div style={s.steps}>
              {section.steps.map((step, index) => (
                <div key={step} style={s.step}>
                  <div style={s.stepNumber}>{index + 1}</div>
                  <div style={s.stepText}>{step}</div>
                </div>
              ))}
            </div>
          )}
          {section.bullets && (
            <div style={s.bullets}>
              {section.bullets.map((bullet) => (
                <div key={bullet} style={s.bullet}>
                  <span style={s.bulletDot} />
                  <span>{bullet}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      ))}

      {page.related && page.related.length > 0 && (
        <Card style={s.sectionCard}>
          <div style={s.sectionHeader}>
            <h3 style={s.sectionTitle}>Danach hilfreich</h3>
            <Badge tone="accent">Nächste Schritte</Badge>
          </div>
          <div style={s.relatedWrap}>
            {page.related.map((relatedSlug) => {
              const related = WIKI_MANUAL_BY_SLUG[relatedSlug];
              if (!related) return null;
              return (
                <a key={related.slug} href={wikiUrl(related.slug)} style={s.relatedCard}>
                  <div style={s.relatedTitle}>{related.title}</div>
                  <div style={s.relatedBody}>{related.summary}</div>
                </a>
              );
            })}
          </div>
        </Card>
      )}
    </>
  );
}

function WikiMissing() {
  return (
    <Card className="card-pad">
      <EmptyState
        title="Dieser Wiki-Eintrag fehlt noch"
        message="Die interne Bedienungsseite für dieses Thema ist noch nicht geschrieben. Nutze vorerst die vorhandenen Bereiche links und öffne einen benachbarten Eintrag."
      />
    </Card>
  );
}
