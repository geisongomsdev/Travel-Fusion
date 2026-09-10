import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsDefined, IsObject, IsOptional, IsString, Matches, ValidateNested,
} from 'class-validator';

export class QuoteDto {
  @ApiProperty({ description: 'O identifier opaco vindo da busca. Devolva intacto, nunca interprete.' })
  @IsString()
  identifier!: string;
}

export class BookingPassengerDto {
  @ApiPropertyOptional({ example: 'Mr' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ example: 'Andy' })
  @IsString()
  firstName!: string;

  @ApiProperty({ example: 'Peterson' })
  @IsString()
  lastName!: string;

  @ApiProperty({ example: '1990-04-21', description: 'YYYY-MM-DD. A idade é calculada na data do voo.' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}/, { message: 'dateOfBirth deve começar em YYYY-MM-DD' })
  dateOfBirth!: string;

  @ApiPropertyOptional({
    description: 'CSPs por passageiro (PerPassenger=true), ex.: OutwardLuggageOptions.',
    example: { OutwardLuggageOptions: '2' },
  })
  @IsOptional()
  @IsObject()
  customParameters?: Record<string, string>;
}

export class CreateBookingDto {
  @ApiProperty({ description: 'O identifier opaco da oferta tarifada.' })
  @IsString()
  identifier!: string;

  @ApiPropertyOptional({
    example: '2026-10-12',
    description: 'Data usada para calcular a idade real. Em ida-e-volta, a data da VOLTA.',
  })
  @IsOptional()
  @IsString()
  referenceDate?: string;

