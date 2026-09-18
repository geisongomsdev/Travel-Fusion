import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Allow, ArrayMinSize, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString,
  Matches, ValidateNested,
} from 'class-validator';
import { PassengersDto, TripType } from './availability.dto';

/**
 * Os pedidos das rotas, no vocabulário canônico dos `models/`.
 *
 * 🔴 Cada rota que MUTA carrega um bloco com o nome da operação — `cancel`,
 * `issue`, `sellAncillaries`, `markSeats`. Não é enfeite: é o que deixa o corpo
 * dizer qual operação ele descreve, em vez de depender da URL. Um `{booking:
 * {locator}}` solto serve para cancelar, emitir e consultar, e um cliente que
 * erra a rota manda um corpo que o servidor aceita sem reclamar.
 *
 * As rotas de LEITURA (`/retrieve`, `/financing-options`) ficam sem o bloco,
 * como no modelo: ali o corpo não descreve uma intenção, só um endereço.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Qual provedor atende. Ausente = o padrão da instância. */
export class ProviderOptionsDto {
  @ApiPropertyOptional({ example: 'latam' })
  @IsOptional()
  @IsString()
  provider?: string;
}

/**
 * 🔴 Bloco deliberadamente TOLERANTE: campo desconhecido aqui é ignorado, não
 * recusado, porque cada companhia pede um conjunto diferente e quem consome
 * manda o superconjunto.
 */
export class BookingAddressDto {
  @ApiProperty({ example: 'LA-EXAMPLE-ORDER', description: 'O localizador. Todo provedor usa.' })
  @IsString()
  locator!: string;

  @ApiPropertyOptional({ description: 'Quando a companhia endereça a reserva por token.' })
  @IsOptional()
  @IsString()
  bookingToken?: string;

  @ApiPropertyOptional({ description: 'Identificador de pedido, quando a companhia usa um além do localizador.' })
  @IsOptional()
  @IsString()
  orderIdentifier?: string;

  @ApiPropertyOptional({ description: 'Fonte/sistema da reserva.' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ description: 'Sobrenome do passageiro principal, onde a companhia exige.' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ enum: ['pt-br', 'en-us', 'es-es'], description: 'Idioma de rótulos localizados.' })
  @IsOptional()
  @IsIn(['pt-br', 'en-us', 'es-es'])
  language?: string;
}

// ── Tarifar ───────────────────────────────────────────────────────────────────

/** Terceira forma aceita de identificar a tarifa: `offers[].fare.fareId`. */
export class QuoteFareRefDto {
  @ApiPropertyOptional({ description: 'O `fares[].fareId` da busca.' })
  @IsOptional()
  @IsString()
  fareId?: string;
}

/**
 * Uma oferta escolhida na busca — 05-quote.md §2.2.
 *
 * O contrato aceita três identificadores (`journeyKey`, `fareId`,
 * `fare.fareId`) e exige ao menos um. Na LATAM quem decide a venda é a TARIFA:
 * o `journeyKey` sozinho não abre a oferta, e sem `fareId` a resposta é 400.
 *
 * 🔴 Os outros campos são contexto de auditoria e NÃO substituem a chave:
 * remontar a seleção a partir de `fareCode` + `bookingClass` é o caminho
 * clássico para tarifar uma família diferente da que foi exibida.
 */
export class QuoteOfferDto {
  @ApiPropertyOptional({ description: 'O `identifier` do trecho, vindo da busca. Opaco.' })
  @IsOptional()
  @IsString()
  journeyKey?: string;

  @ApiPropertyOptional({ description: 'O `fares[].fareId` da busca. Opaco — devolva intacto.' })
  @IsOptional()
  @IsString()
  fareId?: string;

