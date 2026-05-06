import { Injectable, Logger } from '@nestjs/common';
import type { VotacionResult } from './votaciones.types.js';

/**
 * Servicio que extrae los resultados oficiales de votaciones plenarias del
 * Congreso de los Diputados desde el open data de votaciones de congreso.es.
 *
 * El portal publica los datos de cada sesión en una página HTML cuya URL incluye
 * la fecha en formato dd/mm/yyyy. La página embebe:
 *  - El número de expediente de cada iniciativa (campo `_iniciativas_id=`).
 *  - Los totales de voto (Si / No / Abstenciones) en párrafos `<p>Si: X</p>`.
 *
 * Solo se extraen iniciativas de tipo 121 (Proyectos de Ley) y 122 (Proposiciones
 * de Ley), que son los tipos que iDemos rastrea. Para iniciativas con múltiples
 * votaciones en la misma sesión (p. ej. enmiendas + texto final) se conserva la
 * ÚLTIMA, que corresponde al voto definitivo del día.
 * Cuando una misma iniciativa aparece en varias sesiones se mantiene la más reciente.
 */
@Injectable()
export class VotacionesService {
  private readonly logger = new Logger(VotacionesService.name);

  private readonly BASE_URL = 'https://www.congreso.es';
  private readonly INDEX_URL = `${this.BASE_URL}/es/opendata/votaciones`;

  /** Patrón para filtrar solo los tipos que gestionamos (ProyectosDeLey / ProposicionesLey) */
  private readonly TRACKED_TYPES = /^12[12]\//;