  @ApiProperty({ type: [BookingPassengerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BookingPassengerDto)
  passengers!: BookingPassengerDto[];

  @ApiPropertyOptional({
    description: 'CSPs do nível da reserva (PerPassenger=false).',
    example: { LuggageOptions: '1' },
  })
  @IsOptional()
  @IsObject()
  customParameters?: Record<string, string>;
}

export class RetrieveBookingAddressDto {
  @ApiProperty({ example: 'NW6PFQ', description: 'O localizador. Todo provedor usa.' })
  @IsString()
  locator!: string;

  @ApiPropertyOptional({ description: 'Sobrenome do passageiro principal.' })
  @IsOptional()
  @IsString()
  lastName?: string;
}

export class RetrieveOptionsDto {
  @ApiPropertyOptional({ example: 'travelfusion' })
  @IsOptional()
  @IsString()
  provider?: string;
}

export class RetrieveDto {
  @ApiPropertyOptional({ type: RetrieveOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RetrieveOptionsDto)
  options?: RetrieveOptionsDto;

  /**
   * 🔴 O bloco `booking` é deliberadamente TOLERANTE: campo desconhecido aqui é
   * ignorado, não recusado, porque cada companhia pede um conjunto diferente e
   * quem consome manda o superconjunto. Por isso ele fica fora do whitelist do
   * ValidationPipe (ver `forbidNonWhitelisted` no main.ts).
   */
  @ApiProperty({ type: RetrieveBookingAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => RetrieveBookingAddressDto)
  booking!: RetrieveBookingAddressDto;
}

export class FareRulesKeyDto {
  @ApiProperty({ description: 'A chave opaca vinda de fares[].rules.key da busca.' })
  @IsString()
  key!: string;
}

export class FareRulesDto {
  @ApiPropertyOptional({ example: 'travelfusion' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiProperty({ type: FareRulesKeyDto, description: 'Fechado: nenhum outro campo aqui dentro.' })
  @IsDefined()
  @ValidateNested()
  @Type(() => FareRulesKeyDto)
  fareRules!: FareRulesKeyDto;
}

/**
 * Cancelar usa o mesmo endereçamento do `/retrieve` — localizador mais o
 * provedor —, e por isso reaproveita os dois blocos em vez de clonar.
 */
export class CancelBookingDto {
  @ApiPropertyOptional({ type: RetrieveOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RetrieveOptionsDto)
  options?: RetrieveOptionsDto;

  @ApiProperty({ type: RetrieveBookingAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => RetrieveBookingAddressDto)
  booking!: RetrieveBookingAddressDto;
}

/** O mapa de assentos é endereçado pela OFERTA — ver `SeatMapService`. */
export class SeatMapDto {
  @ApiProperty({ description: 'O identifier opaco vindo da busca. Devolva intacto, nunca interprete.' })
  @IsString()
  identifier!: string;
}

/**
 * 🔴 O PAN é o número do cartão. Ele existe aqui porque a operadora precisa
 * dele para calcular as parcelas — e por isso NÃO é logado, NÃO é guardado e
 * não sai da chamada ao provedor.
 */
export class FinancingOptionsDto {
  @ApiPropertyOptional({ type: RetrieveOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RetrieveOptionsDto)
  options?: RetrieveOptionsDto;

  @ApiProperty({ type: RetrieveBookingAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => RetrieveBookingAddressDto)
  booking!: RetrieveBookingAddressDto;

  @ApiProperty({ example: '4000000000002701', description: 'Número do cartão. Não é armazenado.' })
  @IsString()
  @Matches(/^\d{13,19}$/, { message: 'card deve ter de 13 a 19 dígitos' })
  card!: string;
}

export class PaymentCardDto {
  @ApiProperty({ example: 'VI', description: 'Código IATA da bandeira: VI, CA, AX…' })
  @IsString()
  brand!: string;

  @ApiProperty({ example: 'ANDY PETERSON' })
  @IsString()
  holder!: string;

  @ApiProperty({ example: '4000000000002701' })
  @IsString()
  @Matches(/^\d{13,19}$/, { message: 'number deve ter de 13 a 19 dígitos' })
  number!: string;

  @ApiProperty({ example: '737' })
  @IsString()
  @Matches(/^\d{3,4}$/, { message: 'securityCode deve ter 3 ou 4 dígitos' })
  securityCode!: string;

  @ApiProperty({ example: '03/30', description: 'MM/AA. Convertido para MMAA antes de sair.' })
  @IsString()
  @Matches(/^\d{2}\/?\d{2}$/, { message: 'expiration deve estar em MM/AA' })
  expiration!: string;
}

export class BillingAddressDto {
  @ApiProperty({ example: 'test@mail.com' })
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

/** Quem PAGA. Pode não ser o passageiro — no Brasil o documento é o CPF. */
export class PayerDto {
  @ApiProperty({ example: 'Andy' })
  @IsString()
  firstName!: string;

  @ApiProperty({ example: 'Peterson' })
  @IsString()
  lastName!: string;

  @ApiProperty({ example: '1990-04-21' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth deve ser YYYY-MM-DD' })
  dateOfBirth!: string;

  @ApiProperty({ example: '52998224725', description: 'CPF do titular, no Brasil.' })
  @IsString()
  documentNumber!: string;
}

export class IssueDto {
  @ApiPropertyOptional({ type: RetrieveOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RetrieveOptionsDto)
  options?: RetrieveOptionsDto;

  @ApiProperty({ type: RetrieveBookingAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => RetrieveBookingAddressDto)
  booking!: RetrieveBookingAddressDto;

  @ApiProperty({ type: PaymentCardDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PaymentCardDto)
  card!: PaymentCardDto;

  @ApiProperty({ type: BillingAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => BillingAddressDto)
  billing!: BillingAddressDto;

  @ApiProperty({ type: PayerDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PayerDto)
  payer!: PayerDto;

  /**
   * 🔴 Ausente = a API PERGUNTA o total à companhia antes de cobrar, em vez de
   * confiar num número que veio do cliente. Um valor divergente aqui é a forma
   * mais fácil de cobrar errado.
   */
  @ApiPropertyOptional({ description: 'Opcional: sem ele, o total vem do /retrieve.' })
  @IsOptional()
  amount?: { total: number; currency: string };

  @ApiPropertyOptional({ description: 'Id da parcela escolhida em /financing-options.' })
  @IsOptional()
  @IsString()
  installmentId?: string;
}

/**
 * Catálogo de opcionais de uma reserva JÁ EMITIDA.
 *
 * 🔴 É outra coisa do `SeatMapDto`, e de propósito: o catálogo por oferta
 * devolve identificadores que só valem antes de reservar. Depois da emissão os
 * ids mudam de formato, e só eles servem para comprar.
 */
export class OrderCatalogDto {
  @ApiPropertyOptional({ type: RetrieveOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RetrieveOptionsDto)
  options?: RetrieveOptionsDto;

  @ApiProperty({ type: RetrieveBookingAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => RetrieveBookingAddressDto)
  booking!: RetrieveBookingAddressDto;
}

export class SelectedAncillaryDto {
  @ApiProperty({
    example: 'SEAT_086985c24476cd78fc16ee82e01fdd7d',
    description: 'O offerItemId vindo do catálogo POR RESERVA. Devolva intacto.',
  })
  @IsString()
  offerItemId!: string;

  @ApiProperty({ example: 'ADT_1', description: 'A quem o opcional pertence.' })
  @IsString()
  paxId!: string;

  @ApiPropertyOptional({ example: '12', description: 'Fileira. Obrigatória em assento.' })
  @IsOptional()
  @IsString()
  row?: string;

  @ApiPropertyOptional({ example: 'C', description: 'Coluna. Obrigatória em assento.' })
  @IsOptional()
  @IsString()
  column?: string;
}

/**
 * Comprar assento e/ou bagagem numa reserva emitida.
 *
 * 🔴 Cobra o cartão. Não é idempotente e não tem retry.
 */
export class SellAncillariesDto {
  @ApiPropertyOptional({ type: RetrieveOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RetrieveOptionsDto)
  options?: RetrieveOptionsDto;

  @ApiProperty({ type: RetrieveBookingAddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => RetrieveBookingAddressDto)
  booking!: RetrieveBookingAddressDto;

  @ApiProperty({ type: [SelectedAncillaryDto] })
  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SelectedAncillaryDto)
  items!: SelectedAncillaryDto[];

  @ApiPropertyOptional({
    type: PaymentCardDto,
    description: 'Dispensável só quando os opcionais escolhidos somam zero.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentCardDto)
  card?: PaymentCardDto;

  @ApiPropertyOptional({ type: PayerDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PayerDto)
  payer?: PayerDto;
}