  @ApiPropertyOptional({ type: QuoteFareRefDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuoteFareRefDto)
  fare?: QuoteFareRefDto;

  @ApiPropertyOptional({ example: 'Q00QP5ZI', description: 'Base tarifária.' })
  @IsOptional()
  @IsString()
  fareCode?: string;

  @ApiPropertyOptional({ example: 'Q', description: 'Classe de reserva (RBD).' })
  @IsOptional()
  @IsString()
  bookingClass?: string;

  @ApiPropertyOptional({ example: 'RY' })
  @IsOptional()
  @IsString()
  familyCode?: string;

  @ApiPropertyOptional({ example: ['8000'], description: 'Números de voo, na ordem dos trechos.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  flightNumbers?: string[];

  @ApiPropertyOptional({ description: 'Forma singular, legada.' })
  @IsOptional()
  @IsString()
  flightNumber?: string;
}

/**
 * O bloco `quote`. Pré-reserva (`offers[]`) OU pós-reserva (`booking`) —
 * 05-quote.md §2 e §3.
 */
export class QuoteBlockDto {
  @ApiPropertyOptional({
    enum: ['oneway', 'roundtrip', 'multicity'],
    description: 'Tipo de viagem da oferta. Mande sempre: sem ele o tipo seria adivinhado pela contagem.',
  })
  @IsOptional()
  @IsIn(['oneway', 'roundtrip', 'multicity'])
  type?: TripType;

  @ApiPropertyOptional({
    type: [QuoteOfferDto],
    description: 'Um item por trecho ou direção, na ordem. Num pacote, cada item carrega o fareId da tarifa única.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteOfferDto)
  offers?: QuoteOfferDto[];

  @ApiPropertyOptional({ type: PassengersDto, description: 'Obrigatório no cenário pré-reserva: sem ele não há default.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PassengersDto)
  passengers?: PassengersDto;

  @ApiPropertyOptional({ description: 'Opções repassadas ao provedor. Objeto livre.', example: { currency: 'BRL' } })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;

  @ApiPropertyOptional({ type: () => BookingAddressDto, description: 'Cenário pós-reserva: o endereço da reserva.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BookingAddressDto)
  booking?: BookingAddressDto;
}

export class QuoteDto {
  @ApiPropertyOptional({ example: 'latam', description: 'Provedor da oferta. A chave da oferta confirma.' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ description: 'Opções de runtime. Pode vir vazio.', example: {} })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;

  @ApiProperty({ type: QuoteBlockDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => QuoteBlockDto)
  quote!: QuoteBlockDto;
}

// ── Reservar ──────────────────────────────────────────────────────────────────

/** `Document` — 01-convencoes.md §6. */
export class PassengerDocumentDto {
  @ApiProperty({ enum: ['CPF', 'PASSPORT', 'RG', 'RNE', 'RNM', 'MERCOSUR'], example: 'PASSPORT' })
  @IsIn(['CPF', 'PASSPORT', 'RG', 'RNE', 'RNM', 'MERCOSUR'])
  type!: string;

  @ApiProperty({ example: 'AAB0302', description: 'Só dígitos, quando for CPF.' })
  @IsString()
  number!: string;

  @ApiPropertyOptional({ example: 'BR' })
  @IsOptional()
  @IsString()
  nationality?: string;

  @ApiPropertyOptional({ example: 'BR' })
  @IsOptional()
  @IsString()
  issuingCountry?: string;

  @ApiPropertyOptional({ example: '2030-01-01' })
  @IsOptional()
  @IsString()
  @Matches(DATE, { message: 'expiryDate deve ser YYYY-MM-DD' })
  expiryDate?: string;

  @ApiPropertyOptional({ example: '2020-01-01' })
  @IsOptional()
  @IsString()
  @Matches(DATE, { message: 'issueDate deve ser YYYY-MM-DD' })
  issueDate?: string;
}

/** `ContactPhone` — 01-convencoes.md §6. */
export class ContactPhoneDto {
  @ApiPropertyOptional({ example: '55' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: '11' })
  @IsOptional()
  @IsString()
  area?: string;

  @ApiProperty({ example: '988887777', description: 'Sem DDI/DDD separados, o número inteiro vai aqui.' })
  @IsString()
  number!: string;

  @ApiPropertyOptional({ example: 'mobile' })
  @IsOptional()
  @IsString()
  type?: string;
}

/**
 * Um viajante — 06-booking.md §2.3.
 *
 * 🔴 `identifier` não é decorativo: é por ele que as rotas de assento e de
 * extra endereçam o passageiro depois, e na LATAM ele é o PaxID com que a
 * oferta foi tarifada (`ADT_1`, `CHD_1`, `INF_1`). Renumerar produz
 * `PaxIDKeyRef` não encontrada.
 */
export class BookingPersonDto {
  @ApiProperty({ example: 'ADT_1', description: 'Identificador do passageiro nesta reserva.' })
  @IsString()
  identifier!: string;

  @ApiPropertyOptional({ description: '`true` no passageiro principal.' })
  @IsOptional()
  @IsBoolean()
  main?: boolean;

  @ApiPropertyOptional({ example: 'Mr' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ example: 'ANA' })
  @IsString()
  firstName!: string;

  @ApiProperty({ example: 'EXAMPLE' })
  @IsString()
  lastName!: string;

  @ApiPropertyOptional({ enum: ['adult', 'senior', 'child', 'infant'], description: 'Um de `ageGroup` ou `type` é obrigatório.' })
  @IsOptional()
  @IsIn(['adult', 'senior', 'child', 'infant'])
  ageGroup?: string;

  @ApiPropertyOptional({ enum: ['adult', 'senior', 'child', 'infant'] })
  @IsOptional()
  @IsIn(['adult', 'senior', 'child', 'infant'])
  type?: string;

  @ApiPropertyOptional({ enum: ['male', 'female'] })
  @IsOptional()
  @IsIn(['male', 'female'])
  gender?: string;

  @ApiPropertyOptional({ example: '1990-01-01', description: 'YYYY-MM-DD. A LATAM exige.' })
  @IsOptional()
  @IsString()
  @Matches(DATE, { message: 'birthdate deve ser YYYY-MM-DD' })
  birthdate?: string;

  @ApiPropertyOptional({ description: 'Grafia alternativa de `birthdate`, também aceita.' })
  @IsOptional()
  @IsString()
  @Matches(DATE, { message: 'birthDate deve ser YYYY-MM-DD' })
  birthDate?: string;

  @ApiPropertyOptional({ type: PassengerDocumentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PassengerDocumentDto)
  document?: PassengerDocumentDto;

  @ApiPropertyOptional({ example: 'buyer@example.test' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ type: ContactPhoneDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContactPhoneDto)
  phone?: ContactPhoneDto;

  @ApiPropertyOptional({ example: 'BR' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: 'BR' })
  @IsOptional()
  @IsString()
  nationality?: string;

  @ApiPropertyOptional({ description: 'Mapa `{ IATA da companhia dona do programa: número }`.', example: { LA: '123456' } })
  @IsOptional()
  @IsObject()
  loyalty?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Bebê de colo viajando com este adulto.' })
  @IsOptional()
  @IsObject()
  infantInfo?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Extensão declarada: parâmetros que o provedor exigiu no /quote (requiredParameters), por passageiro.',
    example: { OutwardLuggageOptions: '2' },
  })
  @IsOptional()
  @IsObject()
  customParameters?: Record<string, string>;
}

/** O comprador — 06-booking.md §2.2. */
export class CustomerDto {
  @ApiProperty({ example: 'buyer@example.test', description: 'Contato da reserva. A LATAM recusa a ordem sem contato.' })
  @IsString()
  email!: string;

  @ApiPropertyOptional({ example: 'Ana' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Example' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ example: 'Ana Example' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: ContactPhoneDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContactPhoneDto)
  phone?: ContactPhoneDto;

  @ApiPropertyOptional({ type: PassengerDocumentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PassengerDocumentDto)
  document?: PassengerDocumentDto;

  @ApiPropertyOptional({ description: '`{street, city, state, zipCode, postal, country}`.' })
  @IsOptional()
  @IsObject()
  address?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'BR' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: '1990-01-01' })
  @IsOptional()
  @IsString()
  @Matches(DATE, { message: 'birthdate deve ser YYYY-MM-DD' })
  birthdate?: string;

  @ApiPropertyOptional({ description: 'Grafia alternativa de `birthdate`.' })
  @IsOptional()
  @IsString()
  @Matches(DATE, { message: 'birthDate deve ser YYYY-MM-DD' })
  birthDate?: string;

  @ApiPropertyOptional({ enum: ['male', 'female'] })
  @IsOptional()
  @IsIn(['male', 'female'])
  gender?: string;
}

/**
 * Um trecho, COPIADO DA BUSCA — 06-booking.md §2.5.
 *
 * Só `identifier` e `fares[]` são lidos; o resto viaja como veio. O shape
 * inteiro é o do `/availability`, e não é revalidado aqui para não recusar um
 * campo que a própria busca publicou.
 */
export class BookingLegDto {
  @ApiProperty({ description: 'O identificador opaco da busca.' })
  @IsString()
  identifier!: string;

  @ApiPropertyOptional({ description: 'A tarifa DESTE trecho — só no modelo de trecho solto.', type: 'array' })
  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  fares?: Array<Record<string, unknown>>;

  // O resto do trecho, como a busca publicou. Declarado para o `whitelist` não
  // apagar: é daqui que sai a data de referência da idade.
  @ApiPropertyOptional({ description: '`{code, name}`.' })
  @IsOptional()
  @IsObject()
  company?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '`Airport`.' })
  @IsOptional()
  @IsObject()
  origin?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '`Airport`.' })
  @IsOptional()
  @IsObject()
  destination?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '`FlightTime`.' })
  @IsOptional()
  @IsObject()
  time?: { departure?: string | null; arrival?: string | null; duration?: number };

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  stops?: number;

  @ApiPropertyOptional({ description: 'Os segmentos, como vieram da busca.', type: 'array' })
  @IsOptional()
  @IsArray()
  flights?: unknown[];

  @ApiPropertyOptional({ type: 'array' })
  @IsOptional()
  @IsArray()
  fees?: unknown[];
}

export class BookingSegmentsDto {
  @ApiPropertyOptional({ type: [BookingLegDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingLegDto)
  departure?: BookingLegDto[];

  @ApiPropertyOptional({ type: [BookingLegDto], description: 'Ausente ou vazio em `oneway`.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingLegDto)
  return?: BookingLegDto[];
}

export class BookingItineraryDto {
  @ApiProperty({ type: [BookingLegDto], description: 'Um item por trecho, na ordem. A posição é o trecho.' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingLegDto)
  legs!: BookingLegDto[];

  @ApiPropertyOptional({ description: 'Alternativa à raiz para a tarifa de pacote no multidestino.', type: 'array' })
  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  fares?: Array<Record<string, unknown>>;
}

export class BookingRequestOptionsDto {
  @ApiPropertyOptional({ enum: ['BRL', 'USD', 'EUR'] })
  @IsOptional()
  @IsIn(['BRL', 'USD', 'EUR'])
  currency?: string;

  @ApiPropertyOptional({ enum: ['pt-br', 'en-us', 'es-es'] })
  @IsOptional()
  @IsIn(['pt-br', 'en-us', 'es-es'])
  language?: string;

  @ApiPropertyOptional({
    description: 'Extensão declarada: parâmetros do nível da RESERVA exigidos no /quote (perPassenger=false).',
    example: { LuggageOptions: '1' },
  })
  @IsOptional()
  @IsObject()
  customParameters?: Record<string, string>;
}

/**
 * Reservar — 06-booking.md.
 *
 * Os trechos e a tarifa vêm da busca, copiados como vieram. Quem decide a venda
 * é o `fareId` da tarifa escolhida (`selectedFareId`, ou o de `fares[]`): é a
 * chave opaca que abre a oferta na companhia.
 */
export class CreateBookingDto {
  @ApiPropertyOptional({ example: 'latam', description: 'A companhia desta reserva. A chave da tarifa confirma.' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiProperty({ enum: ['oneway', 'roundtrip', 'multicity'], description: 'Define qual validação se aplica.' })
  @IsIn(['oneway', 'roundtrip', 'multicity'])
  trip!: TripType;

  @ApiProperty({ type: CustomerDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CustomerDto)
  customer!: CustomerDto;

  @ApiProperty({ type: [BookingPersonDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BookingPersonDto)
  people!: BookingPersonDto[];

  @ApiPropertyOptional({ type: BookingSegmentsDto, description: 'Obrigatório em `oneway`/`roundtrip`.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BookingSegmentsDto)
  segments?: BookingSegmentsDto;

  @ApiPropertyOptional({ type: BookingItineraryDto, description: 'Obrigatório em `multicity`.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BookingItineraryDto)
  itinerary?: BookingItineraryDto;

  @ApiPropertyOptional({ description: 'A tarifa escolhida, na RAIZ (pacote). Posicional — 06-booking.md §3.', type: 'array' })
  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  fares?: Array<Record<string, unknown>>;

  @ApiPropertyOptional({ description: 'Qual tarifa de `fares[]` foi escolhida. Tem que existir na lista.' })
  @IsOptional()
  @IsString()
  selectedFareId?: string;

  @ApiPropertyOptional({ example: 625.0, description: 'O total exibido ao cliente. Âncora do gate de re-tarifa.' })
  @IsOptional()
  @IsNumber()
  displayedTotal?: number;

  @ApiPropertyOptional({ description: 'Extras a pendurar junto com a reserva.', type: 'array' })
  @IsOptional()
  @IsArray()
  ancillaries?: unknown[];

  @ApiPropertyOptional({ description: 'Pagamento, quando a companhia o exige já na criação.' })
  @IsOptional()
  @IsObject()
  payment?: Record<string, unknown>;

  @ApiPropertyOptional({ type: BookingRequestOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BookingRequestOptionsDto)
  options?: BookingRequestOptionsDto;
}

// ── Consultar ─────────────────────────────────────────────────────────────────

export class RetrieveDto {
  @ApiPropertyOptional({ type: ProviderOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProviderOptionsDto)
  options?: ProviderOptionsDto;

  @ApiProperty({ type: BookingAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => BookingAddressDto)
  booking!: BookingAddressDto;
}

// ── Cancelar a reserva ────────────────────────────────────────────────────────

export class CancelOptionsDto {
  @ApiPropertyOptional({ description: 'Campo do contrato genérico; a LATAM não particiona a order por ele.' })
  @IsOptional()
  @IsBoolean()
  etickets?: boolean;

  @ApiPropertyOptional({ example: 'Cliente solicitou cancelamento' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ enum: ['Refund', 'OrderCreditShell', 'Voucher', 'None'], description: 'Não é preço da plataforma.' })
  @IsOptional()
  @IsIn(['Refund', 'OrderCreditShell', 'Voucher', 'None'])
  refundType?: string;

  @ApiPropertyOptional({ enum: ['None', 'All', 'Email'] })
  @IsOptional()
  @IsIn(['None', 'All', 'Email'])
  notifyContacts?: string;

  @ApiPropertyOptional({ type: [String], description: 'Observações auditáveis.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  comments?: string[];
}

export class CancelBlockDto {
  @ApiProperty({ type: BookingAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => BookingAddressDto)
  booking!: BookingAddressDto;

  @ApiPropertyOptional({ type: CancelOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CancelOptionsDto)
  options?: CancelOptionsDto;
}

export class CancelBookingDto {
  @ApiPropertyOptional({ type: ProviderOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProviderOptionsDto)
  options?: ProviderOptionsDto;

  @ApiProperty({ type: CancelBlockDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CancelBlockDto)
  cancel!: CancelBlockDto;
}

// ── Mapa de assentos e opcionais ──────────────────────────────────────────────

/** Opções da chamada de catálogo. `currency` é preferência da CHAMADA, não da reserva. */
export class CatalogOptionsDto extends ProviderOptionsDto {
  @ApiPropertyOptional({ example: 'BRL', description: 'Moeda desejada dos preços. Padrão BRL.' })
  @IsOptional()
  @IsString()
  currency?: string;
}

/** Filtro por id — `[{id}]` do 09-assentos.md §1.1. */
export class IdRefDto {
  @ApiProperty({ example: 'SEG_1' })
  @IsString()
  id!: string;
}

/**
 * O endereço de um catálogo: a RESERVA (`booking`, o contrato) ou a OFERTA
 * (`fareId`, extensão declarada).
 *
 * 🔴 Por que a extensão existe: na LATAM o mapa e os opcionais também respondem
 * pela oferta, ANTES de o localizador existir — é onde a escolha costuma
 * acontecer. Mas os ids desse catálogo morrem na emissão: só os do catálogo da
 * reserva servem para comprar depois dela.
 */
export class SeatMapBlockDto {
  @ApiPropertyOptional({ type: BookingAddressDto, description: 'O endereço da reserva. `locator` basta na LATAM.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BookingAddressDto)
  booking?: BookingAddressDto;

  @ApiPropertyOptional({ description: 'Extensão declarada: o mapa da OFERTA, antes de reservar. A chave `fares[].fareId` da busca.' })
  @IsOptional()
  @IsString()
  fareId?: string;

  @ApiPropertyOptional({ type: [IdRefDto], description: 'Filtro de trecho. Ausente = todos.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IdRefDto)
  segments?: IdRefDto[];

  @ApiPropertyOptional({ type: [IdRefDto], description: 'Filtro de passageiro. Ausente = todos.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IdRefDto)
  passengers?: IdRefDto[];
}

export class SeatMapDto {
  @ApiPropertyOptional({ type: CatalogOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CatalogOptionsDto)
  options?: CatalogOptionsDto;

  @ApiProperty({ type: SeatMapBlockDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => SeatMapBlockDto)
  seatMap!: SeatMapBlockDto;
}

export const ANCILLARY_TYPES = [
  'baggage', 'seat', 'meal', 'pet-cabin', 'pet-hold', 'unaccompanied-minor', 'vip-lounge', 'upgrade', 'other',
];

export class AncillariesBlockDto {
  @ApiPropertyOptional({ type: BookingAddressDto, description: 'O endereço da reserva.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BookingAddressDto)
  booking?: BookingAddressDto;

  @ApiPropertyOptional({ description: 'Extensão declarada: o catálogo da OFERTA, antes de reservar.' })
  @IsOptional()
  @IsString()
  fareId?: string;

  @ApiPropertyOptional({ enum: ANCILLARY_TYPES, description: 'Filtro ESTRITO: oferta sem tipo declarado sai. Ausente = tudo.' })
  @IsOptional()
  @IsIn(ANCILLARY_TYPES)
  type?: string;

  @ApiPropertyOptional({ type: [String], example: ['ADT_1'], description: 'Ausente = todos os passageiros.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  passengers?: string[];

  @ApiPropertyOptional({ type: [String], example: ['SEG_1'], description: 'Ausente = todos os trechos.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  segments?: string[];
}

export class AncillariesDto {
  @ApiPropertyOptional({ type: CatalogOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CatalogOptionsDto)
  options?: CatalogOptionsDto;

  @ApiProperty({ type: AncillariesBlockDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => AncillariesBlockDto)
  ancillaries!: AncillariesBlockDto;
}

// ── Pagamento ─────────────────────────────────────────────────────────────────

/** Endereço de cobrança do cartão — `creditCard.billingAddress` do 11-emissao.md §3.2. */
export class BillingAddressDto {
  @ApiPropertyOptional({ example: '01310-100' })
  @IsOptional()
  @IsString()
  zipCode?: string;

  @ApiPropertyOptional({ example: 'Av. Paulista, 1000' })
  @IsOptional()
  @IsString()
  street?: string;

  @ApiPropertyOptional({ example: 'São Paulo' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'SP' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: 'BR' })
  @IsOptional()
  @IsString()
  country?: string;
}

/**
 * 🔴 DADO DE CARTÃO. Não é logado, não é guardado e não volta na resposta.
 *
 * O vocabulário é o do contrato — 11-emissao.md §3.2. `expiryDate` é `MM/YYYY`;
 * a conversão para o que a companhia espera é nossa, em `common/utils/card.ts`.
 */
export class CreditCardDto {
  @ApiProperty({ example: 'VI', description: 'Bandeira: sigla IATA (VI, CA, AX…) ou código numérico, como vier do /payment-options.' })
  @IsDefined()
  @IsNotEmpty()
  brand!: string | number;

  @ApiProperty({ example: 'ANA EXAMPLE' })
  @IsString()
  holderName!: string;

  @ApiProperty({ example: '4000000000002701' })
  @IsString()
  @Matches(/^\d{13,19}$/, { message: 'number deve ter de 13 a 19 dígitos' })
  number!: string;

  @ApiProperty({ example: '737' })
  @IsString()
  @Matches(/^\d{3,4}$/, { message: 'cvv deve ter 3 ou 4 dígitos' })
  cvv!: string;

  @ApiProperty({ example: '12/2030', description: 'MM/AAAA.' })
  @IsString()
  @Matches(/^\d{2}\/?\d{2}(\d{2})?$/, { message: 'expiryDate deve ser MM/AAAA' })
  expiryDate!: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  installments?: number;

  @ApiPropertyOptional({ description: 'O `plans[].financingId` do /financing-options.' })
  @IsOptional()
  @Allow()
  financingId?: string | number;

  @ApiPropertyOptional({ example: '52998224725', description: 'CPF do titular. A LATAM exige no Payer.' })
  @IsOptional()
  @IsString()
  holderCpf?: string;

  @ApiPropertyOptional({ example: 'buyer@example.test' })
  @IsOptional()
  @IsString()
  holderEmail?: string;

  @ApiPropertyOptional({ example: '+5511900000000' })
  @IsOptional()
  @IsString()
  holderPhone?: string;

  @ApiPropertyOptional({ example: '1990-01-01', description: 'A LATAM exige no Payer.' })
  @IsOptional()
  @IsString()
  @Matches(DATE, { message: 'holderBirthdate deve ser YYYY-MM-DD' })
  holderBirthdate?: string;

  @ApiPropertyOptional({ type: BillingAddressDto, description: 'Endereço de cobrança. A LATAM exige.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BillingAddressDto)
  billingAddress?: BillingAddressDto;
}

export class IssuePaymentDto {
  @ApiPropertyOptional({ example: 'credit-card', description: 'O `method.code` do /payment-options.' })
  @IsOptional()
  @Allow()
  paymentMethod?: string | number;

  @ApiPropertyOptional({ description: 'O `method.typeCode`.' })
  @IsOptional()
  @Allow()
  paymentMethodType?: string | number;

  /**
   * 🔴 Ausente = a API PERGUNTA o total à companhia antes de cobrar, em vez de
   * confiar num número que veio do cliente. Divergir do saldo vivo é 409, e a
   * cobrança não acontece.
   */
  @ApiPropertyOptional({ example: 505.0, description: 'Valor a cobrar. Âncora: divergir do saldo → 409.' })
  @IsOptional()
  @IsNumber()
  billedAmount?: number;

  @ApiProperty({ type: CreditCardDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CreditCardDto)
  creditCard!: CreditCardDto;
}

export class IssueBlockDto {
  @ApiProperty({ type: BookingAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => BookingAddressDto)
  booking!: BookingAddressDto;

  @ApiPropertyOptional({ description: 'Confirma a emissão mesmo com o preço alterado. Padrão false.' })
  @IsOptional()
  @IsBoolean()
  acceptFareChange?: boolean;

  @ApiProperty({ type: IssuePaymentDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => IssuePaymentDto)
  payment!: IssuePaymentDto;
}

export class IssueDto {
  @ApiPropertyOptional({ type: ProviderOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProviderOptionsDto)
  options?: ProviderOptionsDto;

  @ApiProperty({ type: IssueBlockDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => IssueBlockDto)
  issue!: IssueBlockDto;
}

/** O cartão do /financing-options: a operadora cota pelo número. */
export class FinancingCardDto {
  @ApiPropertyOptional({ description: 'Bandeira, quando a companhia pede.' })
  @IsOptional()
  @Allow()
  brand?: string | number;

  @ApiProperty({ example: '4000000000002701', description: 'Número do cartão. Não é logado nem guardado.' })
  @IsString()
  @Matches(/^\d{6,19}$/, { message: 'number deve ter de 6 a 19 dígitos' })
  number!: string;

  @ApiPropertyOptional({ example: '12/2030' })
  @IsOptional()
  @IsString()
  expiryDate?: string;
}

export class FinancingPaymentDto {
  @ApiPropertyOptional({ description: 'O `method.code` do /payment-options.' })
  @IsOptional()
  @Allow()
  paymentMethod?: string | number;

  @ApiPropertyOptional({ description: 'O `method.typeCode`.' })
  @IsOptional()
  @Allow()
  paymentMethodType?: string | number;

  @ApiProperty({ type: FinancingCardDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => FinancingCardDto)
  creditCard!: FinancingCardDto;
}

export class FinancingBlockDto {
  @ApiProperty({ type: BookingAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => BookingAddressDto)
  booking!: BookingAddressDto;

  @ApiProperty({ type: FinancingPaymentDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => FinancingPaymentDto)
  payment!: FinancingPaymentDto;

  @ApiPropertyOptional({ description: 'Valor a parcelar, quando a companhia não o infere da reserva.' })
  @IsOptional()
  @IsNumber()
  totalAmount?: number;

  @ApiPropertyOptional({ description: 'Para companhias que cotam pela tarifa da busca. A LATAM cota pela reserva.' })
  @IsOptional()
  @IsString()
  rateTokens?: string;
}

export class FinancingOptionsDto {
  @ApiPropertyOptional({ type: CatalogOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CatalogOptionsDto)
  options?: CatalogOptionsDto;

  @ApiProperty({ type: FinancingBlockDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => FinancingBlockDto)
  financingOptions!: FinancingBlockDto;
}

export class PaymentOptionsBlockDto {
  @ApiProperty({ type: BookingAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => BookingAddressDto)
  booking!: BookingAddressDto;

  @ApiPropertyOptional({ description: 'Identificador do cliente no provedor que o suporta.' })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;
}

export class PaymentOptionsDto {
  @ApiPropertyOptional({ type: ProviderOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProviderOptionsDto)
  options?: ProviderOptionsDto;

  @ApiProperty({ type: PaymentOptionsBlockDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PaymentOptionsBlockDto)
  paymentOptions!: PaymentOptionsBlockDto;
}

// ── Vender opcionais na reserva emitida ───────────────────────────────────────

export class SellAncillaryItemDto {
  @ApiProperty({
    example: 'SEAT_086985c24476cd78fc16ee82e01fdd7d',
    description: 'Exatamente o `offers[].key` recebido no catálogo. Devolva intacto.',
  })
  @IsString()
  key!: string;

  @ApiProperty({ example: 'ADT_1', description: 'Exatamente `passengers[].id`.' })
  @IsString()
  passengerId!: string;

  @ApiPropertyOptional({ example: 'SEG_1', description: 'Ausente quando a oferta for da viagem inteira.' })
  @IsOptional()
  @IsString()
  segmentId?: string;

  @ApiPropertyOptional({ example: 'seat' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  count?: number;

  @ApiPropertyOptional({ example: '12', description: 'Fileira. Obrigatória em assento: a LATAM quer a poltrona além do id.' })
  @IsOptional()
  @IsString()
  row?: string;

  @ApiPropertyOptional({ example: 'C', description: 'Coluna. Obrigatória em assento.' })
  @IsOptional()
  @IsString()
  column?: string;
}

export class AncillaryPaymentDto {
  @ApiPropertyOptional({ type: CreditCardDto, description: 'Dispensável só quando os itens somam zero.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreditCardDto)
  creditCard?: CreditCardDto;
}

export class SellAncillariesBlockDto {
  @ApiProperty({ type: BookingAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => BookingAddressDto)
  booking!: BookingAddressDto;

  @ApiProperty({ type: [SellAncillaryItemDto] })
  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SellAncillaryItemDto)
  items!: SellAncillaryItemDto[];

  @ApiPropertyOptional({ type: AncillaryPaymentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AncillaryPaymentDto)
  payment?: AncillaryPaymentDto;
}

export class SellAncillariesDto {
  @ApiPropertyOptional({ type: ProviderOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProviderOptionsDto)
  options?: ProviderOptionsDto;

  @ApiProperty({ type: SellAncillariesBlockDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => SellAncillariesBlockDto)
  sellAncillaries!: SellAncillariesBlockDto;
}

// ── Assentos da reserva emitida ───────────────────────────────────────────────

export class SeatSelectionDto {
  @ApiProperty({ example: 'ADT_1' })
  @IsString()
  passengerId!: string;

  @ApiProperty({ example: 'SEG_1' })
  @IsString()
  segmentId!: string;

  @ApiProperty({ example: '12A', description: 'Designador copiado do mapa — nunca montado por índice.' })
  @IsString()
  seat!: string;
}

export class MarkSeatsOptionsDto {
  @ApiPropertyOptional({ description: 'Não ignorar regras de saída/restrição.' })
  @IsOptional()
  @IsBoolean()
  waiveRestrictedSeat?: boolean;

  @ApiPropertyOptional({ description: 'Não dispensar a cobrança do assento.' })
  @IsOptional()
  @IsBoolean()
  waiveSeatFee?: boolean;
}

export class MarkSeatsPaymentDto {
  @ApiPropertyOptional({ example: 'credit-card', description: 'Forma de pagamento: `string` ou `number`, como o /payment-options a nomeia.' })
  @IsOptional()
  @Allow()
  method?: string | number;

  @ApiPropertyOptional({ example: 79.0, description: 'Valor publicado pelo mapa; nunca markup da aplicação.' })
  @IsOptional()
  amount?: number;

  @ApiPropertyOptional({ example: 'BRL' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ type: CreditCardDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreditCardDto)
  creditCard?: CreditCardDto;
}

export class MarkSeatsBlockDto {
  @ApiProperty({ type: BookingAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => BookingAddressDto)
  booking!: BookingAddressDto;

  @ApiProperty({ type: [SeatSelectionDto] })
  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SeatSelectionDto)
  seats!: SeatSelectionDto[];

  @ApiPropertyOptional({ type: MarkSeatsPaymentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MarkSeatsPaymentDto)
  payment?: MarkSeatsPaymentDto;

  @ApiPropertyOptional({ type: MarkSeatsOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MarkSeatsOptionsDto)
  options?: MarkSeatsOptionsDto;
}

export class MarkSeatsDto {
  @ApiPropertyOptional({ type: ProviderOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProviderOptionsDto)
  options?: ProviderOptionsDto;

  @ApiProperty({ type: MarkSeatsBlockDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => MarkSeatsBlockDto)
  markSeats!: MarkSeatsBlockDto;
}

export class RemoveSeatsBlockDto {
  @ApiProperty({ type: BookingAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => BookingAddressDto)
  booking!: BookingAddressDto;

  @ApiProperty({ type: [SeatSelectionDto] })
  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SeatSelectionDto)
  seats!: SeatSelectionDto[];
}

export class RemoveSeatsDto {
  @ApiProperty({ type: RemoveSeatsBlockDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => RemoveSeatsBlockDto)
  removeSeats!: RemoveSeatsBlockDto;
}

// ── Bilhete ───────────────────────────────────────────────────────────────────

export class RetrieveEticketBlockDto {
  @ApiPropertyOptional({ description: 'Número do bilhete, quando conhecido.' })
  @IsOptional()
  @IsString()
  eticket?: string;

  @ApiPropertyOptional({ type: BookingAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BookingAddressDto)
  booking?: BookingAddressDto;

  @ApiPropertyOptional({ description: 'Sistema de emissão, quando o provedor oferece mais de uma origem.' })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;
}

export class RetrieveEticketDto {
  @ApiProperty({ type: RetrieveEticketBlockDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => RetrieveEticketBlockDto)
  retrieveEticket!: RetrieveEticketBlockDto;
}

export class CancelEticketBlockDto {
  @ApiPropertyOptional({ description: 'Anula um documento específico.' })
  @IsOptional()
  @IsString()
  eticket?: string;

  @ApiPropertyOptional({ description: 'Alternativa: true pede todos os bilhetes da reserva.' })
  @IsOptional()
  @IsBoolean()
  allTickets?: boolean;

  @ApiPropertyOptional({ type: BookingAddressDto, description: 'Necessário quando allTickets=true.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BookingAddressDto)
  booking?: BookingAddressDto;

  @ApiPropertyOptional({ example: 'Cancelamento solicitado pelo cliente' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ description: 'refund/Payment/ExistingCredit/OrderCreditShell quando aplicável.' })
  @IsOptional()
  @IsString()
  refundType?: string;

  @ApiPropertyOptional({ description: 'Token devolvido por provedores que exigem token de void.' })
  @IsOptional()
  @IsString()
  cancelToken?: string;

  @ApiPropertyOptional({ type: [String], description: 'Recorte de trechos, se a companhia suportar.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  journeyKeys?: string[];
}

export class CancelEticketDto {
  @ApiProperty({ type: CancelEticketBlockDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CancelEticketBlockDto)
  cancelEticket!: CancelEticketBlockDto;
}

// ── Regra tarifária ───────────────────────────────────────────────────────────

export class FareRulesKeyDto {
  @ApiProperty({ description: 'A chave opaca vinda de `fares[].rules.key` da busca.' })
  @IsString()
  key!: string;
}

export class FareRulesDto {
  @ApiPropertyOptional({ type: ProviderOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProviderOptionsDto)
  options?: ProviderOptionsDto;

  @ApiProperty({ type: FareRulesKeyDto, description: 'Fechado: nenhum outro campo aqui dentro.' })
  @IsDefined()
  @ValidateNested()
  @Type(() => FareRulesKeyDto)
  fareRules!: FareRulesKeyDto;
}
