import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsOptional, IsString, Length, Matches, Min,
  ValidateNested,
} from 'class-validator';
import { AppError } from '../../../common/errors/app-error';

export type TripType = 'oneway' | 'roundtrip' | 'multicity';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Uma ponta da viagem — `departure` ou `arrival`.
 *
 * 🔴 A data mora na PONTA, não numa lista de trechos: em ida-e-volta o destino
 * da ida é a origem da volta, e o modelo diz isso publicando `arrival.date`. Uma
 * lista de pernas conseguiria descrever a mesma viagem, mas deixaria o tipo ser
 * inferido pela contagem — e o contrato exige `type` explícito justamente para
 * ninguém adivinhar ida-e-volta a partir de duas datas.
 */
export class EndpointDto {
  @ApiProperty({ example: 'GRU', description: 'Aeroporto, sempre IATA de três letras.' })
  @IsString()
  @Length(3, 3)
  iata!: string;

  @ApiPropertyOptional({ example: '2026-10-15', description: 'Data local, YYYY-MM-DD. Obrigatória na ida; na volta, define o roundtrip.' })
  @IsOptional()
  @IsString()
  @Matches(DATE, { message: 'date deve estar no formato YYYY-MM-DD' })
  date?: string;
}

/** Um origin-destination do multidestino. A lista é COMPLETA — nunca reduzida a ida/volta. */
export class SegmentDto {
  @ApiProperty({ example: 'GRU' })
  @IsString()
  @Length(3, 3)
  origin!: string;

  @ApiProperty({ example: 'SCL' })
  @IsString()
  @Length(3, 3)
  destination!: string;

  @ApiProperty({ example: '2026-10-15' })
  @IsString()
  @Matches(DATE, { message: 'date deve estar no formato YYYY-MM-DD' })
  date!: string;
}

export class PassengersDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  adults!: number;

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  children?: number;

  /** Bebês de colo. O modelo canônico chama `infants` — é o vocabulário da NDC. */
  @ApiPropertyOptional({ example: 0, minimum: 0, description: 'Bebês de colo (INF).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  infants?: number;
}

export class AvailabilityOptionsDto {
  @ApiPropertyOptional({ example: ['latam'], description: 'Quais provedores consultar. Ausente = todos no ar.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  provider?: string[];

  @ApiPropertyOptional({ enum: ['pt-br', 'en-us', 'es-es'], description: 'Idioma dos campos que NÓS traduzimos.' })
  @IsOptional()
  @IsIn(['pt-br', 'en-us', 'es-es'])
  language?: string;

  @ApiPropertyOptional({ example: 'BR', description: 'País da posição de venda (POS). Não é credencial.' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  @ApiPropertyOptional({ description: 'Filtra por ofertas reembolsáveis.' })
  @IsOptional()
  @IsBoolean()
  refundable?: boolean;

  @ApiPropertyOptional({ enum: ['economy', 'premium_economy', 'business', 'first'] })
  @IsOptional()
  @IsIn(['economy', 'premium_economy', 'business', 'first'])
  class?: string;
}

export class AvailabilityDto {
  @ApiProperty({ enum: ['oneway', 'roundtrip', 'multicity'], description: 'Explícito: nunca inferido pelas datas.' })
  @IsIn(['oneway', 'roundtrip', 'multicity'])
  type!: TripType;

  @ApiPropertyOptional({ type: EndpointDto, description: 'Origem e data da ida. Obrigatório em oneway e roundtrip.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => EndpointDto)
  departure?: EndpointDto;

  @ApiPropertyOptional({ type: EndpointDto, description: 'Destino da ida; `date` é a volta no roundtrip.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => EndpointDto)
  arrival?: EndpointDto;

  @ApiPropertyOptional({ type: [SegmentDto], description: 'Só no multidestino: a lista COMPLETA de trechos.' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => SegmentDto)
  segments?: SegmentDto[];

  @ApiProperty({ type: PassengersDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PassengersDto)
  passengers!: PassengersDto;

  @ApiPropertyOptional({ type: AvailabilityOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AvailabilityOptionsDto)
  options?: AvailabilityOptionsDto;
}

/** A forma que os provedores consomem: origem, destino e data, na ordem da viagem. */
export interface TripLeg {
  origin: string;
  destination: string;
  date: string;
}

const invalid = (field: string, message: string): AppError =>
  new AppError('SEARCH_VALIDATION_ERROR', {
    metadata: { operation: 'availability' },
    details: { errors: { [field]: [message] } },
  });

/**
 * Traduz o pedido canônico nos trechos que o provedor entende.
 *
 * 🔴 A coerência entre `type` e o resto do corpo é checada AQUI, num lugar só.
 * O `class-validator` não expressa "este campo é obrigatório conforme o valor
 * daquele outro" sem um decorator por combinação, e espalhar a regra por três
 * DTOs faria cada rota descobrir a inconsistência de um jeito diferente —
 * algumas com 400, outras com um trecho silenciosamente ignorado.
 */
export function legsOf(request: AvailabilityDto): TripLeg[] {
  if (request.type === 'multicity') {
    if (!request.segments || request.segments.length < 2) {
      throw invalid('segments', 'O multidestino exige a lista completa de trechos, com ao menos dois.');
    }
    return request.segments.map((segment) => ({
      origin: segment.origin,
      destination: segment.destination,
      date: segment.date,
    }));
  }

  const { departure, arrival } = request;
  if (!departure?.iata || !departure.date) {
    throw invalid('departure', 'Obrigatório: aeroporto e data da ida.');
  }
  if (!arrival?.iata) {
    throw invalid('arrival', 'Obrigatório: aeroporto de destino.');
  }

  const outward: TripLeg = {
    origin: departure.iata,
    destination: arrival.iata,
    date: departure.date,
  };

  if (request.type === 'oneway') return [outward];

  if (!arrival.date) {
    throw invalid('arrival.date', 'A ida-e-volta exige a data da volta.');
  }

  // A volta é o espelho da ida: destino vira origem. O modelo publica uma ponta
  // só justamente porque a companhia não vende as duas pernas separadas.
  return [outward, { origin: arrival.iata, destination: departure.iata, date: arrival.date }];
}

/** Contagem canônica de passageiros, com os opcionais resolvidos. */
export const passengersOf = (request: AvailabilityDto) => ({
  adults: request.passengers.adults,
  children: request.passengers.children ?? 0,
  infants: request.passengers.infants ?? 0,
});
