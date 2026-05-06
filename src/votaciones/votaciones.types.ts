/**
 * Resultado de voto oficial de una iniciativa parlamentaria (121/122)
 * extraído del open data de votaciones del Congreso de los Diputados.
 * Se parsea del HTML de la página de votaciones y refleja el último
 * voto registrado para la iniciativa en sesión plenaria.
 */
export interface VotacionResult {
  /** Número de expediente de la iniciativa (p. ej. "121/000005") */
  expediente: string;
  /** Votos a favor */
  afavor: number;
  /** Votos en contra */
  enContra: number;
  /** Abstenciones */
  abstenciones: number;
  /** Fecha de la sesión plenaria (YYYYMMDD → Date UTC) */
  fecha: Date;
}
