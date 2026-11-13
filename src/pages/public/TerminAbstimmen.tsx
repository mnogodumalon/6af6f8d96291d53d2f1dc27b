import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { IconCheck, IconQuestionMark, IconX, IconTrophy, IconMapPin } from '@tabler/icons-react';
import { PublicShell } from '@/components/PublicShell';
import { Bound } from '@/components/blocks/Bound';
import { LoadProblem } from '@/components/blocks/LoadProblem';
import { FieldErrorSummary } from '@/components/blocks/FieldErrorSummary';
import { Button } from '@/components/ui/button';
import { tx } from '@/i18n';
import {
  loadPublicPagesConfig, prepareChallenge,
  type PublicPagesConfig, type PublicPageConfig,
} from '@/lib/publicClient';
import { createPublicPort } from '@/lib/journey/publicPort';
import {
  useStepForm, useJourneySubmit, useLiveList, submissionsOf, topOne,
  fieldText, fieldDate, fieldRef, fieldLookup,
  type JourneyPort, type JourneyRecord,
} from '@/lib/journey';

const SLUG = 'termin-abstimmen';

type Vote = 'ja' | 'vielleicht' | 'nein';

function newRowId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function TerminAbstimmen() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPublicPagesConfig(SLUG).then(c => {
      setCfg(c);
      setPage(c?.pages[SLUG] ?? null);
      setLoading(false);
    });
  }, []);

  if (loading || !cfg || !page) {
    return <PublicShell loading={loading} unavailable={!loading} />;
  }
  return <Poll cfg={cfg} page={page} />;
}

