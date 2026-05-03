import { Injectable, Logger } from '@nestjs/common';
import type { CongresoRawRecord } from './congreso.types.js';

/**
 * Servicio de acceso al open data del Congreso de los Diputados.
 * Descubre dinámicamente las URLs de los ficheros JSON desde la página de índice
 * para adaptarse automáticamente a los cambios de nombre de fichero entre legislaturas.
 * Obtiene los dos conjuntos de datos (Proyectos de Ley y Proposiciones de Ley)
 * en paralelo para reducir el tiempo de descarga.
 */
@Injectable()
export class CongresoService {
  private readonly logger = new Logger(CongresoService.name);
  private readonly BASE_URL = 'https://www.congreso.es';
  private readonly INDEX_URL = `${this.BASE_URL}/es/opendata/iniciativas`;

  async discoverJsonUrls(): Promise<{
    proyectos: string;
    proposiciones: string;
  } | null> {
    try {
      const res = await fetch(this.INDEX_URL, {
        headers: {
          'User-Agent': 'IDemos-ETL/1.0 (TFG open-data research)',
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        this.logger.warn(`Index page responded ${res.status}`);
        return null;
      }

      const html = await res.text();

      const proyectosMatch = html.match(
        /webpublica\/opendata\/iniciativas\/(ProyectosDeLey__\d+\.json)/,
      );
      const proposMatch = html.match(
        /webpublica\/opendata\/iniciativas\/(ProposicionesDeLey__\d+\.json)/,
      );

      if (!proyectosMatch || !proposMatch) {
        this.logger.warn('Could not find JSON URLs in index page');
        return null;
      }

      return {
        proyectos: `${this.BASE_URL}/webpublica/opendata/iniciativas/${proyectosMatch[1]}`,
        proposiciones: `${this.BASE_URL}/webpublica/opendata/iniciativas/${proposMatch[1]}`,
      };
    } catch (err: unknown) {
      this.logger.error(`Error discovering URLs: ${(err as Error).message}`);
      return null;
    }
  }

  async fetchDataset(url: string): Promise<CongresoRawRecord[]> {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'IDemos-ETL/1.0 (TFG open-data research)',
      },
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
    }

    const data = (await res.json()) as CongresoRawRecord[];
    return Array.isArray(data) ? data : [];
  }

  async fetchAll(): Promise<CongresoRawRecord[]> {
    const urls = await this.discoverJsonUrls();
    if (!urls) {
      this.logger.error('Aborting: could not discover dataset URLs');
      return [];
    }

    this.logger.log(`Fetching ProyectosDeLey from ${urls.proyectos}`);
    this.logger.log(`Fetching ProposicionesDeLey from ${urls.proposiciones}`);

    const [proyectos, proposiciones] = await Promise.all([
      this.fetchDataset(urls.proyectos),
      this.fetchDataset(urls.proposiciones),
    ]);

    this.logger.log(
      `Fetched ${proyectos.length} proyectos + ${proposiciones.length} proposiciones`,
    );

    return [...proyectos, ...proposiciones];
  }
}
