/**
 * Estructura de un registro crudo tal como lo devuelve el open data del Congreso de los Diputados.
 * Los nombres de campo están en mayúsculas y en castellano porque provienen directamente del JSON
 * público de congreso.es sin transformación previa.
 */
export interface CongresoRawRecord {
  LEGISLATURA: string;
  SUPERTIPO: string;
  AGRUPACION: string;
  TIPO: string;
  OBJETO: string;
  NUMEXPEDIENTE: string;
  FECHAPRESENTACION: string;
  FECHACALIFICACION?: string;
  AUTOR: string;
  TIPOTRAMITACION: string;
  RESULTADOTRAMITACION?: string;
  SITUACIONACTUAL: string;
  COMISIONCOMPETENTE?: string;
  PLAZOS?: string;
  TRAMITACIONSEGUIDA?: string;
  ENLACESBOCG?: string;
  ENLACESDS?: string;
  PONENTES?: string;
  INICIATIVASRELACIONADAS?: string;
  INICIATIVASDEORIGEN?: string;
}