function Poll({ cfg, page }: { cfg: PublicPagesConfig; page: PublicPageConfig }) {
  const [params] = useSearchParams();
  const linkedId = params.get('umfrage') ?? '';
  const port: JourneyPort = useMemo(() => createPublicPort(cfg, page), [cfg, page]);

  const umfragenLive = useLiveList(port, 'umfragen', { intervalMs: 30000 });
  const termineLive = useLiveList(port, 'terminvorschlaege', { intervalMs: 30000 });
  const antwortenLive = useLiveList(port, 'antworten', { intervalMs: 30000 });

  const [votes, setVotes] = useState<Record<string, Vote>>({});
  const [rowId, setRowId] = useState(newRowId);
  const [notice, setNotice] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const umfrage = useMemo(
    () => umfragenLive.records.find(r => r.id === linkedId) ?? null,
    [umfragenLive.records, linkedId],
  );

  const termine = useMemo(
    () => termineLive.records
      .filter(r => fieldRef(r, 'umfrage') === linkedId)
      .sort((a, b) => (fieldDate(a, 'beginn') ?? '').localeCompare(fieldDate(b, 'beginn') ?? '')),
    [termineLive.records, linkedId],
  );
  const antworten = useMemo(
    () => antwortenLive.records.filter(r => fieldRef(r, 'umfrage') === linkedId),
    [antwortenLive.records, linkedId],
  );
  const rows = useMemo(
    () => submissionsOf(antworten, { key: 'uebermittlungs_id', names: ['teilnehmer_vorname', 'teilnehmer_nachname'] }),
    [antworten],
  );

  const closed = umfrage ? fieldLookup(umfrage, 'status')?.key === 'geschlossen' : false;
  const finalId = umfrage ? fieldRef(umfrage, 'finaler_termin') : null;

  const stats = useMemo(() => termine.map(t => {
    const own = antworten.filter(r => fieldRef(r, 'terminvorschlag') === t.id);
    return {
      id: t.id,
      ja: own.filter(r => fieldLookup(r, 'antwort')?.key === 'ja').length,
      vielleicht: own.filter(r => fieldLookup(r, 'antwort')?.key === 'vielleicht').length,
      beginn: fieldDate(t, 'beginn'),
    };
  }), [termine, antworten]);
  const top = topOne(stats, [s => s.ja, s => s.vielleicht], s => s.beginn);
  const markedId = closed && finalId ? finalId : top?.id ?? null;

  const form = useStepForm('antworten', {
    fields: ['teilnehmer_vorname', 'teilnehmer_nachname'],
    required: { teilnehmer_vorname: true, teilnehmer_nachname: true },
    autoComplete: true,
  });

  const plan = useMemo(() => termine.map((t, i) => ({
    key: `antwort-${t.id}`,
    entity: 'antworten' as const,
    form,
    primary: i === 0,
    values: () => ({
      umfrage: linkedId,
      terminvorschlag: t.id,
      antwort: votes[t.id],
      uebermittlungs_id: rowId,
    }),
  })), [termine, form, linkedId, votes, rowId]);

  const submit = useJourneySubmit(port, plan, {
    draftKey: `termin-abstimmen-${linkedId}`,
    check: async () => {
      const fresh = await port.get('umfragen', linkedId);
      if (!fresh) return tx('Diese Umfrage gibt es nicht mehr.');
      if (fieldLookup(fresh, 'status')?.key !== 'offen') return tx('Die Umfrage ist inzwischen geschlossen.');
      const checks = await Promise.all(termine.map(t => port.get('terminvorschlaege', t.id)));
      if (checks.some(c => !c || fieldRef(c, 'umfrage') !== linkedId)) return tx('Die Termine haben sich geändert. Bitte lade die Seite neu.');
      return null;
    },
  });

  if (!linkedId) {
    return (
      <PublicShell title={tx('Termin abstimmen')}>
        <p className="text-sm text-muted-foreground">{tx('Öffne bitte den Link oder QR-Code, den du zur Umfrage bekommen hast.')}</p>
      </PublicShell>
    );
  }
  if (!umfragenLive.loaded && umfragenLive.error) {
    return <PublicShell title={tx('Termin abstimmen')}><LoadProblem onRetry={umfragenLive.reload} /></PublicShell>;
  }
  if (!umfragenLive.loaded) return <PublicShell loading />;
  if (!umfrage) {
    return (
      <PublicShell title={tx('Termin abstimmen')}>
        <p className="text-sm text-muted-foreground">{tx('Dieser Link passt zu keiner Umfrage. Scanne bitte den QR-Code noch einmal.')}</p>
      </PublicShell>
    );
  }

  const ort = fieldText(umfrage, 'ort');
  const finalTermin = finalId ? termine.find(t => t.id === finalId) ?? null : null;
  const allVoted = termine.length > 0 && termine.every(t => votes[t.id]);

  const send = async () => {
    setNotice(null);
    setSent(false);
    prepareChallenge(cfg, page, 'POST', `/apps/${page.endpoints?.find(e => e.op === 'create')?.app_id ?? ''}/records`);
    const okForm = form.validate();
    if (!allVoted) {
      setNotice(tx('Bitte wähle für jeden Termin Ja, Vielleicht oder Nein.'));
      return;
    }
    if (!okForm) return;
    const res = await submit.run();
    if (res) {
      setSent(true);
      form.reset();
      setVotes({});
      setRowId(newRowId());
      submit.reset();
      await Promise.all([antwortenLive.reload(), umfragenLive.reload()]);
    }
  };

  const options: Array<{ key: Vote; label: string; icon: ReactNode; on: string }> = [
    { key: 'ja', label: tx('Ja'), icon: <IconCheck size={18} />, on: 'bg-emerald-500 text-white border-emerald-500' },
    { key: 'vielleicht', label: tx('Vielleicht'), icon: <IconQuestionMark size={18} />, on: 'bg-amber-400 text-black border-amber-400' },
    { key: 'nein', label: tx('Nein'), icon: <IconX size={18} />, on: 'bg-rose-500 text-white border-rose-500' },
  ];

  const cellFor = (r: JourneyRecord | undefined) => {
    const k = r ? fieldLookup(r, 'antwort')?.key : undefined;
    const o = options.find(x => x.key === k);
    if (!o) return <span className="text-muted-foreground">–</span>;
    return (
      <span className={`inline-flex items-center justify-center gap-1 rounded-full border px-2 py-1 text-xs ${o.on}`} title={o.label} aria-label={o.label}>
        {o.icon}
      </span>
    );
  };

  return (
    <PublicShell title={fieldText(umfrage, 'titel')} description={fieldText(umfrage, 'beschreibung') || undefined} wide>
      <div className="space-y-5">
        {ort && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <IconMapPin size={16} className="shrink-0" />{ort}
          </p>
        )}

        {closed && (
          <div className="rounded-xl border bg-muted/40 p-4">
            <p className="text-sm font-medium">{tx('Die Umfrage ist geschlossen.')}</p>
            <p className="mt-1 text-sm">
              {finalTermin
                ? <>{tx('Finaler Termin:')} <b>{fieldText(finalTermin, 'beginn')}</b> – {fieldText(finalTermin, 'ende')}</>
                : tx('Ein finaler Termin wurde noch nicht festgelegt.')}
            </p>
          </div>
        )}

        {!closed && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Bound form={form} name="teilnehmer_vorname" />
            <Bound form={form} name="teilnehmer_nachname" />
          </div>
        )}

        {termine.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tx('Für diese Umfrage gibt es noch keine Termine.')}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted/40">
                  <th className="sticky left-0 z-10 max-w-[40vw] bg-muted p-2 text-left font-medium">{tx('Teilnehmende')}</th>
                  {termine.map(t => (
                    <th key={t.id} className={`min-w-28 p-2 text-center font-medium ${t.id === markedId ? 'bg-emerald-100 text-emerald-900' : ''}`}>
                      <div>{fieldText(t, 'beginn')}</div>
                      <div className="text-xs font-normal text-muted-foreground">{tx('bis')} {fieldText(t, 'ende')}</div>
                      {t.id === markedId && (
                        <div className="mt-1 inline-flex items-center gap-1 text-xs font-semibold">
                          <IconTrophy size={14} />{closed ? tx('Finaler Termin') : tx('Beliebtester Termin')}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(s => (
                  <tr key={s.key} className="border-t">
                    <td className="sticky left-0 z-10 max-w-[40vw] truncate bg-background p-2 font-medium">{s.label}</td>
                    {termine.map(t => (
                      <td key={t.id} className="p-2 text-center">
                        {cellFor(s.records.find(r => fieldRef(r, 'terminvorschlag') === t.id))}
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr className="border-t">
                    <td colSpan={termine.length + 1} className="p-3 text-center text-muted-foreground">{tx('Noch niemand hat abgestimmt.')}</td>
                  </tr>
                )}
                {!closed && (
                  <tr className="border-t bg-primary/5">
                    <td className="sticky left-0 z-10 max-w-[40vw] bg-muted p-2 font-medium">{tx('Deine Antwort')}</td>
                    {termine.map(t => (
                      <td key={t.id} className="p-2">
                        <div className="flex justify-center gap-1" role="group" aria-label={fieldText(t, 'beginn')}>
                          {options.map(o => (
                            <button
                              key={o.key}
                              type="button"
                              aria-pressed={votes[t.id] === o.key}
                              aria-label={o.label}
                              title={o.label}
                              onClick={() => { setVotes(v => ({ ...v, [t.id]: o.key })); setNotice(null); }}
                              className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg border ${votes[t.id] === o.key ? o.on : 'bg-background hover:bg-muted'}`}
                            >
                              {o.icon}
                            </button>
                          ))}
                        </div>
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/40">
                  <td className="sticky left-0 z-10 max-w-[40vw] bg-muted p-2 text-xs font-medium">{tx('Summe')}</td>
                  {stats.map(s => (
                    <td key={s.id} className={`p-2 text-center text-xs ${s.id === markedId ? 'font-semibold' : ''}`}>
                      <div>{tx`${s.ja} Ja`}</div>
                      <div className="text-muted-foreground">{tx`${s.vielleicht} Vielleicht`}</div>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {!closed && termine.length > 0 && (
          <div className="space-y-3">
            <FieldErrorSummary forms={[form]} />
            {notice && <p role="alert" className="text-sm text-destructive">{notice}</p>}
            {submit.error && !submit.offline && !submit.limited && (
              <p role="alert" className="text-sm text-destructive">{submit.error.message || tx('Das hat nicht geklappt. Bitte versuche es noch einmal.')}</p>
            )}
            {submit.offline && <p className="text-sm text-muted-foreground">{tx('Keine Verbindung — deine Eingaben sind gesichert und werden gesendet, sobald du wieder online bist.')}</p>}
            {submit.limited && <p className="text-sm text-muted-foreground">{tx('Gerade sind viele Leute online — deine Antwort wird gleich automatisch gesendet.')}</p>}
            {sent && <p className="text-sm font-medium text-emerald-700">{tx('Danke! Deine Antwort ist gespeichert.')}</p>}
            <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={submit.submitting} onClick={send}>
              {submit.submitting ? tx('Wird gespeichert …') : tx('Antwort speichern')}
            </Button>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