  /**
   * Obtiene la lista de todos los días con votaciones plenarias para la legislatura
   * indicada. El array `diasVotaciones` está embebido en el JavaScript de la página
   * de índice en formato YYYYMMDD como enteros.
   */
  async discoverVotingDates(): Promise<Date[]> {
    try {
      const res = await fetch(this.INDEX_URL, {
        headers: {
          'User-Agent': 'IDemos-ETL/1.0 (TFG open-data research)',
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(20_000),
      });

      if (!res.ok) {
        this.logger.warn(
          `Votaciones index responded ${res.status} — skipping vote sync`,
        );
        return [];
      }

      const html = await res.text();

      const match = html.match(/var diasVotaciones\s*=\s*\[([^\]]+)\]/);
      if (!match) {
        this.logger.warn('Could not find diasVotaciones in page JS');
        return [];
      }

      // The diasVotaciones array on the page is already scoped to the
      // currently displayed legislature, so no year filtering is needed.
      const raw = match[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      return raw
        .map((s) => {
          const str = s.trim();
          const year = parseInt(str.substring(0, 4), 10);
          const month = parseInt(str.substring(4, 6), 10) - 1;
          const day = parseInt(str.substring(6, 8), 10);
          return new Date(Date.UTC(year, month, day));
        })
        .sort((a, b) => a.getTime() - b.getTime());
    } catch (err: unknown) {
      this.logger.error(
        `Error discovering voting dates: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Descarga y parsea la página HTML de votaciones para un día concreto y
   * devuelve un array con los resultados de voto de las iniciativas 121/122.
   * Si hay múltiples votaciones para la misma iniciativa en la sesión (p. ej.
   * enmiendas + texto) se devuelve solo la última (la más definitiva del día).
   */
  async fetchVotesForDate(
    date: Date,
    legRoman: string,
  ): Promise<VotacionResult[]> {
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = date.getUTCFullYear();
    const targetDate = `${dd}/${mm}/${yyyy}`;

    const url =
      `${this.INDEX_URL}?p_p_id=votaciones&p_p_lifecycle=0` +
      `&p_p_state=normal&p_p_mode=view` +
      `&targetLegislatura=${encodeURIComponent(legRoman)}` +
      `&targetDate=${encodeURIComponent(targetDate)}`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'IDemos-ETL/1.0 (TFG open-data research)',
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        this.logger.warn(`Session page ${targetDate} responded ${res.status}`);
        return [];
      }

      const html = await res.text();
      return this.parseSessionHtml(html, date);
    } catch (err: unknown) {
      this.logger.warn(
        `Error fetching votes for ${targetDate}: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Obtiene todos los resultados de voto para las iniciativas 121/122 de una
   * legislatura completa, iterando cada día con votaciones.
   * Cuando una misma iniciativa aparece en múltiples sesiones se conserva la
   * entrada más reciente (fecha más tardía).
   */
  async fetchAllVotes(legNumber: number): Promise<VotacionResult[]> {
    const legRoman = this.toRoman(legNumber);
    const dates = await this.discoverVotingDates();

    if (dates.length === 0) {
      this.logger.warn('No voting dates found — skipping vote results sync');
      return [];
    }

    this.logger.log(
      `Processing ${dates.length} voting session dates for legislature ${legRoman}…`,
    );

    // Map: expediente → most recent result
    const resultMap = new Map<string, VotacionResult>();

    for (const date of dates) {
      const dayResults = await this.fetchVotesForDate(date, legRoman);
      for (const r of dayResults) {
        const existing = resultMap.get(r.expediente);
        if (!existing || r.fecha.getTime() > existing.fecha.getTime()) {
          resultMap.set(r.expediente, r);
        }
      }
    }

    const all = Array.from(resultMap.values());
    this.logger.log(
      `Vote sync complete — found results for ${all.length} initiatives`,
    );
    return all;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Parsea el HTML de una página de sesión de votaciones y extrae los resultados
   * oficiales para las iniciativas de tipo 121 y 122.
   *
   * Estrategia:
   *  1. Divide el HTML en bloques usando el patrón del enlace de expediente
   *     (`_iniciativas_id=`).
   *  2. Para cada bloque que corresponda a un expediente 121/xxx o 122/xxx,
   *     extrae todos los tripletes (Si, No, Abstenciones).
   *  3. Se queda con el ÚLTIMO triplete del bloque (voto más definitivo del día).
   */
  private parseSessionHtml(html: string, date: Date): VotacionResult[] {
    const results: VotacionResult[] = [];

    // Split by the initiative link anchor pattern.
    // Each segment starts right before "_iniciativas_id=XXX/XXXXXX"
    const segments = html.split(/(?=_iniciativas_id=)/);

    for (const segment of segments) {
      const expMatch = segment.match(/^_iniciativas_id=([\d]+\/[\d]+)/);
      if (!expMatch) continue;

      const expediente = expMatch[1];
      if (!this.TRACKED_TYPES.test(expediente)) continue;

      // Find all (Si, No, Abstenciones) triples in this block.
      // They always appear together as three consecutive <p> tags.
      const siMatches = [...segment.matchAll(/<p>\s*Si:\s*(\d+)\s*<\/p>/gi)];
      const noMatches = [...segment.matchAll(/<p>\s*No:\s*(\d+)\s*<\/p>/gi)];
      const abstMatches = [
        ...segment.matchAll(/<p>\s*Abstenciones:\s*(\d+)\s*<\/p>/gi),
      ];

      // We need at least one complete triple; take the LAST occurrence.
      const count = Math.min(
        siMatches.length,
        noMatches.length,
        abstMatches.length,
      );
      if (count === 0) continue;

      const lastIdx = count - 1;
      results.push({
        expediente,
        afavor: parseInt(
          siMatches[lastIdx].groups?.[1] ?? siMatches[lastIdx][1],
          10,
        ),
        enContra: parseInt(
          noMatches[lastIdx].groups?.[1] ?? noMatches[lastIdx][1],
          10,
        ),
        abstenciones: parseInt(
          abstMatches[lastIdx].groups?.[1] ?? abstMatches[lastIdx][1],
          10,
        ),
        fecha: date,
      });
    }

    return results;
  }

  /**
   * Convierte un número de legislatura a numeración romana.
   * Necesario para construir el parámetro `targetLegislatura` de la URL.
   */
  private toRoman(n: number): string {
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
}
