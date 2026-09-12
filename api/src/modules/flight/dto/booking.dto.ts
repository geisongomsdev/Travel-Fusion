import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsObject, IsOptional, IsString, Length,
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

/**
 * Uma oferta escolhida na busca.
 *
 * 🔴 `fareId` é o único campo que decide a venda. Os outros são contexto de
 * auditoria — o que a tela mostrou quando a pessoa clicou — e NÃO substituem a
 * chave: remontar a seleção a partir de `fareCode` + `bookingClass` é o caminho
 * clássico para tarifar uma família diferente da que foi exibida.
 */
export class SelectedOfferDto {
  @ApiPropertyOptional({ example: 'JOURNEY_1', description: 'A journey do trecho, como veio em `identifier`.' })
  @IsOptional()
  @IsString()
  journeyKey?: string;

  @ApiProperty({ description: 'O identificador OPACO vindo de `fares[].fareId`. Devolva intacto, nunca interprete.' })
  @IsString()
  fareId!: string;

  @ApiPropertyOptional({ example: 'Q00QP5ZI' })
  @IsOptional()
  @IsString()
  fareCode?: string;

  @ApiPropertyOptional({ example: 'Q', description: 'RBD informado na oferta.' })
  @IsOptional()
  @IsString()
  bookingClass?: string;

  @ApiPropertyOptional({ example: 'RY' })
  @IsOptional()
  @IsString()
  familyCode?: string;

