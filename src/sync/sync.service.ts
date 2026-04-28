import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Initiative,
  InitiativeType,
  InitiativeStep,
  InitiativeLink,
  LinkType,
} from '@idemos/common';
import { CongresoService } from '../congreso/congreso.service.js';
import type { CongresoRawRecord } from '../congreso/congreso.types.js';
import { SyncLog } from './sync-log.entity.js';

export interface SyncResult {
  inserted: number;
  updated: number;
  failed: number;
  total: number;
}

interface ParsedStep {
  stepType: string;
  description: string;
  startDate: Date | null;
  endDate: Date | null;
  orderIndex: number;
}

interface ParsedLink {
  linkType: LinkType;
  url: string;
}

function parseDDMMYYYY(str: string | undefined): Date | null {
  if (!str?.trim()) return null;
  const match = str.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

function toRoman(n: number): string {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = [
    'M',
    'CM',
    'D',
    'CD',
    'C',
    'XC',
    'L',
    'XL',
    'X',
    'IX',
    'V',
    'IV',
    'I',
  ];
  let result = '';
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) {
      result += syms[i];
      n -= vals[i];
    }
  }
  return result;
}

function convertLegislatura(raw: string): string {
  const match = raw.match(/Leg\.(\d+)/i);
  if (!match) return raw;
  return toRoman(parseInt(match[1], 10));
}

