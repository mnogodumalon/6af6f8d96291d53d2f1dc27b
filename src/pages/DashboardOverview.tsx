import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { IconCheck, IconCopy, IconLock, IconPlus, IconQrcode, IconStar } from '@tabler/icons-react';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { flowActionFor, countOf } from '@/config/plan';
import type { Umfragen, Terminvorschlaege } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import { lookupKey } from '@/lib/formatters';
import { tx, appLabel, dateFnsLocale } from '@/i18n';
import { gruss, namen, undoToast, useClock } from '@/lib/polish';
import { submissionsOf } from '@/lib/journey';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { Button } from '@/components/ui/button';
import { usePublicPageLink } from '@/components/widgets/PublicPageQr';
import { qrSvgString } from '@/components/widgets/QrCode';

type Filter = 'all' | 'open' | 'nofinal';

function ShareButtons({ id }: { id: string }) {
  const { link } = usePublicPageLink('umfragen', id);
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      undoToast(tx('Link kopiert'));
    } catch {
      window.prompt(tx('Link kopieren'), link);
    }
  };
  const openQr = () => {
    if (!link) return;
    const blob = new Blob([qrSvgString(link, { pixelSize: 12 })], { type: 'image/svg+xml' });
    window.open(URL.createObjectURL(blob), '_blank');
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={!link} onClick={copy}>
        <IconCopy size={16} className="shrink-0" />{tx('Link kopieren')}
      </Button>
      <Button size="sm" variant="outline" disabled={!link} onClick={openQr}>
        <IconQrcode size={16} className="shrink-0" />{tx('QR-Code öffnen')}
      </Button>
    </div>
  );
}

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const { umfragen, terminvorschlaege, antworten } = data;
  const crud = useEntityCrud(data);
  const clock = useClock();
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => {
    return umfragen.map(u => {
      const termine = terminvorschlaege
        .filter(t => extractRecordId(t.fields.umfrage) === u.record_id)
        .sort((a, b) => (a.fields.beginn ?? '').localeCompare(b.fields.beginn ?? ''));
      const ans = antworten.filter(a => extractRecordId(a.fields.umfrage) === u.record_id);
      const teilnehmende = submissionsOf(ans, {
        key: 'uebermittlungs_id',
        names: ['teilnehmer_vorname', 'teilnehmer_nachname'],
      }).length;
      const tally = termine.map(t => {
        const forT = ans.filter(a => extractRecordId(a.fields.terminvorschlag) === t.record_id);
        return {
          termin: t,
          ja: forT.filter(a => lookupKey(a.fields.antwort) === 'ja').length,
          vielleicht: forT.filter(a => lookupKey(a.fields.antwort) === 'vielleicht').length,
        };
      });
      const maxJa = Math.max(0, ...tally.map(x => x.ja));
      const finalId = extractRecordId(u.fields.finaler_termin);
      return {
        u,
        closed: lookupKey(u.fields.status) === 'geschlossen',
        finalId,
        teilnehmende,
        tally,
        maxJa,
      };
    });
  }, [umfragen, terminvorschlaege, antworten]);

  const open = rows.filter(r => !r.closed);
  const noFinal = rows.filter(r => !r.finalId);
  const shown = rows.filter(r => filter === 'open' ? !r.closed : filter === 'nofinal' ? !r.finalId : true);

  const fmtTermin = (t: Terminvorschlaege) => {
    const loc = { locale: dateFnsLocale() };
    try {
      const b = t.fields.beginn ? parseISO(t.fields.beginn) : null;
      const e = t.fields.ende ? parseISO(t.fields.ende) : null;
      if (!b) return '—';
      const start = format(b, 'EEE dd.MM. HH:mm', loc);
      if (!e) return start;
      const sameDay = format(b, 'yyyy-MM-dd') === format(e, 'yyyy-MM-dd');
      return `${start} – ${format(e, sameDay ? 'HH:mm' : 'EEE dd.MM. HH:mm', loc)}`;
    } catch {
      return '—';
    }
  };

  const closeAction = (u: Umfragen) => {
    const go = flowActionFor('umfragen', 'status', u.record_id, 'geschlossen');
    return go ? { label: tx('Termin festlegen'), onClick: go } : undefined;
  };

  const context = open.length === 0
    ? tx('Aktuell läuft keine Umfrage — lege eine neue an, um Termine abzustimmen.')
    : tx`Offen: ${namen(open.map(r => r.u.fields.titel ?? ''), 3)} — ${countOf('antworten', open.reduce((s, r) => s + r.teilnehmende, 0), appLabel('antworten'))} bisher.`;

  const primary = (
    <div className="space-y-4 min-w-0">
      {shown.length === 0 && (
        <div className="rounded-[27px] bg-card shadow-sm p-8 text-center space-y-3">
          <IconCheck size={48} className="mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{tx('Keine Umfragen in dieser Ansicht.')}</p>
          {crud.umfragen.canWrite && (
            <Button onClick={() => crud.umfragen.openCreate({ status: 'offen' })}>
              <IconPlus size={16} />{tx('Erste Umfrage anlegen')}
            </Button>
          )}
        </div>
      )}
      {shown.map(({ u, closed, finalId, teilnehmende, tally, maxJa }) => {
        const finalTermin = tally.find(x => x.termin.record_id === finalId);
        return (
          <div key={u.record_id} className="rounded-[27px] bg-card shadow-sm p-4 sm:p-5 space-y-3 overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <button type="button" className="text-left font-semibold text-base truncate max-w-full hover:underline"
                  onClick={() => crud.umfragen.openDetail(u)}>
                  {u.fields.titel ?? '—'}
                </button>
                <p className="text-sm text-muted-foreground truncate">
                  <span className={closed ? 'font-medium text-muted-foreground' : 'font-medium text-emerald-600'}>
                    {u.fields.status?.label}
                  </span>
                  {u.fields.ort ? ` · ${u.fields.ort}` : ''} · {countOf('antworten', teilnehmende, appLabel('antworten'))}
                </p>
              </div>
              {!closed && closeAction(u) && (
                <Button size="sm" onClick={closeAction(u)!.onClick}>
                  <IconLock size={16} className="shrink-0" />{tx('Finalen Termin festlegen')}
                </Button>
              )}
            </div>

            {finalTermin && (
              <p className="text-sm rounded-lg bg-primary/10 px-3 py-2">
                <b>{tx('Finaler Termin')}:</b> {fmtTermin(finalTermin.termin)}
              </p>
            )}

            {tally.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tx('Noch keine Terminvorschläge.')}</p>
            ) : (
              <ul className="divide-y">
                {tally.map(({ termin, ja, vielleicht }) => {
                  const best = maxJa > 0 && ja === maxJa;
                  return (
                    <li key={termin.record_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                      <span className="min-w-0 text-sm flex items-center gap-1.5">
                        {best && <IconStar size={14} className="shrink-0 text-amber-500" />}
                        <span className={best ? 'font-semibold' : ''}>{fmtTermin(termin)}</span>
                      </span>
                      <span className="flex gap-3 text-sm shrink-0">
                        <span className="font-medium text-emerald-600">{tx('Ja')} {ja}</span>
                        <span className="font-medium text-amber-600">{tx('Vielleicht')} {vielleicht}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <ShareButtons id={u.record_id} />
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{gruss(clock)}</h1>
          <p className="text-sm text-muted-foreground">{context}</p>
        </div>
        {crud.umfragen.canWrite && (
          <Button onClick={() => crud.umfragen.openCreate({ status: 'offen' })}>
            <IconPlus size={16} />{tx('Neue Umfrage')}
          </Button>
        )}
      </div>

      {/* Hand-built poll cards: no pre-built widget covers a per-poll Ja/Vielleicht tally with share actions. */}
      <DashboardGrid
        variant="split"
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Offene Umfragen')}
              value={open.length}
              tone={open.length > 0 ? 'primary' : 'default'}
              onClick={() => setFilter(f => f === 'open' ? 'all' : 'open')}
              active={filter === 'open'}
            />
            <StatStripItem
              title={tx('Ohne finalen Termin')}
              value={noFinal.length}
              tone={noFinal.length > 0 ? 'warning' : 'default'}
              onClick={() => setFilter(f => f === 'nofinal' ? 'all' : 'nofinal')}
              active={filter === 'nofinal'}
            />
          </StatStrip>
        }
        aside={
          <WorkList
            title={tx('Wartet auf Entscheidung')}
            items={noFinal.filter(r => !r.closed).map(r => {
              const act = closeAction(r.u);
              return {
                id: r.u.record_id,
                title: r.u.fields.titel ?? '—',
                secondLine: (
                  <span className="text-muted-foreground">
                    {countOf('antworten', r.teilnehmende, appLabel('antworten'))}
                  </span>
                ),
                action: act,
              };
            })}
            onItemClick={id => { const r = umfragen.find(x => x.record_id === id); if (r) crud.umfragen.openDetail(r); }}
            empty={{ text: tx('Alle offenen Umfragen haben einen finalen Termin.') }}
          />
        }
        primary={primary}
      />
      {crud.surfaces}
    </div>
  );
}