  @ApiPropertyOptional({ example: ['LA8000'], description: 'Contexto de auditoria do voo escolhido.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  flightNumbers?: string[];
}

export class QuoteOptionsDto extends ProviderOptionsDto {
  @ApiPropertyOptional({ enum: ['pt-br', 'en-us', 'es-es'] })
  @IsOptional()
  @IsIn(['pt-br', 'en-us', 'es-es'])
  language?: string;

  @ApiPropertyOptional({ example: 'BR' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;
}

export class QuoteDto {
  @ApiProperty({ enum: ['oneway', 'roundtrip', 'multicity'], description: 'O mesmo tipo da busca que gerou a oferta.' })
  @IsIn(['oneway', 'roundtrip', 'multicity'])
  type!: TripType;

  @ApiProperty({
    type: [SelectedOfferDto],
    description: 'Uma oferta por journey. Em pacote fechado, uma só cobre a viagem inteira.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SelectedOfferDto)
  offers!: SelectedOfferDto[];

  @ApiPropertyOptional({ type: PassengersDto, description: 'Tem que bater com a contagem que gerou a oferta.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PassengersDto)
  passengers?: PassengersDto;

  @ApiPropertyOptional({ type: QuoteOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuoteOptionsDto)
  options?: QuoteOptionsDto;
}

// ── Reservar ──────────────────────────────────────────────────────────────────

export class PassengerDocumentDto {
  @ApiProperty({ enum: ['CPF', 'PASSPORT', 'RG', 'RNE', 'RNM', 'MERCOSUR'], example: 'PASSPORT' })
  @IsIn(['CPF', 'PASSPORT', 'RG', 'RNE', 'RNM', 'MERCOSUR'])
  type!: string;

  @ApiProperty({ example: 'AAB0302' })
  @IsString()
  number!: string;

  @ApiPropertyOptional({ example: 'BR' })
  @IsOptional()
  @IsString()
  issuingCountry?: string;

  @ApiPropertyOptional({ example: '2030-01-01' })
  @IsOptional()
  @IsString()
  @Matches(DATE, { message: 'expiryDate deve ser YYYY-MM-DD' })
  expiryDate?: string;
}

export class ContactPhoneDto {
  @ApiPropertyOptional({ example: '55' })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional({ example: '11' })
  @IsOptional()
  @IsString()
  areaCode?: string;

  @ApiProperty({ example: '988887777' })
  @IsString()
  number!: string;
}

/**
 * Um passageiro. A chave do mapa `people` é o PaxID (`ADT_1`, `CHD_1`, `INF_1`).
 *
 * 🔴 O PaxID não é decorativo: é ele que a companhia usa para amarrar tarifa,
 * assento, bagagem e bilhete ao passageiro certo. Uma lista posicional
 * funcionaria até o primeiro pedido com criança, quando a ordem que a tela
 * mandou deixa de coincidir com a ordem em que a oferta foi tarifada.
 */
export class BookingPersonDto {
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

  @ApiProperty({ enum: ['adult', 'child', 'infant'], description: 'Converte para o PTC (ADT/CHD/INF).' })
  @IsIn(['adult', 'child', 'infant'])
  ageGroup!: string;

  @ApiProperty({ example: '1990-01-01', description: 'YYYY-MM-DD. A idade é conferida na data do voo.' })
  @IsString()
  @Matches(DATE, { message: 'birthDate deve ser YYYY-MM-DD' })
  birthDate!: string;

  @ApiPropertyOptional({ enum: ['male', 'female', 'unspecified'] })
  @IsOptional()
  @IsIn(['male', 'female', 'unspecified'])
  gender?: string;

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

  @ApiPropertyOptional({
    description: 'Parâmetros que o provedor exigiu no /quote (requiredParameters), por passageiro.',
    example: { OutwardLuggageOptions: '2' },
  })
  @IsOptional()
  @IsObject()
  customParameters?: Record<string, string>;
}

export class CustomerDto {
  @ApiProperty({ example: 'buyer@example.test', description: 'Contato do comprador. A LATAM recusa a ordem sem contato.' })
  @IsString()
  email!: string;

  @ApiPropertyOptional({ example: '5511988887777' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'BR' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;
}

export class BookingFieldsDto {
  @ApiProperty({ description: 'A mesma chave opaca tarifada no /quote.' })
  @IsString()
  selectedFareId!: string;

  @ApiPropertyOptional({
    example: '2026-10-12',
    description: 'Data usada para conferir a idade. Em ida-e-volta, a data da VOLTA.',
  })
  @IsOptional()
  @IsString()
  referenceDate?: string;

  @ApiPropertyOptional({
    description: 'Parâmetros do nível da RESERVA (PerPassenger=false).',
    example: { LuggageOptions: '1' },
  })
  @IsOptional()
  @IsObject()
  customParameters?: Record<string, string>;
}

/**
 * Reservar.
 *
 * O modelo canônico descreve esta rota como queue-owned e embrulha a seleção em
 * `service.flight[]` — a forma que o worker recebe, com os campos de venda que
 * o próprio modelo diz não pertencerem ao provider. Aqui a API é direta: o que
 * sobrevive é `customer`, `people` e `fields.selectedFareId`, que é exatamente
 * o recorte que o mapper da companhia consome.
 */
export class CreateBookingDto {
  @ApiPropertyOptional({ type: ProviderOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProviderOptionsDto)
  options?: ProviderOptionsDto;

  @ApiProperty({ type: CustomerDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CustomerDto)
  customer!: CustomerDto;

  @ApiProperty({
    description: 'Mapa PaxID → passageiro. As chaves são ADT_1, CHD_1, INF_1…',
    example: { ADT_1: { firstName: 'ANA', lastName: 'EXAMPLE', ageGroup: 'adult', birthDate: '1990-01-01' } },
  })
  @IsDefined()
  @IsObject()
  people!: Record<string, BookingPersonDto>;

  @ApiProperty({ type: BookingFieldsDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => BookingFieldsDto)
  fields!: BookingFieldsDto;
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

// ── Assentos e opcionais da OFERTA ────────────────────────────────────────────

/**
 * 🔴 DIVERGÊNCIA CONSCIENTE, e é a única do dialeto.
 *
 * O modelo endereça `/seat-map` e `/ancillaries` pelo LOCALIZADOR, assumindo que
 * a escolha é pós-reserva. Na LATAM o `/seats/availability` e o `/services/list`
 * respondem pela OFERTA — a escolha é anterior, e o localizador ainda não
 * existe. Endereçar por `fareId` é o que torna a operação utilizável; inventar
 * um localizador para caber no formato seria pior.
 *
 * O caso do modelo continua atendido: é o `/order-seat-map` e o
 * `/order-ancillaries`, que respondem pela reserva já emitida.
 */
export class OfferCatalogDto {
  @ApiPropertyOptional({ type: ProviderOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProviderOptionsDto)
  options?: ProviderOptionsDto;

  @ApiProperty({ description: 'A chave opaca vinda de `fares[].fareId`.' })
  @IsString()
  fareId!: string;
}

export class AncillariesBlockDto {
  @ApiProperty({ description: 'A chave opaca vinda de `fares[].fareId`.' })
  @IsString()
  fareId!: string;

  @ApiPropertyOptional({ example: 'baggage', description: 'Ausente = todos os extras.' })
  @IsOptional()
  @IsString()
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
  @ApiPropertyOptional({ type: ProviderOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProviderOptionsDto)
  options?: ProviderOptionsDto;

  @ApiProperty({ type: AncillariesBlockDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => AncillariesBlockDto)
  ancillaries!: AncillariesBlockDto;
}

/** Catálogo da RESERVA emitida — endereçado pelo localizador, como no modelo. */
export class OrderCatalogDto {
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

// ── Pagamento ─────────────────────────────────────────────────────────────────

/**
 * 🔴 DADO DE CARTÃO. Não é logado, não é guardado e não volta na resposta.
 *
 * O vocabulário é o do modelo: `cvv` e `expiryDate`, não `securityCode` e
 * `expiration`. `expiryDate` é `MM/YYYY` — a conversão para o que a companhia
 * espera é nossa, em `common/utils/card.ts`.
 */
export class CreditCardDto {
  @ApiProperty({ example: 'VI', description: 'Código IATA da bandeira: VI, CA, AX…' })
  @IsString()
  brand!: string;

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

  @ApiProperty({ example: '12/2030', description: 'MM/YYYY ou MM/YY.' })
  @IsString()
  @Matches(/^\d{2}\/?\d{2}(\d{2})?$/, { message: 'expiryDate deve ser MM/YYYY ou MM/YY' })
  expiryDate!: string;

  @ApiPropertyOptional({ example: 'buyer@example.test', description: 'Contato do PAGADOR.' })
  @IsOptional()
  @IsString()
  holderEmail?: string;

  @ApiPropertyOptional({ example: '+5511900000000' })
  @IsOptional()
  @IsString()
  holderPhone?: string;

  @ApiPropertyOptional({ example: '1990-01-01', description: 'Exigido quando o retrieve não traz a data do pagador.' })
  @IsOptional()
  @IsString()
  @Matches(DATE, { message: 'holderBirthDate deve ser YYYY-MM-DD' })
  holderBirthDate?: string;

  @ApiPropertyOptional({ example: '52998224725', description: 'CPF do titular, no Brasil. A LATAM exige no Payer.' })
  @IsOptional()
  @IsString()
  holderDocument?: string;
}

/**
 * Endereço de cobrança.
 *
 * Não está no modelo porque o executor LATAM documentado ali não o lê — mas o
 * `/order/change/payment` real exige `ContactInfo` com `ContactPurposeText:
 * BILLING` e `PostalAddress` completo. É extensão declarada, não invenção.
 */
export class BillingAddressDto {
  @ApiProperty({ example: 'buyer@example.test' })
  @IsString()
  email!: string;

  @ApiProperty({ example: 'BR' })
  @IsString()
  countryCode!: string;

  @ApiProperty({ example: '01310-100' })
  @IsString()
  postalCode!: string;

  @ApiProperty({ example: 'Av. Paulista, 1000' })
  @IsString()
  street!: string;
}

export class IssuePaymentDto {
  @ApiPropertyOptional({ example: 'credit-card', enum: ['credit-card', 'cash'] })
  @IsOptional()
  @IsIn(['credit-card', 'cash'])
  paymentMethod?: string;

  @ApiPropertyOptional({ example: 'single' })
  @IsOptional()
  @IsString()
  paymentMethodType?: string;

  /**
   * 🔴 Ausente = a API PERGUNTA o total à companhia antes de cobrar, em vez de
   * confiar num número que veio do cliente. Um valor divergente aqui é a forma
   * mais fácil de cobrar errado — e quando diverge, a cobrança não acontece.
   */
  @ApiPropertyOptional({ example: 505.0, description: 'Declaração do que quem chama espera pagar.' })
  @IsOptional()
  billedAmount?: number;

  @ApiPropertyOptional({ example: 'BRL' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ type: CreditCardDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CreditCardDto)
  creditCard!: CreditCardDto;

  @ApiProperty({ type: BillingAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => BillingAddressDto)
  billing!: BillingAddressDto;

  @ApiPropertyOptional({ description: 'Id da parcela escolhida em /financing-options.' })
  @IsOptional()
  @IsString()
  installmentId?: string;
}

export class IssueBlockDto {
  @ApiProperty({ type: BookingAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => BookingAddressDto)
  booking!: BookingAddressDto;

  @ApiPropertyOptional({ description: 'Se true, aceita a re-tarifa depois de FARE_PRICE_CHANGED.' })
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

/** Só o PAN: a operadora precisa dele para calcular as parcelas. */
export class FinancingCardDto {
  @ApiProperty({ example: '4000000000002701', description: 'Número do cartão. Não é logado nem guardado.' })
  @IsString()
  @Matches(/^\d{13,19}$/, { message: 'number deve ter de 13 a 19 dígitos' })
  number!: string;
}

export class FinancingPaymentDto {
  @ApiProperty({ type: FinancingCardDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => FinancingCardDto)
  creditCard!: FinancingCardDto;
}

export class FinancingOptionsDto {
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

  @ApiProperty({ type: FinancingPaymentDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => FinancingPaymentDto)
  payment!: FinancingPaymentDto;

  @ApiPropertyOptional({ example: 'PAYLATER', description: 'Fluxo aceito pelo builder; o padrão é PAYLATER.' })
  @IsOptional()
  @IsString()
  executionFlow?: string;
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
  @ApiPropertyOptional({ enum: ['credit-card'], description: 'Ausência significa assento pendente.' })
  @IsOptional()
  @IsIn(['credit-card'])
  method?: string;

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