function extractLegNum(raw: string): number | null {
  const match = raw.match(/Leg\.(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function detectCurrentLegislature(
  records: import('../congreso/congreso.types.js').CongresoRawRecord[],
): number | null {
  let max: number | null = null;
  for (const r of records) {
    const n = extractLegNum(r.LEGISLATURA);
    if (n !== null && (max === null || n > max)) max = n;
  }
  return max;
}

function classifyType(tipo: string): InitiativeType {
  const lower = tipo.toLowerCase();
  if (lower.includes('proposici')) return InitiativeType.Proposicion;
  return InitiativeType.Proyecto;
}

function cleanText(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanStatus(raw: string): string {
  return raw
    .replace(/\n/g, ' — ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function parseClosedAt(resultadoText: string | undefined): Date | null {
  if (!resultadoText) return null;
  const matches = resultadoText.match(/(\d{2}\/\d{2}\/\d{4})/g);
  if (!matches || matches.length === 0) return null;
  return parseDDMMYYYY(matches[matches.length - 1]);
}

function parseSteps(raw: string | undefined): ParsedStep[] {
  if (!raw?.trim()) return [];

  const DATE_RE =
    /^desde\s+(\d{2}\/\d{2}\/\d{4})(?:\s+hasta\s+(\d{2}\/\d{2}\/\d{4}))?/;
  const SKIP_RE =
    /^(>>|Nota:|Hasta:|Concluido\s*-|Aprobado|Rechazado|Retirado)/i;

  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const steps: ParsedStep[] = [];
  let i = 0;
  let orderIndex = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (DATE_RE.test(line) || SKIP_RE.test(line) || line === '>>') {
      i++;
      continue;
    }

    const next = lines[i + 1];
    const afterNext = lines[i + 2];

    if (
      next &&
      !DATE_RE.test(next) &&
      !SKIP_RE.test(next) &&
      next !== '>>' &&
      afterNext &&
      DATE_RE.test(afterNext)
    ) {
      const dateMatch = afterNext.match(DATE_RE)!;
      steps.push({
        stepType: next,
        description: `${line} — ${next}`,
        startDate: parseDDMMYYYY(dateMatch[1]),
        endDate: dateMatch[2] ? parseDDMMYYYY(dateMatch[2]) : null,
        orderIndex: orderIndex++,
      });
      i += 3;
      continue;
    }

    if (next && DATE_RE.test(next)) {
      const dateMatch = next.match(DATE_RE)!;
      steps.push({
        stepType: line,
        description: line,
        startDate: parseDDMMYYYY(dateMatch[1]),
        endDate: dateMatch[2] ? parseDDMMYYYY(dateMatch[2]) : null,
        orderIndex: orderIndex++,
      });
      i += 2;
      continue;
    }

    // Skip bare lines that are clearly continuation fragments:
    // - start with a digit (e.g. "30/10/2024 que fue suspendida...")
    // - start with a lowercase letter (e.g. "de 04/11/2024, el Senado co...")
    if (/^[\d]/.test(line) || /^[a-záéíóúüñ]/u.test(line)) {
      i++;
      continue;
    }

    steps.push({
      stepType: line,
      description: line,
      startDate: null,
      endDate: null,
      orderIndex: orderIndex++,
    });
    i++;
  }

  return steps;
}

function parseLinks(
  bocgText: string | undefined,
  dsText: string | undefined,
): ParsedLink[] {
  const links: ParsedLink[] = [];

  if (bocgText) {
    for (const url of bocgText
      .split('\n')
      .map((u) => u.trim())
      .filter((u) => u.startsWith('http'))) {
      links.push({ linkType: LinkType.BOCG, url });
    }
  }

  if (dsText) {
    for (const url of dsText
      .split('\n')
      .map((u) => u.trim())
      .filter((u) => u.startsWith('http'))) {
      links.push({ linkType: LinkType.DS, url });
    }
  }

  return links;
}

@Injectable()
export class SyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SyncService.name);
  private running = false;

  constructor(
    private readonly congresoService: CongresoService,
    @InjectRepository(Initiative)
    private readonly initiativeRepo: Repository<Initiative>,
    @InjectRepository(InitiativeStep)
    private readonly stepRepo: Repository<InitiativeStep>,
    @InjectRepository(InitiativeLink)
    private readonly linkRepo: Repository<InitiativeLink>,
    @InjectRepository(SyncLog)
    private readonly syncLogRepo: Repository<SyncLog>,
    @Inject('AI_SERVICE')
    private readonly aiClient: ClientProxy,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const lastSuccess = await this.syncLogRepo.findOne({
      where: { status: 'success' },
      order: { finishedAt: 'DESC' },
    });

    const now = new Date();
    const todayUTC = now.toISOString().slice(0, 10);
    const lastSyncDate = lastSuccess?.finishedAt?.toISOString().slice(0, 10);

    if (!lastSuccess || lastSyncDate !== todayUTC) {
      if (!lastSuccess) {
        this.logger.log(
          'No prior sync history — running initial full sync on startup',
        );
      } else {
        const msElapsed = now.getTime() - lastSuccess.finishedAt!.getTime();
        const daysElapsed = Math.ceil(msElapsed / (1000 * 60 * 60 * 24));
        this.logger.log(
          `Last sync was ${daysElapsed} day(s) ago (${lastSyncDate}) — running catch-up sync on startup`,
        );
      }
      await this.syncAll();
    } else {
      this.logger.log(
        `Last sync was today (${lastSyncDate}) — skipping startup sync`,
      );
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async syncAll(): Promise<SyncResult> {
    if (this.running) {
      this.logger.warn('Sync already in progress — skipping');
      return { inserted: 0, updated: 0, failed: 0, total: 0 };
    }
    this.running = true;

    const log = await this.syncLogRepo.save(
      this.syncLogRepo.create({ startedAt: new Date(), status: 'pending' }),
    );

    this.logger.log('Starting full sync from congreso.es…');

    try {
      const records = await this.congresoService.fetchAll();

      if (records.length === 0) {
        this.logger.warn('No records fetched — aborting sync');
        await this.syncLogRepo.update(log.id, {
          finishedAt: new Date(),
          status: 'error',
          errorMessage: 'No records fetched from source',
        });
        return { inserted: 0, updated: 0, failed: 0, total: 0 };
      }

      const currentLeg = detectCurrentLegislature(records);
      const filtered =
        currentLeg !== null
          ? records.filter((r) => extractLegNum(r.LEGISLATURA) === currentLeg)
          : records;

      this.logger.log(
        `Current legislature: Leg.${currentLeg ?? '?'} — processing ${filtered.length}/${records.length} records`,
      );

      let inserted = 0;
      let updated = 0;
      let failed = 0;

      for (const record of filtered) {
        try {
          const wasNew = await this.processRecord(record);
          if (wasNew) inserted++;
          else updated++;
        } catch (err: unknown) {
          failed++;
          this.logger.warn(
            `Failed to process ${record.NUMEXPEDIENTE}: ${(err as Error).message}`,
          );
        }
      }

      const result: SyncResult = {
        inserted,
        updated,
        failed,
        total: filtered.length,
      };

      await this.syncLogRepo.update(log.id, {
        finishedAt: new Date(),
        status: 'success',
        ...result,
      });

      this.logger.log(
        `Sync complete — inserted: ${inserted}, updated: ${updated}, failed: ${failed}`,
      );

      this.aiClient.emit('sync.completed', {});
      this.logger.log('Notified AI service to generate pending summaries.');

      return result;
    } catch (err: unknown) {
      await this.syncLogRepo.update(log.id, {
        finishedAt: new Date(),
        status: 'error',
        errorMessage: (err as Error).message,
      });
      throw err;
    } finally {
      this.running = false;
    }
  }

  private async processRecord(record: CongresoRawRecord): Promise<boolean> {
    const presentedAt = parseDDMMYYYY(record.FECHAPRESENTACION);
    if (!presentedAt) return false;

    const expediente = record.NUMEXPEDIENTE.trim();
    const type = classifyType(record.TIPO);
    const currentStatus = cleanStatus(record.SITUACIONACTUAL);

    const coreData = {
      source: 'CONGRESO' as const,
      legislature: convertLegislatura(record.LEGISLATURA),
      type,
      expediente,
      title: cleanText(record.OBJETO),
      author: cleanText(record.AUTOR),
      procedureType: cleanText(record.TIPOTRAMITACION),
      currentStatus,
      committee: cleanText(record.COMISIONCOMPETENTE) || null,
      presentedAt,
      qualifiedAt: record.FECHACALIFICACION
        ? parseDDMMYYYY(record.FECHACALIFICACION)
        : null,
      closedAt: parseClosedAt(record.RESULTADOTRAMITACION),
    };

    let initiative = await this.initiativeRepo.findOne({
      where: { expediente },
    });

    let isNew = false;

    if (initiative) {
      await this.initiativeRepo.update(initiative.id, {
        currentStatus: coreData.currentStatus,
        closedAt: coreData.closedAt,
        qualifiedAt: coreData.qualifiedAt,
        committee: coreData.committee,
        title: coreData.title,
        procedureType: coreData.procedureType,
      });
      await this.stepRepo.delete({ initiativeId: initiative.id });
      await this.linkRepo.delete({ initiativeId: initiative.id });
    } else {
      initiative = await this.initiativeRepo.save(
        this.initiativeRepo.create(coreData),
      );
      isNew = true;
    }

    const parsedSteps = parseSteps(record.TRAMITACIONSEGUIDA);
    if (parsedSteps.length > 0) {
      const steps = parsedSteps.map((s) =>
        this.stepRepo.create({
          initiativeId: initiative!.id,
          stepType: s.stepType,
          description: s.description,
          startDate: s.startDate ?? undefined,
          endDate: s.endDate ?? undefined,
          orderIndex: s.orderIndex,
        }),
      );
      await this.stepRepo.save(steps);
    }

    const parsedLinks = parseLinks(record.ENLACESBOCG, record.ENLACESDS);

    // Always include the official congreso.es detail page link
    const legNum = extractLegNum(record.LEGISLATURA);
    const congresoUrl = `https://www.congreso.es/es/busqueda-de-iniciativas?legis=${legNum ?? ''}&p_icm=2&p_mf=1&p_num=${encodeURIComponent(record.NUMEXPEDIENTE.trim())}`;
    const allLinks: typeof parsedLinks = [
      { linkType: LinkType.OTHER, url: congresoUrl },
      ...parsedLinks,
    ];

    const links = allLinks.map((l) =>
      this.linkRepo.create({
        initiativeId: initiative!.id,
        linkType: l.linkType,
        url: l.url,
        label: l.linkType === LinkType.OTHER ? 'Congreso.es' : null,
      }),
    );
    await this.linkRepo.save(links);

    return isNew;
  }
}
