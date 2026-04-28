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
